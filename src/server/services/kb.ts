/**
 * Knowledge base: categories, articles (draft → published → archived),
 * public vs internal visibility, feedback and view counts.
 */
import { z } from "zod";
import { actorUserId, assertCan, can, type Actor } from "@/core/rbac/actor";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/core/errors";
import { ArticleStatus, ArticleVisibility } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { getConfig } from "@/core/config/loader";
import { audit, type AuditContext } from "../audit";
import { db } from "../db";
import { excerpt, richText } from "../richtext";

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "article"
  );
}

async function uniqueSlug(base: string, excludeId?: string) {
  let slug = slugify(base);
  for (let i = 2; await db.knowledgeArticle.findFirst({ where: { slug, id: excludeId ? { not: excludeId } : undefined } }); i++) slug = `${slugify(base)}-${i}`;
  return slug;
}

function assertKbEnabled() {
  if (!getConfig().features.knowledgeBase) throw new NotFoundError("Knowledge base");
}

/** Visibility filter for whoever is reading (null = anonymous portal visitor). */
export function articleReadWhere(actor: Actor | null): Prisma.KnowledgeArticleWhereInput {
  const staff = actor && (can(actor, "kb.author") || can(actor, "kb.publish"));
  if (staff) return { deletedAt: null };
  const internal = actor && can(actor, "kb.view_internal");
  return { deletedAt: null, status: ArticleStatus.PUBLISHED, ...(internal ? {} : { visibility: ArticleVisibility.PUBLIC }) };
}

// ─── Categories ────────────────────────────────────────────────────────────

export const kbCategorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().regex(/^[a-z0-9-]{1,60}$/).optional(),
  description: z.string().max(300).nullable().optional(),
  icon: z.string().max(40).nullable().optional(),
  order: z.number().int().min(0).max(1000).optional(),
});

export async function listKbCategories(actor: Actor | null) {
  assertKbEnabled();
  const where = articleReadWhere(actor);
  const cats = await db.kbCategory.findMany({ orderBy: [{ order: "asc" }, { name: "asc" }], include: { _count: { select: { articles: { where } } } } });
  return cats;
}

export async function createKbCategory(actor: Actor, input: z.infer<typeof kbCategorySchema>, ctx?: AuditContext) {
  assertCan(actor, "kb.publish");
  const slug = input.slug ?? slugify(input.name);
  if (await db.kbCategory.findUnique({ where: { slug } })) throw new ConflictError("A category with that slug exists");
  const c = await db.kbCategory.create({ data: { ...input, slug } });
  await audit(actor, { action: "kb.category.create", entityType: "kb_category", entityId: c.id, changes: input }, ctx);
  return { id: c.id };
}

export async function updateKbCategory(actor: Actor, id: string, input: Partial<z.infer<typeof kbCategorySchema>>, ctx?: AuditContext) {
  assertCan(actor, "kb.publish");
  await db.kbCategory.update({ where: { id }, data: input });
  await audit(actor, { action: "kb.category.update", entityType: "kb_category", entityId: id, changes: input }, ctx);
  return { id };
}

export async function deleteKbCategory(actor: Actor, id: string, ctx?: AuditContext) {
  assertCan(actor, "kb.publish");
  await db.knowledgeArticle.updateMany({ where: { categoryId: id }, data: { categoryId: null } });
  await db.kbCategory.delete({ where: { id } });
  await audit(actor, { action: "kb.category.delete", entityType: "kb_category", entityId: id }, ctx);
  return { id };
}

// ─── Articles ──────────────────────────────────────────────────────────────

export const articleSchema = z.object({
  title: z.string().trim().min(3).max(200),
  body: z.string().max(500_000),
  excerpt: z.string().trim().max(300).nullable().optional(),
  categoryId: z.string().max(64).nullable().optional(),
  visibility: z.enum(ArticleVisibility).default(ArticleVisibility.PUBLIC),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20).default([]),
  status: z.enum(ArticleStatus).optional(),
});

export const articleListSchema = z.object({
  q: z.string().max(200).optional(),
  categoryId: z.string().max(64).optional(),
  status: z.enum(ArticleStatus).optional(),
  visibility: z.enum(ArticleVisibility).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["updated", "popular", "title"]).default("updated"),
});

export async function listArticles(actor: Actor | null, f: z.infer<typeof articleListSchema>) {
  assertKbEnabled();
  const where: Prisma.KnowledgeArticleWhereInput = {
    AND: [
      articleReadWhere(actor),
      f.categoryId ? { categoryId: f.categoryId } : {},
      f.status ? { status: f.status } : {},
      f.visibility ? { visibility: f.visibility } : {},
      f.q ? { OR: [{ title: { contains: f.q, mode: "insensitive" } }, { tags: { has: f.q.toLowerCase() } }] } : {},
    ],
  };
  const orderBy: Prisma.KnowledgeArticleOrderByWithRelationInput = f.sort === "popular" ? { viewCount: "desc" } : f.sort === "title" ? { title: "asc" } : { updatedAt: "desc" };
  const [total, items] = await Promise.all([
    db.knowledgeArticle.count({ where }),
    db.knowledgeArticle.findMany({
      where,
      orderBy,
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      select: { id: true, slug: true, title: true, excerpt: true, status: true, visibility: true, updatedAt: true, publishedAt: true, viewCount: true, helpfulCount: true, notHelpfulCount: true, tags: true, category: { select: { id: true, name: true, slug: true } }, author: { select: { name: true } } },
    }),
  ]);
  return { total, page: f.page, pageSize: f.pageSize, items };
}

