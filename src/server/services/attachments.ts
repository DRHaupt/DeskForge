/** Attachment upload/download with type & size limits and ticket-level access checks. */
import { actorUserId, type Actor } from "@/core/rbac/actor";
import { canSeeInternal } from "@/core/tickets/access";
import { NotFoundError, ValidationError } from "@/core/errors";
import { db } from "../db";
import { checkUpload, getStorage, newStorageKey, safeFilename, sha256Hex } from "../storage";
import { getTicket } from "./tickets";

export async function storeAttachment(actor: Actor | null, file: { name: string; type: string; data: Buffer }, link: { ticketId?: string; commentId?: string; articleId?: string } = {}) {
  const filename = safeFilename(file.name);
  const contentType = file.type || "application/octet-stream";
  const problem = checkUpload(filename, contentType, file.data.length);
  if (problem) throw new ValidationError(problem, { file: problem });
  const storage = getStorage();
  const key = newStorageKey();
  await storage.put(key, file.data, contentType);
  return db.attachment.create({
    data: {
      filename,
      contentType,
      size: file.data.length,
      storageDriver: storage.name,
      storageKey: key,
      checksum: sha256Hex(file.data),
      uploaderId: actor ? actorUserId(actor) : null,
      ...link,
    },
    select: { id: true, filename: true, size: true, contentType: true },
  });
}

/** Returns the attachment row + bytes if the actor may see it. */
export async function readAttachment(actor: Actor | null, id: string) {
  const att = await db.attachment.findUnique({ where: { id }, include: { comment: { select: { visibility: true, deletedAt: true } }, article: { select: { status: true, visibility: true, deletedAt: true } } } });
  if (!att) throw new NotFoundError("Attachment");
  if (att.articleId) {
    const a = att.article!;
    const isPublic = a.status === "PUBLISHED" && a.visibility === "PUBLIC" && !a.deletedAt;
    if (!isPublic && !(actor && actor.kind !== "system" && actor.permissions.has("kb.view_internal"))) throw new NotFoundError("Attachment");
  } else if (att.ticketId) {
    if (!actor) throw new NotFoundError("Attachment");
    await getTicket(actor, att.ticketId); // throws NotFound if not visible
    if (att.comment && (att.comment.deletedAt || (att.comment.visibility === "INTERNAL" && !canSeeInternal(actor)))) throw new NotFoundError("Attachment");
  } else {
    // Not linked yet: only the uploader may fetch it.
    if (!actor || actorUserId(actor) !== att.uploaderId) throw new NotFoundError("Attachment");
  }
  const data = await getStorage().get(att.storageKey);
  return { att, data };
}
