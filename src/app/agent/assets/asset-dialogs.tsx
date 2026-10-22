"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Upload } from "lucide-react";
import { ASSET_STATUSES, assetStatusLabel as statusLabel } from "@/core/assets/csv";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api-client";

const sel = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm";


export type AssetValues = {
  id?: string;
  tag?: string;
  name?: string;
  assetType?: string;
  status?: string;
  serialNumber?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  location?: string | null;
  ownerId?: string | null;
  organizationId?: string | null;
  purchaseDate?: string | null;
  warrantyExpiresAt?: string | null;
  notes?: string | null;
};

export function AssetDialog({ users, orgs, types, asset, trigger }: { users: { id: string; name: string; email: string }[]; orgs: { id: string; name: string }[]; types: string[]; asset?: AssetValues; trigger?: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const str = (k: string) => {
      const v = String(f.get(k) ?? "").trim();
      return v === "" ? null : v;
    };
    const body = {
      tag: str("tag"),
      name: str("name"),
      assetType: str("assetType"),
      status: str("status"),
      serialNumber: str("serialNumber"),
      manufacturer: str("manufacturer"),
      model: str("model"),
      location: str("location"),
      ownerId: str("ownerId"),
      organizationId: str("organizationId"),
      purchaseDate: str("purchaseDate"),
      warrantyExpiresAt: str("warrantyExpiresAt"),
      notes: str("notes"),
    };
    setBusy(true);
    try {
      if (asset?.id) {
        await api(`/api/v1/assets/${asset.id}`, { method: "PATCH", body });
        setOpen(false);
        if (body.tag !== asset.tag) router.replace(`/agent/assets/${encodeURIComponent(body.tag ?? "")}`);
        router.refresh();
      } else {
        const r = await api<{ tag: string }>("/api/v1/assets", { body });
        setOpen(false);
        router.push(`/agent/assets/${encodeURIComponent(r.tag)}`);
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const field = (name: keyof AssetValues, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`as-${name}`}>{label}</Label>
      <Input id={`as-${name}`} name={name} defaultValue={(asset?.[name] as string | null | undefined) ?? ""} {...props} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus /> New asset
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{asset?.id ? `Edit ${asset.tag}` : "New asset"}</DialogTitle>
          <DialogDescription>The tag must be unique. Everything except tag, name and type is optional.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {field("tag", "Tag", { required: true, pattern: "[\\w.\\-/#]+", title: "Letters, numbers and . - _ / # only" })}
            {field("name", "Name", { required: true })}
            <div className="space-y-1.5">
              <Label htmlFor="as-assetType">Type</Label>
              <Input id="as-assetType" name="assetType" list="as-types" defaultValue={asset?.assetType ?? ""} required />
              <datalist id="as-types">
                {types.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="as-status">Status</Label>
              <select id="as-status" name="status" defaultValue={asset?.status ?? "in_use"} className={sel}>
                {ASSET_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(s)}
                  </option>
                ))}
              </select>
            </div>
            {field("serialNumber", "Serial number")}
            {field("manufacturer", "Manufacturer")}
            {field("model", "Model")}
            {field("location", "Location")}
            <div className="space-y-1.5">
              <Label htmlFor="as-owner">Owner</Label>
              <select id="as-owner" name="ownerId" defaultValue={asset?.ownerId ?? ""} className={sel}>
                <option value="">Nobody</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="as-org">Organization</Label>
              <select id="as-org" name="organizationId" defaultValue={asset?.organizationId ?? ""} className={sel}>
                <option value="">None</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            {field("purchaseDate", "Purchased", { type: "date" })}
            {field("warrantyExpiresAt", "Warranty ends", { type: "date" })}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="as-notes">Notes</Label>
            <Textarea id="as-notes" name="notes" defaultValue={asset?.notes ?? ""} rows={3} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {asset?.id ? "Save" : "Create asset"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type Report = { created: number; updated: number; errors: { line: number; message: string }[]; extras: string[]; dryRun: boolean };

export function ImportDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(dryRun: boolean) {
    setBusy(true);
    try {
      const r = await api<Report>("/api/v1/assets/import", { body: { csv, dryRun } });
      setReport(r);
      if (!dryRun) {
        toast.success(`Imported: ${r.created} new, ${r.updated} updated`);
        router.refresh();
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setCsv("");
          setReport(null);
          setFileName("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload /> Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import assets</DialogTitle>
          <DialogDescription>
            Needs <strong>tag</strong>, <strong>name</strong> and <strong>type</strong> columns. Optional: status, serial, manufacturer, model, location, owner (email), organization, purchase date, warranty, notes. Other columns are kept as extra details. Rows are matched by tag, so re-importing updates them.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Label htmlFor="imp-file">CSV file</Label>
          <Input
            id="imp-file"
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              setReport(null);
              if (!file) return;
              if (file.size > 5_000_000) {
                toast.error("That file is over 5 MB. Split it and import in parts.");
                return;
              }
              setFileName(file.name);
              setCsv(await file.text());
            }}
          />
          {report && (
            <Alert variant={report.errors.length ? "destructive" : "default"}>
              <AlertDescription>
                <p>
                  {report.dryRun ? "Preview: " : "Done: "}
                  {report.created} new, {report.updated} updated, {report.errors.length} with problems.
                </p>
                {report.extras.length > 0 && <p>Extra columns kept as details: {report.extras.join(", ")}.</p>}
                {report.errors.length > 0 && (
                  <ul className="mt-2 max-h-40 list-disc overflow-auto pl-5 text-xs">
                    {report.errors.slice(0, 50).map((e) => (
                      <li key={e.line}>
                        Line {e.line}: {e.message}
                      </li>
                    ))}
                  </ul>
                )}
              </AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={!csv || busy} onClick={() => run(true)}>
            Preview
          </Button>
          <Button disabled={!csv || busy} onClick={() => run(false)}>
            Import {fileName && `“${fileName}”`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
