import type { Metadata } from "next";
import { getConfig } from "@/core/config/loader";
import { buildTicketMeta } from "@/lib/ticket-meta";
import { requireActor } from "@/server/session";
import { PortalNewForm } from "./form";

export const metadata: Metadata = { title: "Get help" };

export default async function PortalNew({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  await requireActor("/portal/new");
  const cfg = getConfig();
  const meta = buildTicketMeta(cfg);
  const types = meta.types.filter((t) => t.portalVisible).map((t) => ({ ...t, fields: t.fields.filter((f) => f.portal) }));
  const { type } = await searchParams;
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Get help</h1>
      <p className="mt-1 text-muted-foreground">Tell us what&apos;s going on. The more detail, the faster we can help.</p>
      <PortalNewForm types={types} initialType={types.some((t) => t.key === type) ? type : types[0]?.key} impact={meta.impact} urgency={meta.urgency} suggest={cfg.features.knowledgeBase && cfg.portal.suggestArticles} />
    </div>
  );
}
