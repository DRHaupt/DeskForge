/** Theme helpers: turn config colors into CSS variables with accessible contrast. */
import type { BusinessConfig } from "./config/schema";

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

/** White or near-black, whichever reads better on the given background. */
export function readableForeground(bg: string): string {
  return contrastRatio(bg, "#ffffff") >= contrastRatio(bg, "#0f172a") ? "#ffffff" : "#0f172a";
}

export function brandCssVariables(branding: BusinessConfig["branding"]): string {
  const { primary, accent } = branding.colors;
  const fg = branding.colors.primaryForeground ?? readableForeground(primary);
  return `:root{--brand-primary:${primary};--brand-accent:${accent};--brand-primary-foreground:${fg};}`;
}

/** URL for a branding asset: absolute URLs pass through, file names are served from /branding. */
export function brandingAssetUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/^https?:\/\//.test(value)) return value;
  return `/branding/${value.replace(/^\/+/, "")}`;
}
