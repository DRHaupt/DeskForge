/** Environment variables, validated once. Secrets and infrastructure only — business settings live in YAML. */
import { z } from "zod";

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  /** How often the worker checks SLA timers. Lower it only for tests. */
  SLA_SWEEP_SECONDS: z.coerce.number().int().min(1).max(3600).default(60),
  APP_BASE_URL: z.url().default("http://localhost:3000"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters (generate with: openssl rand -base64 48)"),
  BUSINESS_CONFIG_PATH: z.string().default("./business.config.yaml"),
  BRANDING_DIR: z.string().default("./branding"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),
  /** Reserved for multi-tenant mode. Must stay false in this release. */
  MULTI_TENANT: bool,

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_PATH: z.string().default("./storage"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool,
  UPLOAD_MAX_MB: z.coerce.number().positive().default(25),
  UPLOAD_ALLOWED_TYPES: z.string().optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: bool,
  INBOUND_EMAIL_SECRET: z.string().optional(),

  /** Allow webhooks to private/internal addresses (off by default to prevent SSRF). */
  WEBHOOK_ALLOW_PRIVATE: bool,
  /** Header holding the visitor's IP when a trusted proxy sets one (e.g. cf-connecting-ip behind a Cloudflare Tunnel). */
  CLIENT_IP_HEADER: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/, "must be a header name like cf-connecting-ip").optional()),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  SEED_ADMIN_EMAIL: z.string().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  • ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment variables:\n${lines.join("\n")}`);
  }
  if (result.data.MULTI_TENANT) {
    throw new Error("MULTI_TENANT=true is not supported yet. See DECISIONS.md (D-004).");
  }
  cached = result.data;
  return cached;
}

/** Reads a per-provider secret, e.g. envValue("OIDC_ENTRA", "CLIENT_ID"). */
export function envValue(prefix: string, suffix: string): string | undefined {
  const v = process.env[`${prefix}_${suffix}`];
  return v && v.length ? v : undefined;
}

/** Exposed for tests only. */
export const _envSchemaForTests = envSchema;
