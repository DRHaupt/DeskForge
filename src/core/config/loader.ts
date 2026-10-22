/**
 * Loads and validates business.config.yaml.
 *
 * Pure: no Next.js imports, safe to use from the app, the worker, scripts and tests.
 */
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml, YAMLParseError } from "yaml";
import type { z } from "zod";
import { businessConfigSchema, type BusinessConfig } from "./schema";

export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly issues: string[] = [],
  ) {
    super(issues.length ? `${message}\n${issues.map((i) => `  • ${i}`).join("\n")}` : message);
    this.name = "ConfigError";
  }
}

function formatPath(p: PropertyKey[]): string {
  return p.reduce<string>((acc, seg) => {
    if (typeof seg === "number") return `${acc}[${seg}]`;
    return acc ? `${acc}.${String(seg)}` : String(seg);
  }, "");
}

export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${formatPath(i.path) || "(root)"}: ${i.message}`);
}

/** Validate an already-parsed object. Throws ConfigError with every problem listed. */
export function parseBusinessConfig(raw: unknown, source = "business config"): BusinessConfig {
  const result = businessConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(`Invalid ${source}:`, formatIssues(result.error));
  }
  return result.data;
}

export function parseBusinessConfigYaml(text: string, source = "business config"): BusinessConfig {
  let raw: unknown;
  try {
    raw = parseYaml(text, { prettyErrors: true });
  } catch (err) {
    const msg = err instanceof YAMLParseError ? err.message : String(err);
    throw new ConfigError(`Could not parse ${source} as YAML:`, [msg]);
  }
  return parseBusinessConfig(raw, source);
}

export function resolveConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.BUSINESS_CONFIG_PATH ?? "business.config.yaml");
}

export function loadBusinessConfigFromFile(filePath: string): BusinessConfig {
  if (!fs.existsSync(filePath)) {
    throw new ConfigError(
      `Business config not found at ${filePath}. Copy one from examples/ or set BUSINESS_CONFIG_PATH.`,
    );
  }
  return parseBusinessConfigYaml(fs.readFileSync(filePath, "utf8"), filePath);
}

let cached: BusinessConfig | undefined;

/** Cached config for the current process. */
export function getConfig(): BusinessConfig {
  if (!cached) cached = loadBusinessConfigFromFile(resolveConfigPath());
  return cached;
}

/** For tests and hot reload. */
export function setConfig(cfg: BusinessConfig | undefined): void {
  cached = cfg;
}
