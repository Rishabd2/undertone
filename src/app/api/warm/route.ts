import { NextResponse } from "next/server";
import { ensureChartLoaded } from "@/lib/moss";
import { PATIENT } from "@/lib/case";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pull the Moss index into memory before the demo starts.
 *
 * The first retrieval of a cold process takes about two seconds because it
 * downloads and loads the index. Every one after is 8 to 17ms. Two seconds of
 * silence in the middle of a phone call is very obvious, so this gets called
 * once during setup and the call never pays for it.
 */
export async function GET() {
  const started = performance.now();
  try {
    await ensureChartLoaded(PATIENT.id);
    return NextResponse.json({
      warm: true,
      ms: Math.round(performance.now() - started),
    });
  } catch (err) {
    return NextResponse.json(
      { warm: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
