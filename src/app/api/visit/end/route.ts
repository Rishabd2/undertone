import { NextResponse } from "next/server";
import { persistSession } from "@/lib/moss";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * End the visit and push the live session index to the cloud, so this
 * conversation is retrievable at the next visit. That is the longitudinal story
 * in one call.
 */
export async function POST(request: Request) {
  try {
    const { visitId } = (await request.json()) as { visitId?: string };
    if (!visitId) {
      return NextResponse.json({ error: "visitId is required" }, { status: 400 });
    }
    const result = await persistSession(visitId);
    return NextResponse.json({ ...result, at: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
