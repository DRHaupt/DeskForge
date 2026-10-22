/** Small lookup helpers over a validated BusinessConfig. */
import type { BusinessConfig, FeatureName, TicketTypeConfig, WorkflowState } from "./schema";

export function isFeatureEnabled(cfg: BusinessConfig, feature: FeatureName): boolean {
  return cfg.features[feature] === true;
}

/** Ticket types that are active given the feature flags. */
export function activeTicketTypes(cfg: BusinessConfig): TicketTypeConfig[] {
  return cfg.ticketTypes.filter((t) => !t.feature || cfg.features[t.feature]);
}

export function getTicketTypeConfig(cfg: BusinessConfig, key: string): TicketTypeConfig | undefined {
  return cfg.ticketTypes.find((t) => t.key === key);
}

export function getState(type: TicketTypeConfig, stateKey: string): WorkflowState | undefined {
  return type.workflow.states.find((s) => s.key === stateKey);
}

/** Priority from the impact × urgency matrix. Falls back to the configured default. */
export function priorityFromMatrix(cfg: BusinessConfig, impact?: string | null, urgency?: string | null): string {
  if (!impact || !urgency) return cfg.priorities.default;
  return cfg.priorities.matrix[impact]?.[urgency] ?? cfg.priorities.default;
}

export function priorityLevel(cfg: BusinessConfig, key: string) {
  return cfg.priorities.levels.find((l) => l.key === key);
}

/** Index of a priority, 0 = most urgent. Unknown priorities sort last. */
export function priorityRank(cfg: BusinessConfig, key: string): number {
  const i = cfg.priorities.levels.findIndex((l) => l.key === key);
  return i === -1 ? cfg.priorities.levels.length : i;
}

/** One level more urgent, or the same if already the highest. */
export function raisePriority(cfg: BusinessConfig, key: string): string {
  const i = priorityRank(cfg, key);
  return cfg.priorities.levels[Math.max(0, Math.min(i, cfg.priorities.levels.length) - 1)]?.key ?? key;
}

/** Display-safe subset of the config that can be sent to the browser. */
export function publicConfig(cfg: BusinessConfig) {
  return {
    branding: cfg.branding,
    locale: { timezone: cfg.locale.timezone, language: cfg.locale.language, dateFormat: cfg.locale.dateFormat, timeFormat: cfg.locale.timeFormat },
    features: cfg.features,
    priorities: cfg.priorities,
  };
}
export type PublicConfig = ReturnType<typeof publicConfig>;
