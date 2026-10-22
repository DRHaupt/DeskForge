/** Browser-side JSON fetch helper for our own API routes. Throws ApiClientError with the server message. */
export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly data: unknown,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(url: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(url, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers: opts.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
    signal: opts.signal,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const issues = data?.issues?.fieldErrors as Record<string, string[]> | undefined;
    const fieldMsg = issues ? Object.entries(issues).map(([k, v]) => `${k}: ${v.join(", ")}`).join("; ") : "";
    throw new ApiClientError(fieldMsg || data?.error || `Request failed (${res.status})`, res.status, data);
  }
  return data as T;
}
