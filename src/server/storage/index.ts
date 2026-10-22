/**
 * File storage abstraction: local volume (default) or any S3-compatible service.
 */
import { createHash, randomUUID } from "node:crypto";
import { getEnv } from "../env";
import { LocalStorage } from "./local";
import { S3Storage } from "./s3";

export interface StorageDriver {
  readonly name: "local" | "s3";
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

let driver: StorageDriver | undefined;

export function getStorage(): StorageDriver {
  if (driver) return driver;
  const env = getEnv();
  driver = env.STORAGE_DRIVER === "s3" ? new S3Storage(env) : new LocalStorage(env.STORAGE_LOCAL_PATH);
  return driver;
}

/** Test hook. */
export function setStorage(d: StorageDriver | undefined) {
  driver = d;
}

/** Keys are random and date-prefixed; the original filename is stored only in the database. */
export function newStorageKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}`;
}

export function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

// ─── Upload policy ─────────────────────────────────────────────────────────

const DEFAULT_ALLOWED = [
  "image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain", "text/csv",
  "application/zip", "application/x-zip-compressed", "application/json", "message/rfc822",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-outlook", ".log", ".txt", ".eml", ".msg",
];

/** Extensions never accepted, whatever the MIME type claims. */
const BLOCKED_EXTENSIONS = new Set(["exe", "bat", "cmd", "com", "msi", "scr", "ps1", "vbs", "js", "jar", "sh", "dll", "html", "htm", "svg", "hta", "app", "dmg", "iso"]);

export function uploadPolicy() {
  const env = getEnv();
  const allowed = env.UPLOAD_ALLOWED_TYPES ? env.UPLOAD_ALLOWED_TYPES.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) : DEFAULT_ALLOWED;
  return { maxBytes: env.UPLOAD_MAX_MB * 1024 * 1024, allowed };
}

export function checkUpload(filename: string, contentType: string, size: number): string | null {
  const { maxBytes, allowed } = uploadPolicy();
  if (size === 0) return "File is empty";
  if (size > maxBytes) return `File is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`;
  const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
  if (BLOCKED_EXTENSIONS.has(ext)) return `.${ext} files are not allowed`;
  const type = contentType.toLowerCase().split(";")[0]!.trim();
  if (!allowed.includes(type) && !allowed.includes(`.${ext}`)) return `File type ${type || ext || "unknown"} is not allowed`;
  return null;
}

/** Strip path components and control characters from a client-supplied filename. */
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "_").trim().slice(0, 200);
  return cleaned || "file";
}
