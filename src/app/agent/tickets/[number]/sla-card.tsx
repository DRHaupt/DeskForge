"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SlaBadge } from "@/components/tickets/sla-badge";
import { formatDateTime } from "@/lib/format";
import type { TicketView } from "./types";

const LABEL: Record<string, string> = { FIRST_RESPONSE: "First response", RESOLUTION: "Resolution" };
const STATUS: Record<string, string> = { RUNNING: "Running", PAUSED: "Paused", MET: "Met", BREACHED: "Breached", CANCELLED: "Not applicable" };

export function SlaCard({ ticket, timezone, canOverride, call }: { ticket: TicketView; timezone: string; canOverride: boolean; call: (url: string, body?: unknown, method?: string, ok?: string) => Promise<unknown> }) {
  const [editing, setEditing] = useState<string | null>(null);
  if (!ticket.sla.length) return null;
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">SLA</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-4 text-sm">
        {ticket.sla.map((s) => (
          <div key={s.metric} className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{LABEL[s.metric]}</span>
              {s.status === "RUNNING" || s.status === "PAUSED" ? <SlaBadge sla={[s]} compact /> : <span className={s.status === "BREACHED" ? "text-xs font-medium text-destructive" : "text-xs text-muted-foreground"}>{STATUS[s.status]}</span>}
            </div>
            <p className="text-xs text-muted-foreground">
              {s.policy} · due {formatDateTime(s.dueAt, timezone)}
              {s.breachedAt && s.status !== "BREACHED" && " · breached"}
            </p>
            {canOverride && (s.status === "RUNNING" || s.status === "PAUSED") && (
              <button className="text-xs text-primary hover:underline" onClick={() => setEditing(s.metric)}>
                Override due date
              </button>
            )}
          </div>
        ))}
      </CardContent>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Override {editing ? LABEL[editing]?.toLowerCase() : ""} due date</DialogTitle>
            <DialogDescription>The change and your reason are recorded in the audit log.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const ok = await call(`/api/v1/tickets/${ticket.id}/sla`, { metric: editing, dueAt: new Date(String(f.get("dueAt"))).toISOString(), reason: f.get("reason") }, "POST", "SLA updated");
              if (ok) setEditing(null);
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="sla-due">New due date</Label>
              <Input id="sla-due" name="dueAt" type="datetime-local" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sla-reason">Reason</Label>
              <Input id="sla-reason" name="reason" required minLength={3} placeholder="e.g. Customer asked us to wait until the office reopens" />
            </div>
            <DialogFooter>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
