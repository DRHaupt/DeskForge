import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseBusinessConfigYaml, setConfig } from "@/core/config/loader";
import { renderEmail } from "@/server/mail/templates";

const yaml = fs.readFileSync(path.resolve(import.meta.dirname, "../../examples/internal-it.yaml"), "utf8");

describe("email template", () => {
  it("renders lists, a written-out link, signature and preview text", () => {
    setConfig(parseBusinessConfigYaml(yaml));
    const { html, text } = renderEmail({
      heading: "Set up your account",
      preheader: "Your account is ready",
      paragraphs: ["Hi Jamie,", "Please:\n", "- Sign in\n- Set up MFA", "Line one\nLine two"],
      button: { label: "Set up your account", url: "https://help.example/welcome?email=a%40b.c" },
      signature: ["Thank you,", "IT Support"],
      footerNote: "You're receiving this because…",
    });
    expect(html).toContain("<ul");
    expect(html).toContain("<li style=\"margin:0 0 6px\">Sign in</li>");
    expect(html).toContain("Line one<br>Line two");
    expect(html).toContain("If the button doesn't work, copy this link into your browser:");
    expect(html.match(/https:\/\/help\.example\/welcome\?email=a%40b\.c/g)?.length).toBe(3); // button href, link text, link href
    expect(html).toContain("Thank you,<br>IT Support");
    expect(html).toContain("Your account is ready");
    expect(text).toContain("- Sign in\n- Set up MFA");
    expect(text).toContain("Set up your account:\nhttps://help.example/welcome?email=a%40b.c");
    expect(text).toContain("Thank you,\nIT Support");
  });

  it("uses raster logos only (most email clients block SVG)", () => {
    setConfig(parseBusinessConfigYaml(yaml)); // logo.svg
    expect(renderEmail({ heading: "x" }).html).not.toContain("<img");
    setConfig(parseBusinessConfigYaml(yaml.replace("logo: logo.svg", "logo: logo.png")));
    expect(renderEmail({ heading: "x" }).html).toMatch(/<img src="[^"]*\/branding\/logo\.png"/);
  });

  it("shows a square logo next to the name, or the wide email logo on its own", () => {
    setConfig(parseBusinessConfigYaml(yaml.replace("logo: logo.svg", "logo: icon.png")));
    const square = renderEmail({ heading: "x" }).html;
    expect(square).toMatch(/<img src="[^"]*\/branding\/icon\.png" alt="" width="32"/);
    expect(square).toMatch(/<span style="font-size:15px;font-weight:600;color:#111827">[^<]+<\/span>/);
    setConfig(parseBusinessConfigYaml(yaml.replace("logo: logo.svg", "logo: icon.png\n  emailLogo: wide.png")));
    const wide = renderEmail({ heading: "x" }).html;
    expect(wide).toMatch(/<img src="[^"]*\/branding\/wide\.png" alt="[^"]+" height="36"/);
    expect(wide).not.toContain("icon.png");
  });
});
