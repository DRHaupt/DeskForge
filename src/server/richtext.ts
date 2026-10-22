/**
 * Rich text (HTML from the editor or from email) is sanitized on the way in and
 * stored together with a plain-text copy for search, emails and previews.
 */
import sanitizeHtml from "sanitize-html";
import { convert } from "html-to-text";

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "strong", "b", "em", "i", "u", "s", "strike", "code", "pre", "blockquote",
    "ul", "ol", "li", "a", "h1", "h2", "h3", "h4", "hr", "span", "table", "thead", "tbody", "tr", "th", "td", "img", "div",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    span: ["data-type", "data-id", "data-label", "class"],
    img: ["src", "alt", "width", "height"],
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan"],
  },
  allowedClasses: { span: ["mention"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["https", "cid"] },
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer nofollow", target: "_blank" }),
  },
  // Drop the contents of these entirely (not just the tags).
  nonTextTags: ["style", "script", "textarea", "option", "noscript", "title", "head"],
};

export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, OPTIONS).trim();
}

export function htmlToPlainText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "a", options: { ignoreHref: true } },
      { selector: "img", format: "skip" },
    ],
  }).trim();
}

/** Plain text → minimal safe HTML (used for API callers and email bodies without HTML). */
export function plainTextToHtml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function richText(html: string): { html: string; text: string } {
  const clean = sanitizeRichText(html);
  return { html: clean, text: htmlToPlainText(clean) };
}

export function excerpt(text: string, max = 200): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
