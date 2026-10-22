"use client";

import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";

export function ArticleFeedback({ id }: { id: string }) {
  const [state, setState] = useState<"ask" | "comment" | "done">("ask");
  const [helpful, setHelpful] = useState<boolean | null>(null);
  const [comment, setComment] = useState("");

  async function send(h: boolean, c?: string) {
    await api(`/api/v1/kb/articles/${id}/feedback`, { body: { helpful: h, comment: c || undefined } }).catch(() => undefined);
  }

  return (
    <section aria-label="Article feedback" className="mt-10 border-t pt-6" aria-live="polite">
      {state === "ask" && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">Was this article helpful?</span>
          <Button variant="outline" size="sm" onClick={async () => { setHelpful(true); await send(true); setState("comment"); }}>
            <ThumbsUp /> Yes
          </Button>
          <Button variant="outline" size="sm" onClick={async () => { setHelpful(false); await send(false); setState("comment"); }}>
            <ThumbsDown /> No
          </Button>
        </div>
      )}
      {state === "comment" && (
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            await send(helpful!, comment);
            setState("done");
          }}
        >
          <label htmlFor="fb-comment" className="text-sm font-medium">
            Thanks! {helpful ? "Anything we could add?" : "What were you looking for?"} (optional)
          </label>
          <Textarea id="fb-comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
          <div className="flex gap-2">
            <Button size="sm" type="submit">
              Send
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setState("done")}>
              Skip
            </Button>
          </div>
        </form>
      )}
      {state === "done" && <p className="text-sm text-muted-foreground">Thanks for your feedback.</p>}
    </section>
  );
}
