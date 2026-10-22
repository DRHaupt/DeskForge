"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api-client";
import { RelativeTime } from "@/components/relative-time";


type Cond = { field: string; op: string; value?: unknown };
type Action = Record<string, unknown> & { type: string };
type Automation = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  trigger: string;
  schedule: string | null;
  conditions: { all: Cond[]; any: Cond[] };
  actions: Action[];
  order: number;
  stopProcessing: boolean;
  runCount: number;
  lastRunAt: string | null;
  runs: { id: string; createdAt: string; success: boolean; error: string | null; actionsRun: string[] | null; ticketId: string | null }[];
};

const TRIGGERS: [string, string][] = [
  ["ticket.created", "Ticket created"],
  ["ticket.updated", "Ticket updated"],
  ["ticket.status_changed", "Status changed"],
  ["ticket.assigned", "Assignment changed"],
  ["ticket.commented", "Comment added"],
  ["sla.warning", "SLA warning"],
  ["sla.breached", "SLA breached"],
  ["schedule", "On a schedule (time-based)"],
];
const OPS: [string, string][] = [
  ["eq", "is"],
  ["neq", "is not"],
  ["in", "is one of"],
  ["not_in", "is none of"],
  ["contains", "contains"],
  ["not_contains", "doesn't contain"],
  ["starts_with", "starts with"],
  ["gt", ">"],
  ["gte", "≥"],
  ["lt", "<"],
  ["lte", "≤"],
  ["is_set", "is set"],
  ["is_not_set", "is empty"],
  ["changed", "changed"],
  ["changed_to", "changed to"],
  ["changed_from", "changed from"],
];
const ACTIONS: [string, string][] = [
  ["set_priority", "Set priority"],
  ["set_status", "Set status"],
  ["assign_team", "Assign to team"],
  ["assign_user", "Assign to agent"],
  ["add_tag", "Add tag"],
  ["remove_tag", "Remove tag"],
  ["set_field", "Set custom field"],
  ["add_comment", "Add comment"],
  ["notify", "Send notification"],
  ["add_watcher", "Add CC email"],
  ["webhook", "Call webhook"],
];
const sel = "h-9 rounded-md border border-input bg-background px-2 text-sm";
const NO_VALUE = new Set(["is_set", "is_not_set", "changed"]);

type Props = {
  automations: Automation[];
  fields: { value: string; label: string }[];
  priorities: { key: string; name: string }[];
  statuses: { key: string; name: string }[];
  teams: { key: string; name: string }[];
  agents: { email: string; name: string }[];
  webhooks: { id: string; name: string }[];
};

function blank(): Omit<Automation, "id" | "runCount" | "lastRunAt" | "runs"> {
  return { name: "", description: "", isActive: true, trigger: "ticket.created", schedule: null, conditions: { all: [], any: [] }, actions: [{ type: "add_tag", value: "" }], order: 0, stopProcessing: false };
}

export function AutomationsAdmin(props: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<(ReturnType<typeof blank> & { id?: string }) | null>(null);

  async function toggle(a: Automation) {
    await api(`/api/v1/automations/${a.id}`, { method: "PATCH", body: { isActive: !a.isActive } }).catch((e) => toast.error(e.message));
    router.refresh();
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setEditing(blank())}>
          <Plus /> New automation
        </Button>
      </div>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Automation</TableHead>
              <TableHead>When</TableHead>
              <TableHead>Runs</TableHead>
              <TableHead>Last run</TableHead>
              <TableHead>Active</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.automations.map((a) => (
              <TableRow key={a.id} className={a.isActive ? "" : "opacity-60"}>
                <TableCell>
                  <button className="text-left font-medium hover:underline" onClick={() => setEditing({ ...a })}>
                    {a.name}
                  </button>
                  {a.description && <div className="text-xs text-muted-foreground">{a.description}</div>}
                  {a.runs[0] && !a.runs[0].success && <div className="text-xs text-destructive">Last run failed: {a.runs[0].error}</div>}
                </TableCell>
                <TableCell className="text-sm">
                  {TRIGGERS.find(([k]) => k === a.trigger)?.[1]}
                  {a.schedule && <span className="text-muted-foreground"> ({a.schedule})</span>}
                </TableCell>
                <TableCell className="text-sm">{a.runCount}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{a.lastRunAt ? <RelativeTime date={a.lastRunAt} /> : "never"}</TableCell>
                <TableCell>
                  <Switch aria-label={`${a.name} active`} checked={a.isActive} onCheckedChange={() => toggle(a)} />
                </TableCell>
              </TableRow>
            ))}
            {props.automations.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No automations yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
      {editing && <Editor {...props} value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); router.refresh(); }} />}
    </>
  );
}

