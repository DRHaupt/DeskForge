import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getConfig } from "@/core/config/loader";
import { BrandMark } from "@/components/brand/brand-mark";
import { CsatInline } from "@/app/portal/tickets/[number]/csat-inline";
import { answerSurvey, getSurvey } from "@/server/services/csat";

export const metadata: Metadata = { title: "Rate your experience" };
export const dynamic = "force-dynamic";

/** Landing page for the one-click rating links in the survey email. */
export default async function CsatPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ rating?: string }> }) {
  const cfg = getConfig();
  if (!cfg.features.csat) notFound();
  const { token } = await params;
  const { rating } = await searchParams;
  let survey;
  try {
    survey = await getSurvey(token);
  } catch {
    notFound();
  }
  const r = Number(rating);
  if (r >= 1 && r <= cfg.csat.scale) {
    await answerSurvey(token, { rating: r }).catch(() => undefined);
    survey = await getSurvey(token);
  }
  return (
    <main id="main" className="mx-auto max-w-xl px-4 py-16">
      <BrandMark size={36} className="text-lg" />
      <h1 className="mt-6 text-xl font-semibold">
        Your request {survey.ticket.number}: {survey.ticket.title}
      </h1>
      <CsatInline token={token} rating={survey.rating} scale={cfg.csat.scale} question={cfg.csat.question} />
    </main>
  );
}
