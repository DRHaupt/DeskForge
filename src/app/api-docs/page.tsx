import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand/brand-mark";
import { buildOpenApi } from "@/server/openapi";

export const metadata: Metadata = { title: "API reference" };
export const dynamic = "force-dynamic";

const METHOD_COLORS: Record<string, string> = {
  get: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  post: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  patch: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  put: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  delete: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
};

type Op = { tags: string[]; summary: string; description: string; parameters: { name: string; in: string; required: boolean }[]; requestBody?: { content: Record<string, { schema: unknown }> } };

/** Human-readable API reference rendered from the generated OpenAPI document. */
export default function ApiDocs() {
  const spec = buildOpenApi();
  const ops = Object.entries(spec.paths).flatMap(([path, methods]) => Object.entries(methods as Record<string, Op>).map(([method, op]) => ({ path, method, op })));
  const tags = [...new Set(ops.map((o) => o.op.tags[0]!))];
  return (
    <main id="main" className="mx-auto max-w-5xl px-4 py-10">
      <BrandMark size={32} />
      <h1 className="mt-6 text-3xl font-semibold">{spec.info.title}</h1>
      <p className="mt-2 max-w-3xl text-muted-foreground">{spec.info.description}</p>
      <p className="mt-2 text-sm">
        Base URL: <code className="rounded bg-muted px-1">{spec.servers[0]!.url}</code> · Machine-readable spec:{" "}
        <Link href="/api/v1/openapi.json" className="text-primary hover:underline">
          openapi.json
        </Link>
      </p>
      <section className="mt-6 rounded-lg border bg-muted/30 p-4 text-sm">
        <h2 className="font-semibold">Webhook signatures</h2>
        <p className="mt-1">
          Every webhook POST carries <code>{spec["x-webhooks"].signature}</code>. Compute the HMAC over the timestamp, a dot and the raw body with your webhook&apos;s secret, compare in constant time,
          and reject timestamps older than 5 minutes.
        </p>
      </section>
      <nav aria-label="Sections" className="mt-6 flex flex-wrap gap-2 text-sm">
        {tags.map((t) => (
          <a key={t} href={`#${t.replace(/\s/g, "-")}`} className="rounded-md border px-2 py-1 hover:bg-accent">
            {t}
          </a>
        ))}
      </nav>
      {tags.map((tag) => (
        <section key={tag} id={tag.replace(/\s/g, "-")} className="mt-10">
          <h2 className="mb-3 text-xl font-semibold">{tag}</h2>
          <div className="space-y-3">
            {ops
              .filter((o) => o.op.tags[0] === tag)
              .map(({ path, method, op }) => (
                <details key={method + path} className="group rounded-lg border">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-2.5">
                    <span className={`w-16 rounded px-2 py-0.5 text-center font-mono text-xs font-semibold uppercase ${METHOD_COLORS[method]}`}>{method}</span>
                    <code className="text-sm">{path}</code>
                    <span className="text-sm text-muted-foreground">{op.summary}</span>
                  </summary>
                  <div className="space-y-3 border-t px-4 py-3 text-sm">
                    <p>{op.description}</p>
                    {op.parameters.length > 0 && (
                      <div>
                        <p className="font-medium">Parameters</p>
                        <ul className="mt-1 list-disc pl-5">
                          {op.parameters.map((p) => (
                            <li key={p.in + p.name}>
                              <code>{p.name}</code> <span className="text-muted-foreground">({p.in}{p.required ? ", required" : ""})</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {op.requestBody && (
                      <div>
                        <p className="font-medium">Request body ({Object.keys(op.requestBody.content)[0]})</p>
                        <pre className="mt-1 max-h-80 overflow-auto rounded bg-muted p-3 text-xs">{JSON.stringify(Object.values(op.requestBody.content)[0]!.schema, null, 2)}</pre>
                      </div>
                    )}
                  </div>
                </details>
              ))}
          </div>
        </section>
      ))}
    </main>
  );
}
