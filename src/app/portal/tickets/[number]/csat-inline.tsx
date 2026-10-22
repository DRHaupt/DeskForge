"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const LABELS: Record<number, string[]> = { 3: ["Unhappy", "Okay", "Happy"], 5: ["Very unhappy", "Unhappy", "Okay", "Happy", "Very happy"] };
const FACES: Record<number, string[]> = { 3: ["🙁", "😐", "🙂"], 5: ["😠", "🙁", "😐", "🙂", "😄"] };

export function CsatInline({ token, rating: initial, scale, question }: { token: string; rating: number | null; scale: 3 | 5; question: string }) {
  const [rating, setRating] = useState<number | null>(initial);
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(Boolean(initial));
  const [thanks, setThanks] = useState(false);

  async function rate(r: number) {
    setRating(r);
    await api(`/api/v1/csat/${token}`, { body: { rating: r } });
    setSent(true);
  }

  return (
    <section aria-label="Rate your experience" className="mt-6 rounded-lg border bg-card p-4" aria-live="polite">
      <p className="font-medium">{question}</p>
      <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Rating">
        {LABELS[scale]!.map((label, i) => (
          <button
            key={label}
            role="radio"
            aria-checked={rating === i + 1}
            onClick={() => rate(i + 1)}
            className={cn("flex flex-col items-center rounded-lg border px-3 py-2 text-xs hover:bg-accent", rating === i + 1 && "border-primary bg-primary/10")}
          >
            <span className="text-2xl" aria-hidden>
              {FACES[scale]![i]}
            </span>
            {label}
          </button>
        ))}
      </div>
      {sent && !thanks && (
        <form
          className="mt-3 space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            await api(`/api/v1/csat/${token}`, { body: { rating, comment } });
            setThanks(true);
          }}
        >
          <label htmlFor="csat-comment" className="text-sm">
            Thanks! Anything you&apos;d like to add? (optional)
          </label>
          <Textarea id="csat-comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} />
          <Button size="sm" type="submit">
            Send
          </Button>
        </form>
      )}
      {thanks && <p className="mt-3 text-sm text-muted-foreground">Thank you — your feedback helps us improve.</p>}
    </section>
  );
}