export async function getArticle(actor: Actor | null, slugOrId: string, opts: { countView?: boolean } = {}) {
  assertKbEnabled();
  const a = await db.knowledgeArticle.findFirst({
    where: { AND: [articleReadWhere(actor), { OR: [{ slug: slugOrId }, { id: slugOrId }] }] },
    include: { category: true, author: { select: { id: true, name: true } }, attachments: { select: { id: true, filename: true, size: true, contentType: true } } },
  });
  if (!a) throw new NotFoundError("Article");
  if (opts.countView && a.status === "PUBLISHED") await db.knowledgeArticle.update({ where: { id: a.id }, data: { viewCount: { increment: 1 } } });
  return a;
}

export async function createArticle(actor: Actor, raw: z.input<typeof articleSchema>, ctx?: AuditContext) {
  assertKbEnabled();
  assertCan(actor, "kb.author");
  const input = articleSchema.parse(raw);
  if (input.status && input.status !== "DRAFT") assertCan(actor, "kb.publish");
  const body = richText(input.body);
  const a = await db.knowledgeArticle.create({
    data: {
      slug: await uniqueSlug(input.title),
      title: input.title,
      body: body.html,
      bodyText: body.text,
      excerpt: input.excerpt ?? excerpt(body.text, 200),
      categoryId: input.categoryId ?? null,
      visibility: input.visibility,
      tags: [...new Set(input.tags)],
      status: input.status ?? ArticleStatus.DRAFT,
      publishedAt: input.status === "PUBLISHED" ? new Date() : null,
      authorId: actorUserId(actor),
    },
  });
  await audit(actor, { action: "kb.article.create", entityType: "kb_article", entityId: a.id, changes: { title: a.title, status: a.status } }, ctx);
  return { id: a.id, slug: a.slug };
}

export async function updateArticle(actor: Actor, id: string, raw: Partial<z.input<typeof articleSchema>>, ctx?: AuditContext) {
  assertKbEnabled();
  assertCan(actor, "kb.author");
  const input = articleSchema.partial().parse(raw);
  const before = await db.knowledgeArticle.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw new NotFoundError("Article");
  // Authors can edit drafts; changing a published article or publishing needs kb.publish.
  if ((before.status !== "DRAFT" || (input.status && input.status !== "DRAFT")) && !can(actor, "kb.publish")) {
    throw new ForbiddenError("kb.publish", "Only publishers can change published articles or publish drafts");
  }
  const data: Prisma.KnowledgeArticleUpdateInput = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.body !== undefined) {
    const body = richText(input.body);
    data.body = body.html;
    data.bodyText = body.text;
    if (input.excerpt === undefined && !before.excerpt) data.excerpt = excerpt(body.text, 200);
  }
  if (input.excerpt !== undefined) data.excerpt = input.excerpt;
  if (input.categoryId !== undefined) data.category = input.categoryId ? { connect: { id: input.categoryId } } : { disconnect: true };
  if (input.visibility !== undefined) data.visibility = input.visibility;
  if (input.tags !== undefined) data.tags = [...new Set(input.tags)];
  if (input.status !== undefined && input.status !== before.status) {
    data.status = input.status;
    if (input.status === "PUBLISHED") data.publishedAt = new Date();
  }
  if (input.title && input.title !== before.title && before.status === "DRAFT") data.slug = await uniqueSlug(input.title, id);
  const after = await db.knowledgeArticle.update({ where: { id }, data });
  await audit(actor, { action: "kb.article.update", entityType: "kb_article", entityId: id, changes: { status: { from: before.status, to: after.status }, title: after.title } }, ctx);
  return { id, slug: after.slug };
}

export async function deleteArticle(actor: Actor, id: string, ctx?: AuditContext) {
  assertCan(actor, "kb.publish");
  await db.knowledgeArticle.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit(actor, { action: "kb.article.delete", entityType: "kb_article", entityId: id }, ctx);
  return { id };
}

export const feedbackSchema = z.object({ helpful: z.boolean(), comment: z.string().trim().max(1000).optional() });

export async function articleFeedback(actor: Actor | null, id: string, input: z.infer<typeof feedbackSchema>) {
  const a = await getArticle(actor, id);
  if (a.status !== "PUBLISHED") throw new ValidationError("Feedback is only for published articles");
  const userId = actor ? actorUserId(actor) : null;
  if (userId) {
    const prev = await db.articleFeedback.findFirst({ where: { articleId: a.id, userId } });
    if (prev) {
      // One vote per user: change it rather than add another.
      if (prev.helpful !== input.helpful) {
        await db.knowledgeArticle.update({ where: { id: a.id }, data: input.helpful ? { helpfulCount: { increment: 1 }, notHelpfulCount: { decrement: 1 } } : { helpfulCount: { decrement: 1 }, notHelpfulCount: { increment: 1 } } });
      }
      await db.articleFeedback.update({ where: { id: prev.id }, data: { helpful: input.helpful, comment: input.comment ?? prev.comment } });
      return { ok: true };
    }
  }
  await db.$transaction([
    db.articleFeedback.create({ data: { articleId: a.id, userId, helpful: input.helpful, comment: input.comment } }),
    db.knowledgeArticle.update({ where: { id: a.id }, data: input.helpful ? { helpfulCount: { increment: 1 } } : { notHelpfulCount: { increment: 1 } } }),
  ]);
  return { ok: true };
}
