import { getEnv } from "./server/env";
import { getConfig, resolveConfigPath } from "./core/config/loader";
import { logger } from "./server/logger";

try {
  getEnv();
  const cfg = getConfig();
  logger.info({ config: resolveConfigPath(), business: cfg.branding.name }, "DeskForge configuration loaded");
} catch (err) {
  // Print plainly (not JSON) so the message is readable in `docker compose logs`.
  console.error(`\n✖ DeskForge cannot start:\n${(err as Error).message}\n`);
  process.exit(1);
}
