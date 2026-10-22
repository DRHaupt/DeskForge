"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api-client";

type Item = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  icon: string | null;
  group: string | null;
  ticketTypeKey: string;
  teamId: string | null;
  priority: string | null;
  fields: unknown[];
  requiresApproval: boolean;
  approverIds: string[];
  isActive: boolean;
  order: number;
  team: { name: string } | null;
};
type Opt = { id: string; name: string };
const sel = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";
const EXAMPLE = `[
  { "key": "needed_by", "label": "Needed by", "type": "date", "required": true },
  { "key": "size", "label": "Size", "type": "dropdown", "options": ["Small", "Large"] }
]`;

export function CatalogAdmin({ items, teams, users, types, priorities }: { items: Item[]; teams: Opt[]; users: Opt[]; types: { key: string; name: string }[]; priorities: { key: string; name: string }[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const item = editing === "new" ? null : editing;
  const [approval, setApproval] = useState(false);
  const [active, setActive] = useState(true);
  const [approvers, setApprovers] = useState<string[]>([]);

  function open(i: Item | "new") {
    setEditing(i);
    setApproval(i === "new" ? false : i.requiresApproval);
    setActive(i === "new" ? true : i.isActive);
    setApprovers(i === "new" ? [] : i.approverIds);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    let fields: unknown;
    try {
      fields = JSON.parse(String(f.get("fields") || "[]"));
    } catch {
      toast.error("Form fields must be valid JSON");
      return;
    }
    const body = {
      key: f.get("key"),
      name: f.get("name"),
      description: f.get("description") || null,
      group: f.get("group") || null,
      icon: f.get("icon") || null,
      ticketTypeKey: f.get("ticketTypeKey"),
      teamId: f.get("teamId") || null,
      priority: f.get("priority") || null,
      order: Number(f.get("order") || 0),
      fields,
      requiresApproval: approval,
      approverIds: approvers,
      isActive: active,
    };
    try {
      if (item) await api(`/api/v1/catalog/items/${item.id}`, { method: "PATCH", body });
      else await api("/api/v1/catalog/items", { body });
      toast.success("Saved");
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
          <Plus /> New item
        </Button>
      </div>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Creates</TableHead>
              <TableHead>Team</TableHead>
              <TableHead>Approval</TableHead>
              <TableHead>
                <span className="sr-only">Edit</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => (
              <TableRow key={i.id} className={i.isActive ? "" : "opacity-60"}>
                <TableCell>
                  <span className="font-medium">{i.name}</span> {!i.isActive && <Badge variant="outline">Inactive</Badge>}
                  <div className="text-xs text-muted-foreground">
                    {i.group ?? "—"} · {(i.fields as unknown[]).length} fields
                  </div>
                </TableCell>
                <TableCell className="text-sm">{types.find((t) => t.key === i.ticketTypeKey)?.name ?? i.ticketTypeKey}</TableCell>
                <TableCell className="text-sm">{i.team?.name ?? "Type default"}</TableCell>
                <TableCell className="text-sm">{i.requiresApproval ? (i.approverIds.length ? `${i.approverIds.length} approver(s)` : "Any approver") : "—"}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => open(i)}>
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{item ? `Edit ${item.name}` : "New catalog item"}</DialogTitle>
            <DialogDescription>Form fields use the same format as custom fields in business.config.yaml.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ci-name">Name</Label>
              <Input id="ci-name" name="name" defaultValue={item?.name} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ci-key">Key</Label>
              <Input id="ci-key" name="key" defaultValue={item?.key} required pattern="[a-z][a-z0-9_-]{1,40}" readOnly={!!item} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ci-desc">Description</Label>
              <Input id="ci-desc" name="description" defaultValue={item?.description ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ci-group">Group</Label>
              <Input id="ci-group" name="group" defaultValue={item?.group ?? ""} placeholder="e.g. Hardware" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ci-order">Order</Label>
              <Input id="ci-order" name="order" type="number" min={0} defaultValue={item?.order ?? 0} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ci-type">Creates ticket type</Label>
              <select id="ci-type" name="ticketTypeKey" defaultValue={item?.ticketTypeKey ?? types[0]?.key} className={sel}>
                {types.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ci-team">Team</Label>
              <select id="ci-team" name="teamId" defaultValue={item?.teamId ?? ""} className={sel}>
                <option value="">Type default</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ci-priority">Priority</Label>
              <select id="ci-priority" name="priority" defaultValue={item?.priority ?? ""} className={sel}>
                <option value="">Type default</option>
                {priorities.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ci-icon">Icon name (optional)</Label>
              <Input id="ci-icon" name="icon" defaultValue={item?.icon ?? ""} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ci-fields">Form fields (JSON)</Label>
              <Textarea id="ci-fields" name="fields" className="min-h-40 font-mono text-xs" defaultValue={item ? JSON.stringify(item.fields, null, 2) : EXAMPLE} />
            </div>
            <label className="flex items-center gap-3 text-sm">
              <Switch checked={approval} onCheckedChange={setApproval} /> Requires approval
            </label>
            <label className="flex items-center gap-3 text-sm">
              <Switch checked={active} onCheckedChange={setActive} /> Available in the portal
            </label>
            {approval && (
              <fieldset className="space-y-1.5 sm:col-span-2">
                <legend className="text-sm font-medium">Approvers (none = anyone with the approve permission)</legend>
                <div className="flex max-h-32 flex-wrap gap-x-4 gap-y-1 overflow-y-auto text-sm">
                  {users.map((u) => (
                    <label key={u.id} className="flex items-center gap-1.5">
                      <input type="checkbox" checked={approvers.includes(u.id)} onChange={(e) => setApprovers((s) => (e.target.checked ? [...s, u.id] : s.filter((x) => x !== u.id)))} />
                      {u.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <DialogFooter className="sm:col-span-2">
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
