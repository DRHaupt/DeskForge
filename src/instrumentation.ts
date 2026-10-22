/**
 * Runs once when the Next.js server starts. Validates env + business config so a
 * broken deployment fails immediately with a readable error instead of at the
 * first request.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
