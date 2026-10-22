"use client";

/** Renders custom field inputs from config (shared by agent console and portal). */
import type { FieldConfig } from "@/core/config/schema";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

const selectCls = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm aria-invalid:border-destructive";

export function FieldInputs({
  fields,
  values,
  onChange,
  errors = {},
  idPrefix = "f",
  assets,
  agents,
}: {
  fields: FieldConfig[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  errors?: Record<string, string | undefined>;
  idPrefix?: string;
  assets?: { id: string; label: string }[];
  agents?: { id: string; name: string }[];
}) {
  return (
    <>
      {fields.map((f) => {
        const id = `${idPrefix}-${f.key}`;
        const err = errors[f.key];
        const v = values[f.key];
        const describedBy = [f.helpText ? `${id}-help` : null, err ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;
        const common = { id, "aria-invalid": err ? true : undefined, "aria-describedby": describedBy, required: f.required };
        let control: React.ReactNode;
        switch (f.type) {
          case "textarea":
            control = <Textarea {...common} value={(v as string) ?? ""} onChange={(e) => onChange(f.key, e.target.value)} />;
            break;
          case "number":
            control = (
              <Input
                {...common}
                type="number"
                min={f.min}
                max={f.max}
                step="any"
                value={v === null || v === undefined ? "" : String(v)}
                onChange={(e) => onChange(f.key, e.target.value === "" ? null : Number(e.target.value))}
              />
            );
            break;
          case "date":
            control = <Input {...common} type="date" value={(v as string) ?? ""} onChange={(e) => onChange(f.key, e.target.value || null)} />;
            break;
          case "dropdown":
            control = (
              <select {...common} className={selectCls} value={(v as string) ?? ""} onChange={(e) => onChange(f.key, e.target.value || null)}>
                <option value="">{f.required ? "Choose…" : "—"}</option>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            );
            break;
          case "multiselect": {
            const arr = (v as string[]) ?? [];
            control = (
              <fieldset className="flex flex-wrap gap-x-4 gap-y-2" aria-describedby={describedBy}>
                <legend className="sr-only">{f.label}</legend>
                {f.options?.map((o) => (
                  <label key={o.value} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={arr.includes(o.value)} onCheckedChange={(on) => onChange(f.key, on ? [...arr, o.value] : arr.filter((x) => x !== o.value))} />
                    {o.label}
                  </label>
                ))}
              </fieldset>
            );
            break;
          }
          case "checkbox":
            control = (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox id={id} checked={v === true} onCheckedChange={(on) => onChange(f.key, on === true)} /> Yes
              </label>
            );
            break;
          case "asset":
            control = assets ? (
              <select {...common} className={selectCls} value={(v as string) ?? ""} onChange={(e) => onChange(f.key, e.target.value || null)}>
                <option value="">—</option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            ) : (
              <Input {...common} placeholder="Asset tag" value={(v as string) ?? ""} onChange={(e) => onChange(f.key, e.target.value || null)} />
            );
            break;
          case "user":
            control = agents ? (
              <select {...common} className={selectCls} value={(v as string) ?? ""} onChange={(e) => onChange(f.key, e.target.value || null)}>
                <option value="">—</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            ) : (
              <Input {...common} value={(v as string) ?? ""} onChange={(e) => onChange(f.key, e.target.value || null)} />
            );
            break;
          default:
            control = <Input {...common} value={(v as string) ?? ""} onChange={(e) => onChange(f.key, e.target.value)} maxLength={500} />;
        }
        return (
          <div key={f.key} className="space-y-1.5">
            {f.type !== "multiselect" ? (
              <Label htmlFor={id}>
                {f.label}
                {f.required && <span aria-hidden className="text-destructive">*</span>}
              </Label>
            ) : (
              <p className="text-sm font-medium">
                {f.label}
                {f.required && <span aria-hidden className="text-destructive">*</span>}
              </p>
            )}
            {control}
            {f.helpText && (
              <p id={`${id}-help`} className="text-xs text-muted-foreground">
                {f.helpText}
              </p>
            )}
            {err && (
              <p id={`${id}-err`} className="text-xs text-destructive">
                {err}
              </p>
            )}
          </div>
        );
      })}
    </>
  );
}
