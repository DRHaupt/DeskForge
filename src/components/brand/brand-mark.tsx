import { getConfig } from "@/core/config/loader";
import { brandingAssetUrl } from "@/core/branding";
import { cn } from "@/lib/utils";

/** Logo + business name from config. */
export function BrandMark({ className, showName = true, size = 32 }: { className?: string; showName?: boolean; size?: number }) {
  const { branding } = getConfig();
  const logo = brandingAssetUrl(branding.logo);
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold", className)}>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt={showName ? "" : branding.name} width={size} height={size} className="shrink-0 text-primary" />
      ) : (
        <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground" style={{ width: size, height: size }}>
          {branding.name.charAt(0)}
        </span>
      )}
      {showName && <span className="truncate">{branding.shortName ?? branding.name}</span>}
    </span>
  );
}
