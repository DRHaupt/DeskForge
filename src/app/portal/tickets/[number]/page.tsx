import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getConfig } from "@/core/config/loader";
import { getTicketTypeConfig } from "@/core/config/helpers";
import { displayValue } from "@/core/tickets/fields";
import { NotFoundError } from "@/core/errors";
import { StatusBadge } from "@/components/tickets/badges";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { buildTicketMeta, stateColor, stateLabel } from "@/lib/ticket-meta";
import { db } from "@/server/db";
import { requireActor } from "@/server/session";
import { getTicket, getTimeline, ticketFieldValues, transitionsFor } from "@/server/services/tickets";
import { PortalReply } from "./reply";
import { CsatInline } from "./csat-inline";

export async function generateMetadata({ params }: { params: Promise<{ number: string }> }): Promise<Metadata> {
  return { title: (await params).number };
}

export default async function PortalTicket({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const actor = await requireActor(`/portal/tickets/${number}`);
  const cfg = getConfig();
  let ticket;
  try {
    ticket = await getTicket(actor, number.toUpperCase());
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const meta = buildTicketMeta(cfg);
  const typeCfg = getTicketTypeConfig(cfg, ticket.type.key);
  const timeline = (await getTimeline(actor, ticket)).filter((i) => i.kind !== "activity");
  const values = ticketFieldValues(ticket);
  const portalFields = (typeCfg?.fields ?? []).filter((f) => f.portal && values[f.key] !== undefined && values[f.key] !== null);
  const transitions = transitionsFor(actor, ticket).filter((t) => t.category === "closed" || t.category === "open" || t.category === "resolved" || t.category === "new");
  const done = ticket.statusCategory === "RESOLVED" || ticket.statusCategory === "CLOSED";
  const survey = cfg.features.csat && ticket.requesterId === actor.id ? await db.cSATResponse.findUnique({ where: { ticketId: ticket.id } }) : null;
  const approval = ticket.catalogRequest;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <p className="mb-2 text-sm">
        <Link href="/portal/tickets" className="text-muted-foreground hover:underline">
          ← My requests
        </Link>
      </p>
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span className="font-mono">{ticket.number}</span>·<span>{ticket.type.name}</span>
        <StatusBadge label={stateLabel(meta, ticket.type.key, ticket.status, true)} color={stateColor(meta, ticket.type.key, ticket.status)} category={ticket.statusCategory} />
      </div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{ticket.title}</h1>
      {ticket.mergedInto && (
        <p className="mt-2 rounded-md border bg-muted/40 p-3 text-sm">
          This request was merged into{" "}
          <Link href={`/portal/tickets/${ticket.mergedInto.number}`} className="font-medium text-primary hover:underline">
            {ticket.mergedInto.number}
          </Link>
          . Updates continue there.
        </p>
      )}
      {approval && approval.approvalStatus !== "NOT_REQUIRED" && (
        <p className={`mt-3 rounded-md border p-3 text-sm ${approval.approvalStatus === "REJECTED" ? "border-destructive/40 bg-destructive/5" : approval.approvalStatus === "APPROVED" ? "border-green-600/30 bg-green-50 dark:bg-green-950/20" : "bg-amber-50 dark:bg-amber-950/20"}`}>
          {approval.approvalStatus === "PENDING" && <>Waiting for approval{approval.approvals.length ? ` from ${approval.approvals.map((a) => a.approver.name).join(" or ")}` : ""}.</>}
          {approval.approvalStatus === "APPROVED" && <>Approved — we&apos;re working on it.</>}
          {approval.approvalStatus === "REJECTED" && <>This request was not approved.</>}
        </p>
      )}

      {survey && done && <CsatInline token={survey.token} rating={survey.rating} scale={cfg.csat.scale} question={cfg.csat.question} />}

      <Card className="mt-6">
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Opened by {ticket.requester.name} on {formatDateTime(ticket.createdAt, meta.timezone)}
            {ticket.assignee && ` · handled by ${ticket.assignee.name}`}
          </p>
          {ticket.description && <div className="prose-df" dangerouslySetInnerHTML={{ __html: ticket.description }} />}
          {portalFields.length > 0 && (
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {portalFields.map((f) => (
                <div key={f.key} className="flex gap-2">
                  <dt className="text-muted-foreground">{f.label}:</dt>
                  <dd>{displayValue(f, values[f.key])}</dd>
                </div>
              ))}
            </dl>
          )}
          {ticket.attachments.length > 0 && (
            <ul className="flex flex-wrap gap-2 text-sm">
              {ticket.attachments.map((a) => (
                <li key={a.id}>
                  <a href={`/api/v1/attachments/${a.id}`} className="text-primary hover:underline">
                    {a.filename}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ol className="mt-6 space-y-4" aria-label="Conversation">
        {timeline.map((i) =>
          i.kind === "comment" ? (
            <li key={i.id} className={`rounded-lg border p-4 ${i.comment.authorId === ticket.requesterId ? "bg-card" : "bg-primary/5"}`}>
              <div className="mb-2 flex items-center gap-2 text-sm">
                <Avatar name={i.comment.author?.name ?? cfg.branding.name} className="size-6" />
                <span className="font-medium">{i.comment.author?.name ?? cfg.branding.name}</span>
                <time className="ml-auto text-xs text-muted-foreground">{formatDateTime(i.at, meta.timezone)}</time>
              </div>
              <div className="prose-df" dangerouslySetInnerHTML={{ __html: i.comment.body }} />
              {i.comment.attachments.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2 text-sm">
                  {i.comment.attachments.map((a) => (
                    <li key={a.id}>
                      <a href={`/api/v1/attachments/${a.id}`} className="text-primary hover:underline">
                        {a.filename}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ) : i.kind === "status" && i.from ? (
            <li key={i.id} className="px-1 text-xs text-muted-foreground">
              Status changed to <strong className="text-foreground">{stateLabel(meta, ticket.type.key, i.to, true)}</strong> · {formatDateTime(i.at, meta.timezone)}
            </li>
          ) : null,
        )}
      </ol>

      {!ticket.mergedInto && <PortalReply ticketId={ticket.id} canReply={actor.permissions.has("ticket.reply")} done={done} transitions={transitions.map((t) => ({ to: t.to, name: t.name, category: t.category, requireComment: t.requireComment }))} reopenOnReply={cfg.portal.reopenOnReply} allowClose={cfg.portal.allowRequesterClose} />}
    </div>
  );
}
