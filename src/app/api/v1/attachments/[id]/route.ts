import { apiRoute, idParams } from "@/server/api";
import { readAttachment } from "@/server/services/attachments";
import { getCurrentActor } from "@/server/session";
import { authenticateApiKey } from "@/server/api-keys";

const INLINE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain"]);

/** Public KB attachments work without signing in, so authentication is checked inside. */
export const GET = apiRoute({ public: true, params: idParams }, async ({ req, params }) => {
  const authz = req.headers.get("authorization");
  const actor = authz?.startsWith("Bearer ") ? await authenticateApiKey(authz.slice(7).trim()) : await getCurrentActor();
  const { att, data } = await readAttachment(actor, params.id);
  const inline = INLINE.has(att.contentType) && new URL(req.url).searchParams.get("download") !== "1";
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": INLINE.has(att.contentType) ? att.contentType : "application/octet-stream",
      "content-length": String(data.length),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
});
