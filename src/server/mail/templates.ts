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
  /**
   * Plain-text paragraphs, escaped. Line breaks are kept; a paragraph whose
   * lines all start with "- " becomes a bulleted list.
   */
  paragraphs?: string[];
  /** Key/value facts shown in a small table (ticket number, status…). */
  facts?: [string, string][];
  button?: { label: string; url: string };
  /** Include the "reply above this line" marker (ticket conversation emails). */
  replyable?: boolean;
  /** Small print under the signature, e.g. why the person got this email. */
  footerNote?: string;
  /** Inbox preview text (hidden in the body). */
  preheader?: string;
  /** Sign-off lines, e.g. ["Thanks,", "IT Support"]. */
  signature?: string[];
};

const FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;";

function isList(p: string): boolean {
  const lines = p.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((l) => l.startsWith("- "));
}

function paragraphHtml(p: string): string {
  if (isList(p)) {
    const items = p.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => `<li style="margin:0 0 6px">${escapeHtml(l.slice(2))}</li>`);
    return `<ul style="margin:0 0 16px;padding:0 0 0 20px;color:#374151">${items.join("")}</ul>`;
  }
  return `<p style="margin:0 0 16px;color:#374151">${p.split("\n").map((l) => escapeHtml(l.trim())).join("<br>")}</p>`;
}

/** Raster logos only: most email clients block SVG images. */
function emailLogoUrl(logo: string | undefined): string | null {
  if (!logo || !/\.(png|jpe?g|gif)(\?.*)?$/i.test(logo)) return null;
  return /^https?:\/\//.test(logo) ? logo : appUrl(`/branding/${logo}`);
}

/**
 * Restrained, business-letter layout: name or logo, a short message, one
 * button with the link also written out, a sign-off and a plain footer.
 */
export function renderEmail(c: EmailContent): { html: string; text: string } {
  const { branding } = getConfig();
  const primary = branding.colors.primary;
  const onPrimary = branding.colors.primaryForeground ?? readableForeground(primary);
  const logo = emailLogoUrl(branding.logo);

  const parts: string[] = [];
  if (c.replyable) parts.push(`<p style="color:#9ca3af;font-size:12px;margin:0 0 20px">${escapeHtml(REPLY_MARKER)}</p>`);
  parts.push(`<h1 style="font-size:20px;line-height:1.35;font-weight:600;margin:0 0 20px;color:#111827">${escapeHtml(c.heading)}</h1>`);
  for (const p of c.paragraphs ?? []) parts.push(paragraphHtml(p));
  if (c.bodyHtml) parts.push(`<div style="margin:0 0 20px;padding:2px 0 2px 16px;border-left:3px solid #e5e7eb;color:#111827">${c.bodyHtml}</div>`);
  if (c.facts?.length) {
    parts.push(
      `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 20px;font-size:14px">${c.facts
        .map(([k, v]) => `<tr><td style="padding:3px 20px 3px 0;color:#6b7280;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:3px 0;color:#111827">${escapeHtml(v)}</td></tr>`)
        .join("")}</table>`,
    );
  }
  if (c.button) {
    const url = escapeHtml(c.button.url);
    parts.push(
      `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px"><tr><td style="border-radius:4px;background:${primary}"><a href="${url}" style="display:inline-block;padding:11px 22px;font-size:15px;font-weight:600;color:${onPrimary};text-decoration:none;border-radius:4px">${escapeHtml(c.button.label)}</a></td></tr></table>`,
      `<p style="margin:0 0 20px;font-size:13px;color:#6b7280">If the button doesn't work, copy this link into your browser:<br><a href="${url}" style="color:#6b7280;word-break:break-all">${url}</a></p>`,
    );
  }
  if (c.signature?.length) {
    parts.push(`<p style="margin:24px 0 0;color:#374151">${c.signature.map((l) => escapeHtml(l)).join("<br>")}</p>`);
  }

  const brandCell = logo
    ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(branding.name)}" height="32" style="display:block;height:32px;width:auto;border:0">`
    : `<span style="font-size:15px;font-weight:600;color:#111827">${escapeHtml(branding.name)}</span>`;
  const footer = [c.footerNote ? escapeHtml(c.footerNote) : "", `${escapeHtml(branding.footer || branding.name)} · <a href="mailto:${escapeHtml(branding.supportEmail)}" style="color:#9ca3af">${escapeHtml(branding.supportEmail)}</a>`]
    .filter(Boolean)
    .join("<br>");
  const preheader = c.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(c.preheader)}${"&#8202;&zwnj;".repeat(40)}</div>`
    : "";

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>${escapeHtml(c.heading)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;${FONT}">${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:4px">
<tr><td style="padding:24px 32px;border-bottom:1px solid #f0f1f3">${brandCell}</td></tr>
<tr><td style="padding:32px;font-size:15px;line-height:1.6;color:#374151;${FONT}">${parts.join("\n")}</td></tr>
</table>
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%"><tr><td style="padding:16px 32px;font-size:12px;line-height:1.5;color:#9ca3af;${FONT}">${footer}</td></tr></table>
</td></tr></table></body></html>`;

  const text = [
    c.replyable ? `${REPLY_MARKER}\n` : "",
    c.heading,
    "",
    ...(c.paragraphs ?? []).flatMap((p) => [p, ""]),
    c.bodyHtml ? `${htmlToPlainText(c.bodyHtml)}\n` : "",
    ...(c.facts ?? []).map(([k, v]) => `${k}: ${v}`),
    c.button ? `\n${c.button.label}:\n${c.button.url}\n` : "",
    ...(c.signature?.length ? ["", ...c.signature] : []),
    "",
    "--",
    ...(c.footerNote ? [c.footerNote] : []),
    `${branding.footer || branding.name} · ${branding.supportEmail}`,
  ]
    .filter((l) => l !== undefined)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { html, text };
}
