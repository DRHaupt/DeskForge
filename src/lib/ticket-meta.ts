/** Serializable config subset passed from server components to ticket UI components. */
import type { BusinessConfig, FieldConfig } from "@/core/config/schema";
import { activeTicketTypes } from "@/core/config/helpers";

export type TicketMeta = {
  timezone: string;
  priorities: { key: string; name: string; color?: string }[];
  impact: { key: string; name: string }[];
  urgency: { key: string; name: string }[];
  matrix: Record<string, Record<string, string>>;
  riskLevels: { key: string; name: string }[];
  types: {
    key: string;
    name: string;
    description?: string;
    portalVisible: boolean;
    /** Module the type belongs to (problem/change management), if any. */
    feature?: "problemManagement" | "changeManagement";
    fields: FieldConfig[];
    states: { key: string; name: string; category: string; color?: string; portalName?: string }[];
  }[];
};

export function buildTicketMeta(cfg: BusinessConfig): TicketMeta {
  return {
    timezone: cfg.locale.timezone,
    priorities: cfg.priorities.levels,
    impact: cfg.priorities.impact,
    urgency: cfg.priorities.urgency,
    matrix: cfg.priorities.matrix,
    riskLevels: cfg.itsm.riskLevels,
    types: activeTicketTypes(cfg).map((t) => ({
      key: t.key,
      name: t.name,
      description: t.description,
      portalVisible: t.portalVisible,
      feature: t.feature,
      fields: t.fields,
      states: t.workflow.states.map((s) => ({ key: s.key, name: s.name, category: s.category, color: s.color, portalName: s.portalName })),
    })),
  };
}

export function stateLabel(meta: TicketMeta, typeKey: string, status: string, portal = false): string {
  const s = meta.types.find((t) => t.key === typeKey)?.states.find((x) => x.key === status);
  if (!s) return status;
  return portal ? (s.portalName ?? s.name) : s.name;
}

export function stateColor(meta: TicketMeta, typeKey: string, status: string): string | undefined {
  return meta.types.find((t) => t.key === typeKey)?.states.find((x) => x.key === status)?.color;
}
