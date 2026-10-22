"use client";

/**
 * Rich text editor (Tiptap) with @mentions of agents. Emits HTML; the server
 * sanitizes it again, so nothing here is trusted.
 */
import { useEffect, useImperativeHandle, type Ref } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Mention from "@tiptap/extension-mention";
import { Placeholder } from "@tiptap/extensions";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import { Bold, Code, Italic, Link2, List, ListOrdered, Quote, Strikethrough } from "lucide-react";
import { cn } from "@/lib/utils";

type Agent = { id: string; name: string; email: string };

async function fetchAgents(query: string): Promise<Agent[]> {
  const res = await fetch(`/api/v1/lookup/agents?q=${encodeURIComponent(query)}`, { credentials: "same-origin" });
  return res.ok ? res.json() : [];
}

/** Minimal DOM popup for the mention suggestion list (keyboard + mouse). */
function mentionRenderer() {
  let el: HTMLDivElement | null = null;
  let items: Agent[] = [];
  let index = 0;
  let command: ((a: { id: string; label: string }) => void) | null = null;

  const draw = () => {
    if (!el) return;
    el.innerHTML = "";
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "px-2 py-1.5 text-sm text-muted-foreground";
      empty.textContent = "No matching agents";
      el.appendChild(empty);
      return;
    }
    items.forEach((a, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "option");
      b.setAttribute("aria-selected", String(i === index));
      b.className = `block w-full rounded px-2 py-1.5 text-left text-sm ${i === index ? "bg-accent" : ""}`;
      b.textContent = a.name;
      const small = document.createElement("span");
      small.className = "ml-2 text-xs text-muted-foreground";
      small.textContent = a.email;
      b.appendChild(small);
      b.onmousedown = (e) => {
        e.preventDefault();
        command?.({ id: a.id, label: a.name });
      };
      el!.appendChild(b);
    });
  };
  const place = (rect: DOMRect | null | undefined) => {
    if (!el || !rect) return;
    el.style.left = `${Math.min(rect.left, window.innerWidth - 300) + window.scrollX}px`;
    const height = el.offsetHeight || 200;
    const below = rect.bottom + height + 8 < window.innerHeight;
    el.style.top = `${(below ? rect.bottom + 4 : rect.top - height - 4) + window.scrollY}px`;
  };

  return {
    onStart(props: SuggestionProps<Agent>) {
      el = document.createElement("div");
      el.setAttribute("role", "listbox");
      el.className = "absolute z-[60] w-72 rounded-md border bg-popover p-1 shadow-md";
      document.body.appendChild(el);
      items = props.items;
      index = 0;
      command = props.command as never;
      draw();
      place(props.clientRect?.());
    },
    onUpdate(props: SuggestionProps<Agent>) {
      items = props.items;
      index = Math.min(index, Math.max(0, items.length - 1));
      command = props.command as never;
      draw();
      place(props.clientRect?.());
    },
    onKeyDown({ event }: SuggestionKeyDownProps) {
      if (event.key === "ArrowDown") {
        index = (index + 1) % Math.max(1, items.length);
        draw();
        return true;
      }
      if (event.key === "ArrowUp") {
        index = (index - 1 + items.length) % Math.max(1, items.length);
        draw();
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const a = items[index];
        if (a) command?.({ id: a.id, label: a.name });
        return true;
      }
      if (event.key === "Escape") {
        el?.remove();
        el = null;
        return true;
      }
      return false;
    },
    onExit() {
      el?.remove();
      el = null;
    },
  };
}

export type RichTextEditorHandle = { clear: () => void; focus: () => void; getHTML: () => string; isEmpty: () => boolean };

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  mentions = false,
  ariaLabel,
  className,
  minHeight = 120,
  ref,
}: {
  value?: string;
  onChange?: (html: string) => void;
  placeholder?: string;
  mentions?: boolean;
  ariaLabel: string;
  className?: string;
  minHeight?: number;
  ref?: Ref<RichTextEditorHandle>;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"] } }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
      ...(mentions
        ? [
            Mention.configure({
              HTMLAttributes: { class: "mention" },
              suggestion: { char: "@", items: ({ query }) => fetchAgents(query), render: mentionRenderer },
            }),
          ]
        : []),
    ],
    content: value ?? "",
    editorProps: {
      attributes: {
        class: "prose-df focus:outline-none px-3 py-2",
        style: `min-height:${minHeight}px`,
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": ariaLabel,
      },
    },
    onUpdate: ({ editor }) => onChange?.(editor.getHTML()),
  });

  useImperativeHandle(ref, () => ({
    clear: () => editor?.commands.clearContent(true),
    focus: () => editor?.commands.focus(),
    getHTML: () => editor?.getHTML() ?? "",
    isEmpty: () => editor?.isEmpty ?? true,
  }));

  // Reset when the parent swaps the value (e.g. inserting a canned response).
  useEffect(() => {
    if (editor && value !== undefined && value !== editor.getHTML()) editor.commands.setContent(value, { emitUpdate: false });
  }, [value, editor]);

  return (
    <div className={cn("rounded-md border border-input bg-background focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring", className)}>
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return <div className="h-9 border-b" />;
  const btn = (label: string, active: boolean, onClick: () => void, Icon: typeof Bold) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={cn("inline-flex size-7 items-center justify-center rounded hover:bg-accent", active && "bg-accent text-foreground")}
    >
      <Icon className="size-4" />
    </button>
  );
  return (
    <div role="toolbar" aria-label="Formatting" className="flex flex-wrap gap-0.5 border-b px-1.5 py-1 text-muted-foreground">
      {btn("Bold", editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), Bold)}
      {btn("Italic", editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), Italic)}
      {btn("Strikethrough", editor.isActive("strike"), () => editor.chain().focus().toggleStrike().run(), Strikethrough)}
      {btn("Bulleted list", editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run(), List)}
      {btn("Numbered list", editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), ListOrdered)}
      {btn("Quote", editor.isActive("blockquote"), () => editor.chain().focus().toggleBlockquote().run(), Quote)}
      {btn("Code", editor.isActive("codeBlock"), () => editor.chain().focus().toggleCodeBlock().run(), Code)}
      {btn("Link", editor.isActive("link"), () => {
        const prev = editor.getAttributes("link").href as string | undefined;
        const url = window.prompt("Link URL", prev ?? "https://");
        if (url === null) return;
        if (url === "") editor.chain().focus().unsetLink().run();
        else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
      }, Link2)}
    </div>
  );
}
