import { getConfig } from "@/core/config/loader";

export default function PortalHome() {
  const { branding } = getConfig();
  return (
    <section className="bg-primary/5">
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{branding.name}</h1>
        <p className="mt-4 whitespace-pre-line text-muted-foreground">{branding.portalWelcome}</p>
      </div>
    </section>
  );
}
