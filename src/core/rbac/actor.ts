/**
 * The "actor" is whoever is performing an operation: a signed-in user,
 * an API key, or the system (worker jobs, automations). Domain services take
 * an actor and check permissions themselves, so rules hold no matter which
 * entry point (UI, REST API, worker) calls them.
 */
import type { Permission } from "./permissions";

export type UserActor = {
  kind: "user";
  id: string;
  email: string;
  name: string;
  roles: string[];
  permissions: Set<Permission>;
  organizationId: string | null;
  orgTicketAccess: boolean;
  teamIds: string[];
};

export type ApiKeyActor = {
  kind: "api_key";
  id: string;
  name: string;
  /** User who created the key; API calls act with that user's identity for authorship. */
  userId: string | null;
  roles: string[];
  permissions: Set<Permission>;
  teamIds: string[];
};

export type SystemActor = { kind: "system"; label: string };

export type Actor = UserActor | ApiKeyActor | SystemActor;

export const SYSTEM_ACTOR: SystemActor = { kind: "system", label: "system" };

export function systemActor(label: string): SystemActor {
  return { kind: "system", label };
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(public readonly permission?: string, message?: string) {
    super(message ?? (permission ? `Missing permission: ${permission}` : "Forbidden"));
    this.name = "ForbiddenError";
  }
}

export function can(actor: Actor, permission: Permission): boolean {
  if (actor.kind === "system") return true;
  return actor.permissions.has(permission);
}

export function canAny(actor: Actor, permissions: Permission[]): boolean {
  return permissions.some((p) => can(actor, p));
}

export function assertCan(actor: Actor, permission: Permission): void {
  if (!can(actor, permission)) throw new ForbiddenError(permission);
}

export function assertCanAny(actor: Actor, permissions: Permission[]): void {
  if (!canAny(actor, permissions)) throw new ForbiddenError(permissions.join(" | "));
}

/** The user id to record as author/creator, if any. */
export function actorUserId(actor: Actor): string | null {
  if (actor.kind === "user") return actor.id;
  if (actor.kind === "api_key") return actor.userId;
  return null;
}

export function actorLabel(actor: Actor): string {
  if (actor.kind === "user") return actor.email;
  if (actor.kind === "api_key") return `api-key:${actor.name}`;
  return `system:${actor.label}`;
}

/** Agents are users who can work queues (as opposed to requesters). */
export function isAgent(actor: Actor): boolean {
  return actor.kind !== "system" && canAny(actor, ["ticket.view_team", "ticket.view_all"]);
}
