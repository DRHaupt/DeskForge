import { apiRoute, HttpError } from "@/server/api";
import { storeAttachment } from "@/server/services/attachments";
import { uploadPolicy } from "@/server/storage";

/** multipart/form-data with a single "file" field. Returns the attachment id to reference when posting. */
export const POST = apiRoute({ permission: ["ticket.create", "ticket.reply", "ticket.comment_internal", "kb.author"], rateLimit: 60, auditAction: "attachment.upload" }, async ({ actor, req }) => {
  const { maxBytes } = uploadPolicy();
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > maxBytes + 64 * 1024) throw new HttpError(413, `File is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") throw new HttpError(400, 'Expected multipart form data with a "file" field');
  const data = Buffer.from(await file.arrayBuffer());
  return storeAttachment(actor, { name: file.name, type: file.type, data });
});
