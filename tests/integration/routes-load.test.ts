/** Every API route module must load: apiRoute() validates its options at import time. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/server/session", () => ({ getCurrentActor: async () => null }));

const root = path.resolve(import.meta.dirname, "../../src/app");
function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? routeFiles(p) : e.name === "route.ts" ? [p] : [];
  });
}

describe("API route modules", () => {
  const files = routeFiles(path.join(root, "api")).filter((f) => !f.includes(`${path.sep}auth${path.sep}`));
  it("finds the routes", () => expect(files.length).toBeGreaterThan(50));
  for (const file of files) {
    it(`loads ${path.relative(root, file)}`, async () => {
      const mod = await import(file);
      const handlers = ["GET", "POST", "PATCH", "PUT", "DELETE"].filter((m) => typeof mod[m] === "function");
      expect(handlers.length).toBeGreaterThan(0);
    });
  }
});
