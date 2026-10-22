/** Render a search snippet where matches are wrapped in «…» (from ts_headline) without using HTML. */
export function Highlight({ text }: { text: string }) {
  const parts = text.split(/(«[^»]*»)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("«") && p.endsWith("»") ? (
          <mark key={i} className="rounded bg-yellow-200/70 px-0.5 text-inherit dark:bg-yellow-500/30">
            {p.slice(1, -1)}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}
