/** Structured JSON logging (pino). Pipe through `pino-pretty` in development if you like. */
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  base: { service: process.env.DESKFORGE_SERVICE ?? (/src[\\/]worker[\\/]index\.ts$/.test(process.argv[1] ?? "") ? "worker" : "app") },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ["password", "*.password", "passwordHash", "*.passwordHash", "secret", "*.secret", "token", "*.token", "authorization", "*.authorization", "cookie", "*.cookie"],
    censor: "[redacted]",
  },
});

export type Logger = typeof logger;
