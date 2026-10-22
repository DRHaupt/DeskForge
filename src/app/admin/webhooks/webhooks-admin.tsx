"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api-client";
import { RelativeTime } from "@/components/relative-time";


type Delivery = { id: string; event: string; status: string; attempts: number; responseStatus: number | null; error: string | null; createdAt: string };
type Hook = { id: string; name: string; url: string; events: string[]; isActive: boolean; secretPreview: string; lastDeliveryAt: string | null; deliveries: Delivery[] };

export function WebhooksAdmin({ hooks, events }: { hooks: Hook[]; events: string[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Hook | "new" | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [active, setActive] = useState(true);
  const hook = editing === "new" ? null : editing;

  function open(h: Hook | "new") {
    setEditing(h);
    setSelected(h === "new" ? ["ticket.created", "ticket.status_changed"] : h.events);
    setActive(h === "new" ? true : h.isActive);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { name: f.get("name"), url: f.get("url"), events: selected, isActive: active };
    try {
      if (hook) await api(`/api/v1/webhooks/${hook.id}`, { method: "PATCH", body });
      else setSecret((await api<{ secret: string }>("/api/v1/webhooks", { body })).secret);
      setEditing(null);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => open("new")}>
          <Plus /> New webhook
        </Button>
      </div>
      <div className="space-y-4">
        {hooks.map((h) => (
          <Card key={h.id} className={h.isActive ? "" : "opacity-70"}>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <CardTitle className="text-base">
                  {h.name} {!h.isActive && <Badge variant="outline">Disabled</Badge>}
                </CardTitle>
                <p className="truncate font-mono text-xs text-muted-foreground">{h.url}</p>
                <p className="mt-1 text-xs text-muted-foreground">Events: {h.events.join(", ")} · secret {h.secretPreview}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={async () => { await api(`/api/v1/webhooks/${h.id}/test`, { body: {} }).then(() => toast.success("Test sent")).catch((e) => toast.error(e.message)); router.refresh(); }}>
                  Send test
                </Button>
                <Button size="sm" variant="ghost" onClick={() => open(h)}>
                  Edit
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <p className="mb-1 text-xs font-semibold text-muted-foreground uppercase">Recent deliveries</p>
              <ul className="space-y-1 text-sm">
                {h.deliveries.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2">
                    <Badge variant={d.status === "SUCCEEDED" ? "secondary" : d.status === "FAILED" ? "destructive" : "outline"}>{d.status.toLowerCase()}</Badge>
                    <span className="font-mono text-xs">{d.event}</span>
                    <span className="text-xs text-muted-foreground">
                      <RelativeTime date={d.createdAt} /> · {d.attempts} attempt(s){d.responseStatus ? ` · HTTP ${d.responseStatus}` : ""}
                      {d.error && ` · ${d.error}`}
                    </span>
                    {d.status !== "SUCCEEDED" && (
                      <button className="text-xs text-primary hover:underline" onClick={async () => { await api(`/api/v1/webhook-deliveries/${d.id}/redeliver`, { body: {} }); router.refresh(); }}>
                        Redeliver
                      </button>
                    )}
                  </li>
                ))}
                {h.deliveries.length === 0 && <li className="text-muted-foreground">No deliveries yet.</li>}
              </ul>
            </CardContent>
          </Card>
        ))}
        {hooks.length === 0 && <p className="py-8 text-center text-muted-foreground">No webhooks yet.</p>}
      </div>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{hook ? `Edit ${hook.name}` : "New webhook"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="wh-name">Name</Label>
              <Input id="wh-name" name="name" defaultValue={hook?.name} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wh-url">URL</Label>
              <Input id="wh-url" name="url" type="url" defaultValue={hook?.url} required placeholder="https://example.com/hooks/deskforge" />
            </div>
            <fieldset>
              <legend className="mb-1 text-sm font-medium">Events</legend>
              <div className="grid grid-cols-2 gap-1 text-sm">
                {events.map((e) => (
                  <label key={e} className="flex items-center gap-2">
                    <input type="checkbox" checked={selected.includes(e)} onChange={(ev) => setSelected((s) => (ev.target.checked ? [...s, e] : s.filter((x) => x !== e)))} /> <span className="font-mono text-xs">{e}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={active} onCheckedChange={setActive} /> Active
            </label>
            <DialogFooter className="gap-2">
              {hook && (
                <>
                  <Button type="button" variant="outline" onClick={async () => { const r = await api<{ secret?: string }>(`/api/v1/webhooks/${hook.id}`, { method: "PATCH", body: { rotateSecret: true } }); setSecret(r.secret ?? null); setEditing(null); router.refresh(); }}>
                    Rotate secret
                  </Button>
                  <Button type="button" variant="destructive" onClick={async () => { if (!confirm("Delete webhook?")) return; await api(`/api/v1/webhooks/${hook.id}`, { method: "DELETE" }); setEditing(null); router.refresh(); }}>
                    Delete
                  </Button>
                </>
              )}
              <Button type="submit" disabled={!selected.length}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={!!secret} onOpenChange={(o) => !o && setSecret(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Signing secret</DialogTitle>
            <DialogDescription>Copy it now — it won&apos;t be shown again. Use it to verify the X-DeskForge-Signature header.</DialogDescription>
          </DialogHeader>
          <code className="block rounded bg-muted p-3 text-sm break-all select-all">{secret}</code>
        </DialogContent>
      </Dialog>
    </>
  );
}
