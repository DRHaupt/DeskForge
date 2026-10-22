/**
 * SLA timers as a pure state machine.
 *
 * `reconcileTimer` takes what the ticket looks like now and what the timer
 * looked like before, and returns what the timer should be. The server calls it
 * after every ticket change, which keeps timers correct however a ticket
 * changed (UI, email, API, automation) and makes the logic easy to test.
 *
 * Model: `elapsedMins` holds business minutes consumed before the current
 * running segment; while RUNNING, the segment's progress is implied by `dueAt`
 * (remaining = businessMinutesBetween(now, dueAt)).
 */
import { addBusinessMinutes, businessMinutesBetween, type Calendar } from "./calendar";

export type Metric = "FIRST_RESPONSE" | "RESOLUTION";
export type TimerStatus = "RUNNING" | "PAUSED" | "MET" | "BREACHED" | "CANCELLED";

export type Timer = {
  metric: Metric;
  status: TimerStatus;
  targetMins: number;
  startedAt: Date;
  dueAt: Date;
  warnAt: Date | null;
  pausedAt: Date | null;
  elapsedMins: number;
  stoppedAt: Date | null;
  breachedAt: Date | null;
  warnedAt: Date | null;
  /** Due date fixed by a human override; recalculation keeps it. */
  overridden: boolean;
};

export type SlaPolicyLite = {
  key: string;
  priorities: string[];
  ticketTypes: string[];
  firstResponseMins: number | null;
  resolutionMins: number | null;
  calendar: "BUSINESS_HOURS" | "ALWAYS";
  pauseStatuses: string[];
  warnAtPercent: number;
  order: number;
  isActive: boolean;
};

export type TicketFacts = {
  createdAt: Date;
  priority: string;
  typeKey: string;
  status: string;
  /** "new" | "open" | "pending" | "resolved" | "closed" */
  category: string;
  /** Workflow state has pausesSla: true */
  statePausesSla: boolean;
  firstRespondedAt: Date | null;
  resolvedAt: Date | null;
};

export function selectPolicy<P extends SlaPolicyLite>(policies: P[], ticket: Pick<TicketFacts, "priority" | "typeKey">): P | null {
  return (
    [...policies]
      .filter((p) => p.isActive)
      .sort((a, b) => a.order - b.order)
      .find((p) => p.priorities.includes(ticket.priority) && (p.ticketTypes.length === 0 || p.ticketTypes.includes(ticket.typeKey))) ?? null
  );
}

function warnAtFrom(segmentStart: Date, elapsed: number, target: number, pct: number, cal: Calendar): Date | null {
  const warnPoint = (target * pct) / 100;
  if (elapsed >= warnPoint) return null;
  return addBusinessMinutes(segmentStart, warnPoint - elapsed, cal);
}

/** Elapsed business minutes at `at` for a running timer. */
function elapsedAt(t: Timer, at: Date, cal: Calendar): number {
  if (t.status !== "RUNNING") return t.elapsedMins;
  const remaining = businessMinutesBetween(at, t.dueAt, cal);
  const overdue = at > t.dueAt ? businessMinutesBetween(t.dueAt, at, cal) : 0;
  return t.targetMins - remaining + overdue;
}

export function startTimer(metric: Metric, target: number, startedAt: Date, warnPct: number, cal: Calendar): Timer {
  return {
    metric,
    status: "RUNNING",
    targetMins: target,
    startedAt,
    dueAt: addBusinessMinutes(startedAt, target, cal),
    warnAt: warnAtFrom(startedAt, 0, target, warnPct, cal),
    pausedAt: null,
    elapsedMins: 0,
    stoppedAt: null,
    breachedAt: null,
    warnedAt: null,
    overridden: false,
  };
}

/**
 * Desired timer state. `prev` is null if no timer exists yet.
 * Returns null when the metric doesn't apply (no target in the policy).
 */
