import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { ConfigError, parseBusinessConfig, parseBusinessConfigYaml } from "@/core/config/loader";
import { durationSchema } from "@/core/config/schema";
import { activeTicketTypes, priorityFromMatrix, raisePriority } from "@/core/config/helpers";

const examplesDir = path.resolve(import.meta.dirname, "../../examples");
const examples = fs.readdirSync(examplesDir).filter((f) => f.endsWith(".yaml"));
const load = (name: string) => parse(fs.readFileSync(path.join(examplesDir, name), "utf8"));

describe("example configs", () => {
  it("ships the three required examples", () => {
    expect(examples.sort()).toEqual(["ecommerce-support.yaml", "internal-it.yaml", "msp-it-support.yaml"]);
  });

  it.each(examples)("%s is valid", (file) => {
    const cfg = parseBusinessConfigYaml(fs.readFileSync(path.join(examplesDir, file), "utf8"), file);
    expect(cfg.branding.name).toBeTruthy();
    expect(cfg.ticketTypes.length).toBeGreaterThan(0);
  });

  it("ecommerce has no change management and CSAT on", () => {
    const cfg = parseBusinessConfig(load("ecommerce-support.yaml"));
    expect(cfg.features.changeManagement).toBe(false);
    expect(cfg.features.csat).toBe(true);
  });
});

describe("validation errors", () => {
  it("reports a clear path for unknown workflow states", () => {
    const raw = load("internal-it.yaml");
    raw.ticketTypes[0].workflow = { initial: "new", states: [{ key: "new", name: "New", category: "new" }], transitions: [{ from: ["new"], to: "nowhere" }] };
    expect(() => parseBusinessConfig(raw)).toThrowError(/ticketTypes\[0\]\.workflow\.transitions\[0\]\.to: unknown state "nowhere"/);
  });

  it("detects an incomplete priority matrix", () => {
    const raw = load("internal-it.yaml");
    delete raw.priorities.matrix.group.soon;
    expect(() => parseBusinessConfig(raw)).toThrowError(/priorities\.matrix\.group\.soon/);
  });

  it("rejects bad colors, emails and timezones together", () => {
    const raw = load("internal-it.yaml");
    raw.branding.colors.primary = "blue";
    raw.branding.supportEmail = "not-an-email";
    raw.locale.timezone = "Mars/Olympus";
    try {
      parseBusinessConfig(raw);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const issues = (e as ConfigError).issues.join("\n");
      expect(issues).toMatch(/branding\.colors\.primary/);
      expect(issues).toMatch(/branding\.supportEmail/);
      expect(issues).toMatch(/locale\.timezone/);
    }
  });

  it("rejects types whose feature is disabled", () => {
    const raw = load("msp-it-support.yaml");
    raw.features.changeManagement = false;
    expect(() => parseBusinessConfig(raw)).toThrowError(/features\.changeManagement is false/);
  });

  it("rejects invalid YAML with a parse error", () => {
    expect(() => parseBusinessConfigYaml("version: [1", "x.yaml")).toThrowError(/Could not parse x\.yaml as YAML/);
  });

  it("applies defaults", () => {
    const raw = load("internal-it.yaml");
    delete raw.features;
    delete raw.auth;
    const cfg = parseBusinessConfig(raw);
    expect(cfg.features.knowledgeBase).toBe(true);
    expect(cfg.features.publicSignup).toBe(false);
    expect(cfg.auth.local.passwordPolicy.minLength).toBe(12);
  });
});

describe("durations", () => {
  it.each([
    [30, 30],
    ["30m", 30],
    ["4h", 240],
    ["2d", 2880],
    ["1h30m", 90],
  ])("%s → %d minutes", (input, mins) => {
    expect(durationSchema.parse(input)).toBe(mins);
  });
  it("rejects garbage", () => {
    expect(durationSchema.safeParse("soon").success).toBe(false);
  });
});

describe("helpers", () => {
  const cfg = parseBusinessConfig(load("msp-it-support.yaml"));
  it("maps impact × urgency to priority", () => {
    expect(priorityFromMatrix(cfg, "company", "critical")).toBe("p1");
    expect(priorityFromMatrix(cfg, "individual", "normal")).toBe("p4");
    expect(priorityFromMatrix(cfg, undefined, "normal")).toBe("p3");
  });
  it("raises priority by one level", () => {
    expect(raisePriority(cfg, "p3")).toBe("p2");
    expect(raisePriority(cfg, "p1")).toBe("p1");
  });
  it("hides types of disabled modules", () => {
    const cfg2 = parseBusinessConfig(load("internal-it.yaml"));
    expect(activeTicketTypes(cfg2).map((t) => t.key)).toEqual(["incident", "service_request", "question", "task"]);
  });
});
