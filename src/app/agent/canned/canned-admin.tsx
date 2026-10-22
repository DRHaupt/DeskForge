"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { RichTextEditor } from "@/components/tickets/rich-text-editor";
import { api } from "@/lib/api-client";

type MacroAction = { type: "set_status" | "set_priority" | "add_tag" | "assign_team" | "assign_to_me"; value?: string; teamId?: string };
type Item = { id: string; name: string; body: string; actions: MacroAction[] | null; isShared: boolean; ownerId: string | null; owner: { name: string } | null };
const sel = "h-9 rounded-md border border-input bg-background px-2 text-sm";

export function CannedAdmin({ items, me, canShare, teams, statuses, priorities }: { items: Item[]; me: string; canShare: boolean; teams: { id: string; name: string }[]; statuses: { key: string; name: string }[]; priorities: { key: string; name: string }[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Partial<Item> | null>(null);
  const [body, setBody] = useState("");
  const [actions, setActions] = useState<MacroAction[]>([]);
  const [shared, setShared] = useState(false);

  function open(i: Partial<Item>) {
    setEditing(i);
    setBody(i.body ?? "");
    setActions(i.actions ?? []);
    setShared(i.isShared ?? false);
  }

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = new FormData(e.currentTarget).get("name");
    const payload = { name, body, actions, isShared: shared };
    try {
      if (editing?.id) await api(`/api/v1/canned/${editing.id}`, { method: "PATCH", body: payload });
      else await api("/api/v1/canned", { body: payload });
      setEditing(null);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const editable = (i: Item) => (i.isShared ? canShare : i.ownerId === me);

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => open({})}>
          <Plus /> New response
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {items.map((i) => (
          <Card key={i.id} className="gap-2">
            <CardContent className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">
                  {i.name} {i.isShared ? <Badge variant="outline">Shared</Badge> : <Badge variant="outline">Personal</Badge>} {i.actions?.length ? <Badge variant="secondary">Macro</Badge> : null}
                </p>
                {editable(i) && (
                  <Button variant="ghost" size="sm" onClick={() => open(i)}>
                    Edit
                  </Button>
                )}
              </div>
              <div className="prose-df line-clamp-4 text-muted-foreground" dangerouslySetInnerHTML={{ __html: i.body }} />
              {i.actions?.length ? <p className="text-xs text-muted-foreground">Then: {i.actions.map((a) => `${a.type.replace(/_/g, " ")}${a.value ? ` ${a.value}` : ""}`).join(", ")}</p> : null}
            </CardContent>
          </Card>
        ))}
        {items.length === 0 && <p className="text-muted-foreground">No canned responses yet.</p>}
      </div>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit response" : "New response"}</DialogTitle>
            <DialogDescription>Placeholders: {"{{requester.name}}"}, {"{{ticket.number}}"}.</DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="cr-name">Name</Label>
              <Input id="cr-name" name="name" defaultValue={editing?.name} required />
            </div>
            <RichTextEditor value={body} onChange={setBody} ariaLabel="Response text" />
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Macro actions (optional)</legend>
              {actions.map((a, i) => (
                <div key={i} className="flex flex-wrap gap-2">
                  <select aria-label="Action" className={sel} value={a.type} onChange={(e) => setActions((s) => s.map((x, j) => (j === i ? { type: e.target.value as MacroAction["type"] } : x)))}>
                    <option value="set_status">Set status</option>
                    <option value="set_priority">Set priority</option>
                    <option value="add_tag">Add tag</option>
                    <option value="assign_team">Move to team</option>
                    <option value="assign_to_me">Assign to me</option>
                  </select>
                  {a.type === "set_status" && (
                    <select aria-label="Status" className={sel} value={a.value ?? ""} onChange={(e) => setActions((s) => s.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}>
                      <option value="">Choose…</option>
                      {statuses.map((o) => (
                        <option key={o.key} value={o.key}>{o.name}</option>
                      ))}
                    </select>
                  )}
                  {a.type === "set_priority" && (
                    <select aria-label="Priority" className={sel} value={a.value ?? ""} onChange={(e) => setActions((s) => s.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}>
                      <option value="">Choose…</option>
                      {priorities.map((o) => (
                        <option key={o.key} value={o.key}>{o.name}</option>
                      ))}
                    </select>
                  )}
                  {a.type === "add_tag" && <Input aria-label="Tag" className="h-9 w-40" value={a.value ?? ""} onChange={(e) => setActions((s) => s.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />}
                  {a.type === "assign_team" && (
                    <select aria-label="Team" className={sel} value={a.teamId ?? ""} onChange={(e) => setActions((s) => s.map((x, j) => (j === i ? { ...x, teamId: e.target.value } : x)))}>
                      <option value="">Choose…</option>
                      {teams.map((o) => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                  )}
                  <Button type="button" variant="ghost" size="icon" aria-label="Remove action" onClick={() => setActions((s) => s.filter((_, j) => j !== i))}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => setActions((s) => [...s, { type: "set_status", value: "" }])}>
                <Plus /> Action
              </Button>
            </fieldset>
            {canShare && (
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={shared} onCheckedChange={setShared} /> Shared with all agents
              </label>
            )}
            <DialogFooter className="gap-2">
              {editing?.id && (
                <Button type="button" variant="destructive" onClick={async () => { if (!confirm("Delete?")) return; await api(`/api/v1/canned/${editing.id}`, { method: "DELETE" }); setEditing(null); router.refresh(); }}>
                  Delete
                </Button>
              )}
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
