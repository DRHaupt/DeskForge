import type { Metadata } from "next";
import { headers } from "next/headers";
import { getConfig } from "@/core/config/loader";
import { brandCssVariables, brandingAssetUrl } from "@/core/branding";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { branding } = getConfig();
  const favicon = brandingAssetUrl(branding.favicon);
  return {
    title: { default: branding.name, template: `%s · ${branding.shortName ?? branding.name}` },
    description: branding.portalWelcome.split("\n")[0],
    icons: favicon ? { icon: favicon } : undefined,
    robots: { index: false, follow: false },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cfg = getConfig();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang={cfg.locale.language}>
      <head>
        <style nonce={nonce} dangerouslySetInnerHTML={{ __html: brandCssVariables(cfg.branding) }} />
      </head>
      <body className="min-h-screen">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded focus:bg-background focus:px-3 focus:py-2 focus:shadow">
          Skip to content
        </a>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
