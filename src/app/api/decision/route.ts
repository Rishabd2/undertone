import { NextResponse } from "next/server";
import { resolveActors } from "@/lib/medplum";
import { writeDecision } from "@/lib/writeback";
import { PATIENT } from "@/lib/case";
import type { ProsodicFeature } from "@/lib/prosody";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The clinician gate. Nothing reaches the record without passing through here,
 * and a rejection is recorded as carefully as an approval.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      decision: "approved" | "rejected";
      proposal: {
        id: string;
        summary: string;
        requestedAction: string;
        rationale: { transcript: string[]; chart: string[]; acoustic: string[] };
      };
      acoustic?: ProsodicFeature[];
      audioWindow?: { id: string; sha256: string; seconds: number };
      transcript?: { speaker: "patient" | "agent"; text: string }[];
    };

    if (body.decision !== "approved" && body.decision !== "rejected") {
      return NextResponse.json(
        { error: "decision must be approved or rejected" },
        { status: 400 },
      );
    }
    if (!body.proposal?.id) {
      return NextResponse.json({ error: "proposal is required" }, { status: 400 });
    }

    const actors = await resolveActors(PATIENT.mrn);
    const result = await writeDecision({
      ...actors,
      proposal: body.proposal,
      acoustic: body.acoustic ?? [],
      audioWindow: body.audioWindow,
      decision: body.decision,
      transcript: body.transcript ?? [],
    });

    return NextResponse.json({
      decision: body.decision,
      resources: result.resources,
      at: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