export function reconcileTimer(
  metric: Metric,
  prev: Timer | null,
  policy: SlaPolicyLite | null,
  ticket: TicketFacts,
  now: Date,
  cal: Calendar,
): Timer | null {
  const target = policy ? (metric === "FIRST_RESPONSE" ? policy.firstResponseMins : policy.resolutionMins) : null;

  if (!policy || !target) {
    if (!prev || prev.status === "MET" || prev.status === "BREACHED" || prev.status === "CANCELLED") return prev;
    return { ...prev, status: "CANCELLED", stoppedAt: now, warnAt: null };
  }

  const done = ticket.category === "resolved" || ticket.category === "closed";
  const stopAt =
    metric === "FIRST_RESPONSE"
      ? (ticket.firstRespondedAt ?? (done ? (ticket.resolvedAt ?? now) : null))
      : done
        ? (ticket.resolvedAt ?? now)
        : null;
  const paused = !stopAt && (policy.pauseStatuses.includes(ticket.status) || ticket.statePausesSla);

  let t: Timer = prev ? { ...prev } : startTimer(metric, target, ticket.createdAt, policy.warnAtPercent, cal);

  // Target changed (priority/type changed → different policy or values): keep elapsed, recompute due.
  if (prev && prev.targetMins !== target && !prev.overridden && (prev.status === "RUNNING" || prev.status === "PAUSED")) {
    const elapsed = elapsedAt(prev, now, cal);
    t.targetMins = target;
    if (prev.status === "RUNNING") {
      t.dueAt = elapsed >= target ? now : addBusinessMinutes(now, target - elapsed, cal);
      t.warnAt = t.warnedAt ? null : warnAtFrom(now, elapsed, target, policy.warnAtPercent, cal);
      t.elapsedMins = 0;
    } else {
      t.elapsedMins = elapsed;
    }
  }

  // Reopened: a stopped resolution timer continues from where it stopped.
  if ((t.status === "MET" || t.status === "BREACHED") && !stopAt && metric === "RESOLUTION") {
    const elapsed = t.elapsedMins;
    if (paused) return { ...t, status: "PAUSED", stoppedAt: null, pausedAt: now, elapsedMins: elapsed, warnAt: null };
    return {
      ...t,
      status: "RUNNING",
      stoppedAt: null,
      pausedAt: null,
      dueAt: elapsed >= t.targetMins ? now : addBusinessMinutes(now, t.targetMins - elapsed, cal),
      warnAt: t.warnedAt ? null : warnAtFrom(now, elapsed, t.targetMins, policy.warnAtPercent, cal),
      elapsedMins: 0,
    };
  }

  if (t.status === "MET" || t.status === "BREACHED" || t.status === "CANCELLED") return t;

  if (stopAt) {
    const at = stopAt < t.startedAt ? t.startedAt : stopAt;
    const elapsed = t.status === "PAUSED" ? t.elapsedMins : elapsedAt(t, at, cal);
    const breached = Boolean(t.breachedAt) || elapsed > t.targetMins + 1e-9;
    return { ...t, status: breached ? "BREACHED" : "MET", stoppedAt: at, elapsedMins: elapsed, pausedAt: null, warnAt: null, breachedAt: breached ? (t.breachedAt ?? t.dueAt) : null };
  }

  if (paused && t.status === "RUNNING") {
    return { ...t, status: "PAUSED", pausedAt: now, elapsedMins: elapsedAt(t, now, cal), warnAt: null };
  }
  if (!paused && t.status === "PAUSED") {
    const elapsed = t.elapsedMins;
    return {
      ...t,
      status: "RUNNING",
      pausedAt: null,
      dueAt: elapsed >= t.targetMins ? now : addBusinessMinutes(now, t.targetMins - elapsed, cal),
      warnAt: t.warnedAt ? null : warnAtFrom(now, elapsed, t.targetMins, policy.warnAtPercent, cal),
      elapsedMins: 0,
    };
  }
  return t;
}

/** Percentage of target used (for UI progress bars). */
export function percentUsed(t: Timer, now: Date, cal: Calendar): number {
  const elapsed = t.status === "RUNNING" ? elapsedAt(t, now, cal) : t.elapsedMins;
  return Math.round((elapsed / t.targetMins) * 100);
}
