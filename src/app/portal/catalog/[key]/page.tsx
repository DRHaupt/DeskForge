import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getConfig } from "@/core/config/loader";
import { NotFoundError } from "@/core/errors";
import { requireActor } from "@/server/session";
import { getCatalogItem, itemFields } from "@/server/services/catalog";
import { CatalogForm } from "./form";

export const metadata: Metadata = { title: "Request" };

export default async function CatalogItemPage({ params }: { params: Promise<{ key: string }> }) {
  if (!getConfig().features.serviceCatalog) notFound();
  const { key } = await params;
  const actor = await requireActor(`/portal/catalog/${key}`);
  let item;
  try {
    item = await getCatalogItem(actor, key);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <p className="mb-2 text-sm">
        <Link href="/portal/catalog" className="text-muted-foreground hover:underline">
          ← All services
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">{item.name}</h1>
      {item.description && <p className="mt-1 text-muted-foreground">{item.description}</p>}
      {item.requiresApproval && <p className="mt-3 rounded-md border bg-muted/40 p-3 text-sm">This request needs approval. We&apos;ll let you know as soon as it&apos;s decided.</p>}
      <CatalogForm itemKey={item.key} fields={itemFields(item).filter((f) => f.portal)} />
    </div>
  );
}
