/** Validate a business config file without starting the app: `npm run config:check [path]`. */
import { loadBusinessConfigFromFile, resolveConfigPath } from "../src/core/config/loader";

const file = process.argv[2] ?? resolveConfigPath();
try {
  const cfg = loadBusinessConfigFromFile(file);
  console.log(`✔ ${file} is valid — ${cfg.branding.name}`);
  console.log(`  ${cfg.ticketTypes.length} ticket types, ${cfg.teams.length} teams, ${cfg.sla.policies.length} SLA policies`);
  console.log(`  features: ${Object.entries(cfg.features).filter(([, v]) => v).map(([k]) => k).join(", ")}`);
} catch (err) {
  console.error(`✖ ${(err as Error).message}`);
  process.exit(1);
}
