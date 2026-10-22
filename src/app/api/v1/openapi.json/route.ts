import { NextResponse } from "next/server";
import { buildOpenApi } from "@/server/openapi";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(buildOpenApi(), { headers: { "cache-control": "public, max-age=300" } });
}
