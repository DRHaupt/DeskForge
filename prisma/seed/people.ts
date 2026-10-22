/** Demo people derived from the business config, so every example seeds sensibly. */
import type { BusinessConfig } from "../../src/core/config/schema";

const FIRST = ["Avery", "Jamie", "Morgan", "Riley", "Casey", "Quinn", "Rowan", "Skyler", "Drew", "Parker", "Reese", "Hayden", "Emerson", "Finley", "Kendall", "Logan", "Marlowe", "Sage"];
const LAST = ["Nguyen", "Garcia", "Okoro", "Schmidt", "Kowalski", "Haddad", "Fischer", "Tanaka", "Moreau", "Larsen", "Ibrahim", "Costa", "Byrne", "Varga", "Lindqvist", "Mensah", "Rossi", "Ahmed"];

export function nameFromEmail(email: string): string {
  return email
    .split("@")[0]!
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase() + p.slice(1))
    .join(" ");
}

export function supportDomain(cfg: BusinessConfig): string {
  return cfg.branding.supportEmail.split("@")[1]!;
}

export type SeedPerson = { email: string; name: string; roles: string[]; orgSlug?: string };

export function demoPeople(cfg: BusinessConfig): SeedPerson[] {
  const domain = supportDomain(cfg);
  const people = new Map<string, SeedPerson>();
  const add = (p: SeedPerson) => {
    const existing = people.get(p.email);
    if (existing) existing.roles = [...new Set([...existing.roles, ...p.roles])];
    else people.set(p.email, p);
  };

  add({ email: process.env.SEED_ADMIN_EMAIL?.toLowerCase() ?? `admin@${domain}`, name: "Site Administrator", roles: ["admin"] });
  for (const t of cfg.teams) {
    for (const e of t.leads) add({ email: e.toLowerCase(), name: nameFromEmail(e), roles: ["team_lead"] });
    for (const e of t.members) add({ email: e.toLowerCase(), name: nameFromEmail(e), roles: ["agent"] });
  }
  // A lead is also an agent; keep only the stronger role.
  for (const p of people.values()) if (p.roles.includes("team_lead")) p.roles = p.roles.filter((r) => r !== "agent");
  add({ email: `auditor@${domain}`, name: "Audit Reviewer", roles: ["auditor"] });

  // Requesters: a few per organization, or generic customers when there are none.
  let i = 0;
  const requesterDomains = cfg.organizations.length
    ? cfg.organizations.flatMap((o) => (o.domains[0] ? [{ domain: o.domains[0], slug: o.slug }] : []))
    : [{ domain: "customer.example", slug: undefined }];
  const perOrg = cfg.organizations.length ? 3 : 10;
  for (const d of requesterDomains) {
    for (let n = 0; n < perOrg; n++) {
      const first = FIRST[i % FIRST.length]!;
      const last = LAST[(i * 7) % LAST.length]!;
      i++;
      add({ email: `${first}.${last}@${d.domain}`.toLowerCase(), name: `${first} ${last}`, roles: ["requester"], orgSlug: d.slug });
    }
  }
  return [...people.values()];
}
