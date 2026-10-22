import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2, Package } from "lucide-react";
import { getConfig } from "@/core/config/loader";
import { requireActor } from "@/server/session";
import { listCatalogItems } from "@/server/services/catalog";

export const metadata: Metadata = { title: "Request something" };

export default async function PortalCatalog() {
  if (!getConfig().features.serviceCatalog) notFound();
  const actor = await requireActor("/portal/catalog");
  const items = await listCatalogItems(actor);
  const groups = [...new Set(items.map((i) => i.group ?? "Other"))];
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Request something</h1>
      <p className="mt-1 text-muted-foreground">Pick a service. Some requests need approval before we start.</p>
      {groups.map((g) => (
        <section key={g} className="mt-8" aria-labelledby={`g-${g}`}>
          <h2 id={`g-${g}`} className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            {g}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items
              .filter((i) => (i.group ?? "Other") === g)
              .map((i) => (
                <Link key={i.id} href={`/portal/catalog/${i.key}`} className="rounded-xl border p-4 hover:border-primary/50 hover:bg-accent/40">
                  <span className="flex items-center gap-2 font-medium">
                    <Package className="size-4 text-primary" aria-hidden /> {i.name}
                  </span>
                  {i.description && <span className="mt-1 block text-sm text-muted-foreground">{i.description}</span>}
                  {i.requiresApproval && (
                    <span className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <CheckCircle2 className="size-3" aria-hidden /> Needs approval
                    </span>
                  )}
                </Link>
              ))}
          </div>
        </section>
      ))}
      {items.length === 0 && <p className="mt-8 text-muted-foreground">No services are available yet.</p>}
    </div>
  );
}
