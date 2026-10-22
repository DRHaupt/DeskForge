import { describe, expect, it } from "vitest";
import { brandCssVariables, brandingAssetUrl, contrastRatio, readableForeground } from "@/core/branding";

describe("branding", () => {
  it("picks a readable foreground", () => {
    expect(readableForeground("#1d4ed8")).toBe("#ffffff");
    expect(readableForeground("#fde047")).toBe("#0f172a");
  });
  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });
  it("emits css variables", () => {
    const css = brandCssVariables({ name: "x", supportEmail: "a@b.co", portalWelcome: "", footer: "", colors: { primary: "#15803d", accent: "#e11d48" } });
    expect(css).toContain("--brand-primary:#15803d");
    expect(css).toContain("--brand-primary-foreground:#ffffff");
  });
  it("resolves asset urls safely", () => {
    expect(brandingAssetUrl("logo.svg")).toBe("/branding/logo.svg");
    expect(brandingAssetUrl("https://cdn.example/logo.png")).toBe("https://cdn.example/logo.png");
    expect(brandingAssetUrl(undefined)).toBeUndefined();
  });
});