function Editor({ value, onClose, onSaved, ...p }: Props & { value: ReturnType<typeof blank> & { id?: string }; onClose: () => void; onSaved: () => void }) {
  const [a, setA] = useState(value);
  const [testTicket, setTestTicket] = useState("");
  const [testResult, setTestResult] = useState<{ matches: boolean; all: { field: string; actual: unknown; result: boolean }[]; any: { field: string; actual: unknown; result: boolean }[] } | null>(null);
  const set = (patch: Partial<typeof a>) => setA((s) => ({ ...s, ...patch }));

  function payload() {
    const fixCond = (c: Cond) => ({ ...c, value: NO_VALUE.has(c.op) ? undefined : c.op === "in" || c.op === "not_in" ? String(c.value ?? "").split(",").map((x) => x.trim()).filter(Boolean) : ["gt", "gte", "lt", "lte"].includes(c.op) ? Number(c.value) : c.value });
    return {
      name: a.name,
      description: a.description || null,
      isActive: a.isActive,
      trigger: a.trigger,
      schedule: a.trigger === "schedule" ? a.schedule || "every 60m" : null,
      conditions: { all: a.conditions.all.map(fixCond), any: a.conditions.any.map(fixCond) },
      actions: a.actions.map((x) => (x.type === "notify" ? { ...x, to: String(x.to ?? "").split(",").map((t) => t.trim()).filter(Boolean) } : x)),
      order: a.order,
      stopProcessing: a.stopProcessing,
    };
  }

  async function save() {
    try {
      if (a.id) await api(`/api/v1/automations/${a.id}`, { method: "PATCH", body: payload() });
      else await api("/api/v1/automations", { body: payload() });
      toast.success("Automation saved");
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const condRows = (group: "all" | "any") => (
    <div className="space-y-2">
      {a.conditions[group].map((c, i) => (
        <div key={i} className="flex flex-wrap gap-2">
          <select aria-label="Field" className={sel} value={c.field} onChange={(e) => set({ conditions: { ...a.conditions, [group]: a.conditions[group].map((x, j) => (j === i ? { ...x, field: e.target.value } : x)) } })}>
            {p.fields.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <select aria-label="Operator" className={sel} value={c.op} onChange={(e) => set({ conditions: { ...a.conditions, [group]: a.conditions[group].map((x, j) => (j === i ? { ...x, op: e.target.value } : x)) } })}>
            {OPS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          {!NO_VALUE.has(c.op) && (
            <Input aria-label="Value" className="h-9 w-48" value={Array.isArray(c.value) ? c.value.join(", ") : String(c.value ?? "")} placeholder={c.op === "in" || c.op === "not_in" ? "comma, separated" : "value"} onChange={(e) => set({ conditions: { ...a.conditions, [group]: a.conditions[group].map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) } })} />
          )}
          <Button variant="ghost" size="icon" aria-label="Remove condition" onClick={() => set({ conditions: { ...a.conditions, [group]: a.conditions[group].filter((_, j) => j !== i) } })}>
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => set({ conditions: { ...a.conditions, [group]: [...a.conditions[group], { field: "priority", op: "eq", value: "" }] } })}>
        <Plus /> Condition
      </Button>
    </div>
  );

  const actionParams = (x: Action, i: number) => {
    const upd = (patch: Record<string, unknown>) => set({ actions: a.actions.map((y, j) => (j === i ? { ...y, ...patch } : y)) });
    const text = (key: string, placeholder: string, w = "w-56") => <Input aria-label={placeholder} className={`h-9 ${w}`} placeholder={placeholder} value={String(x[key] ?? "")} onChange={(e) => upd({ [key]: e.target.value })} />;
    switch (x.type) {
      case "set_priority":
        return (
          <select aria-label="Priority" className={sel} value={String(x.value ?? "")} onChange={(e) => upd({ value: e.target.value })}>
            <option value="">Choose…</option>
            {p.priorities.map((o) => (
              <option key={o.key} value={o.key}>
                {o.name}
              </option>
            ))}
          </select>
        );
      case "set_status":
        return (
          <>
            <select aria-label="Status" className={sel} value={String(x.value ?? "")} onChange={(e) => upd({ value: e.target.value })}>
              <option value="">Choose…</option>
              {p.statuses.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.name}
                </option>
              ))}
            </select>
            {text("comment", "Optional public comment", "w-64")}
          </>
        );
      case "assign_team":
        return (
          <select aria-label="Team" className={sel} value={String(x.team ?? "")} onChange={(e) => upd({ team: e.target.value })}>
            <option value="">Choose…</option>
            {p.teams.map((o) => (
              <option key={o.key} value={o.key}>
                {o.name}
              </option>
            ))}
          </select>
        );
      case "assign_user":
        return (
          <select aria-label="Agent" className={sel} value={String(x.user ?? "")} onChange={(e) => upd({ user: e.target.value })}>
            <option value="">Choose…</option>
            <option value="unassigned">Unassign</option>
            {p.agents.map((o) => (
              <option key={o.email} value={o.email}>
                {o.name}
              </option>
            ))}
          </select>
        );
      case "add_tag":
      case "remove_tag":
        return text("value", "tag");
      case "set_field":
        return (
          <>
            {text("key", "field key", "w-40")}
            {text("value", "value", "w-40")}
          </>
        );
      case "add_comment":
        return (
          <>
            <Textarea aria-label="Comment" className="min-h-16 w-72" placeholder="Supports {{requester.first_name}}, {{ticket.number}}…" value={String(x.body ?? "")} onChange={(e) => upd({ body: e.target.value })} />
            <select aria-label="Visibility" className={sel} value={String(x.visibility ?? "INTERNAL")} onChange={(e) => upd({ visibility: e.target.value })}>
              <option value="INTERNAL">Internal note</option>
              <option value="PUBLIC">Public reply</option>
            </select>
          </>
        );
      case "notify":
        return (
          <>
            {text("to", "assignee, team_leads, requester, or emails", "w-64")}
            <Textarea aria-label="Message" className="min-h-16 w-72" placeholder="Message ({{ticket.number}}…)" value={String(x.message ?? "")} onChange={(e) => upd({ message: e.target.value })} />
          </>
        );
      case "add_watcher":
        return text("email", "cc@example.com");
      case "webhook":
        return (
          <select aria-label="Webhook" className={sel} value={String(x.webhookId ?? "")} onChange={(e) => upd({ webhookId: e.target.value })}>
            <option value="">Choose…</option>
            {p.webhooks.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        );
    }
    return null;
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{a.id ? `Edit: ${a.name}` : "New automation"}</DialogTitle>
          <DialogDescription>Automations act as the system and still follow workflow rules. Chains stop after 3 levels.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="au-name">Name</Label>
              <Input id="au-name" value={a.name} onChange={(e) => set({ name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="au-order">Order</Label>
              <Input id="au-order" type="number" min={0} value={a.order} onChange={(e) => set({ order: Number(e.target.value) })} />
            </div>
            <div className="space-y-1.5 sm:col-span-3">
              <Label htmlFor="au-desc">Description</Label>
              <Input id="au-desc" value={a.description ?? ""} onChange={(e) => set({ description: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="au-trigger">When</Label>
              <select id="au-trigger" className={`${sel} w-full`} value={a.trigger} onChange={(e) => set({ trigger: e.target.value })}>
                {TRIGGERS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            {a.trigger === "schedule" && (
              <div className="space-y-1.5">
                <Label htmlFor="au-sched">Run</Label>
                <Input id="au-sched" value={a.schedule ?? "every 60m"} onChange={(e) => set({ schedule: e.target.value })} placeholder="every 60m" />
              </div>
            )}
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">All of these must be true</legend>
            {condRows("all")}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">…and at least one of these (optional)</legend>
            {condRows("any")}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Then</legend>
            {a.actions.map((x, i) => (
              <div key={i} className="flex flex-wrap items-start gap-2">
                <select aria-label="Action" className={sel} value={x.type} onChange={(e) => set({ actions: a.actions.map((y, j) => (j === i ? { type: e.target.value } : y)) })}>
                  {ACTIONS.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
                {actionParams(x, i)}
                <Button variant="ghost" size="icon" aria-label="Remove action" onClick={() => set({ actions: a.actions.filter((_, j) => j !== i) })}>
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => set({ actions: [...a.actions, { type: "add_tag", value: "" }] })}>
              <Plus /> Action
            </Button>
          </fieldset>
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={a.isActive} onCheckedChange={(v) => set({ isActive: v })} /> Active
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={a.stopProcessing} onCheckedChange={(v) => set({ stopProcessing: v })} /> Stop other automations after this one matches
            </label>
          </div>
          <div className="rounded-md border p-3">
            <p className="mb-2 text-sm font-medium">Test conditions against a ticket (nothing changes)</p>
            <div className="flex gap-2">
              <Input aria-label="Ticket number" className="h-9 w-48" placeholder="INC0000012" value={testTicket} onChange={(e) => setTestTicket(e.target.value.toUpperCase())} />
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  try {
                    setTestResult(await api("/api/v1/automations/test", { body: { automation: payload(), ticket: testTicket } }));
                  } catch (err) {
                    toast.error((err as Error).message);
                  }
                }}
              >
                Test
              </Button>
            </div>
            {testResult && (
              <div className="mt-2 text-sm">
                <p className={testResult.matches ? "font-medium text-green-700" : "font-medium text-destructive"}>{testResult.matches ? "Would run" : "Would not run"}</p>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {[...testResult.all, ...testResult.any].map((r, i) => (
                    <li key={i}>
                      {r.result ? "✓" : "✗"} {r.field} = <code>{JSON.stringify(r.actual)}</code>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {"runs" in value && Array.isArray((value as unknown as Automation).runs) && (value as unknown as Automation).runs.length > 0 && (
            <div>
              <p className="text-sm font-semibold">Recent runs</p>
              <ul className="mt-1 space-y-1 text-xs">
                {(value as unknown as Automation).runs.map((r) => (
                  <li key={r.id}>
                    <Badge variant={r.success ? "secondary" : "destructive"}>{r.success ? "ok" : "failed"}</Badge> <RelativeTime date={r.createdAt} /> · {(r.actionsRun ?? []).join("; ")} {r.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          {a.id && (
            <Button
              variant="destructive"
              onClick={async () => {
                if (!confirm("Delete this automation?")) return;
                await api(`/api/v1/automations/${a.id}`, { method: "DELETE" });
                onSaved();
              }}
            >
              Delete
            </Button>
          )}
          <Button onClick={save} disabled={!a.name || !a.actions.length}>
            Save automation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
