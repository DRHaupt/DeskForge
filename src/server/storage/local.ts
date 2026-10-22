import fs from "node:fs/promises";
import path from "node:path";
import type { StorageDriver } from "./index";

export class LocalStorage implements StorageDriver {
  readonly name = "local" as const;
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(/*turbopackIgnore: true*/ root);
  }

  private resolve(key: string): string {
    const p = path.resolve(/*turbopackIgnore: true*/ this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw new Error("invalid storage key");
    return p;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const p = this.resolve(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, data, { mode: 0o640 });
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }
}
