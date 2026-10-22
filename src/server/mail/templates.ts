/**
 * Branded email templates. Inline styles only (email clients ignore <style>),
 * table layout, and a plain-text alternative for every message.
 */
import { getConfig } from "@/core/config/loader";
import { readableForeground } from "@/core/branding";
import { htmlToPlainText } from "../richtext";

export const REPLY_MARKER = "##- Please type your reply above this line -##";

export function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function appUrl(path = "") {
  return `${(process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "")}${path}`;
}

export type EmailContent = {
  /** Shown above the content, e.g. "Mia replied to your request". */
  heading: string;
  /** Sanitized HTML (comment body etc.). */
  bodyHtml?: string;
  /** Short paragraphs of plain text, escaped. */
  paragraphs?: string[];
  /** Key/value facts shown in a small table (ticket number, status…). */
  facts?: [string, string][];
  button?: { label: string; url: string };
  /** Include the "reply above this line" marker (ticket conversation emails). */
  replyable?: boolean;
  footerNote?: string;
};

export function renderEmail(c: EmailContent): { html: string; text: string } {
  const { branding } = getConfig();
  const primary = branding.colors.primary;
  const onPrimary = branding.colors.primaryForeground ?? readableForeground(primary);
  const logo = branding.logo ? (/^https?:\/\//.test(branding.logo) ? branding.logo : appUrl(`/branding/${branding.logo}`)) : null;
  const font = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";

  const parts: string[] = [];
  if (c.replyable) parts.push(`<p style="color:#94a3b8;font-size:12px;margin:0 0 16px">${escapeHtml(REPLY_MARKER)}</p>`);
  parts.push(`<h1 style="font-size:18px;line-height:1.4;margin:0 0 16px;color:#0f172a">${escapeHtml(c.heading)}</h1>`);
  for (const p of c.paragraphs ?? []) parts.push(`<p style="margin:0 0 12px;color:#334155">${escapeHtml(p)}</p>`);
  if (c.bodyHtml) parts.push(`<div style="margin:0 0 16px;padding:12px 16px;border-left:3px solid ${primary};background:#f8fafc;color:#0f172a">${c.bodyHtml}</div>`);
  if (c.facts?.length) {
    parts.push(
      `<table role="presentation" style="border-collapse:collapse;margin:0 0 16px;font-size:13px">${c.facts
        .map(([k, v]) => `<tr><td style="padding:2px 16px 2px 0;color:#64748b">${escapeHtml(k)}</td><td style="padding:2px 0;color:#0f172a">${escapeHtml(v)}</td></tr>`)
        .join("")}</table>`,
    );
  }
  if (c.button) {
    parts.push(
      `<p style="margin:20px 0"><a href="${escapeHtml(c.button.url)}" style="display:inline-block;background:${primary};color:${onPrimary};text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">${escapeHtml(c.button.label)}</a></p>`,
    );
  }

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(c.heading)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;${font}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0">
<tr><td style="background:${primary};padding:16px 24px;color:${onPrimary};font-size:16px;font-weight:600">${logo ? `<img src="${escapeHtml(logo)}" alt="" width="28" height="28" style="vertical-align:middle;margin-right:8px;border:0">` : ""}${escapeHtml(branding.name)}</td></tr>
<tr><td style="padding:24px;font-size:14px;line-height:1.6;${font}">${parts.join("\n")}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px">${c.footerNote ? `${escapeHtml(c.footerNote)}<br>` : ""}${escapeHtml(branding.footer || branding.name)} · <a href="mailto:${escapeHtml(branding.supportEmail)}" style="color:#64748b">${escapeHtml(branding.supportEmail)}</a></td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    c.replyable ? `${REPLY_MARKER}\n` : "",
    c.heading,
    "",
    ...(c.paragraphs ?? []),
    c.bodyHtml ? `\n${htmlToPlainText(c.bodyHtml)}\n` : "",
    ...(c.facts ?? []).map(([k, v]) => `${k}: ${v}`),
    c.button ? `\n${c.button.label}: ${c.button.url}` : "",
    "",
    "--",
    `${branding.footer || branding.name} · ${branding.supportEmail}`,
  ]
    .filter((l) => l !== undefined)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { html, text };
}
