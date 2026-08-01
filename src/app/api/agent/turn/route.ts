import { NextResponse } from "next/server";
import { indexUtterance, retrieve } from "@/lib/moss";
import { nextTurn } from "@/lib/agent";
import { PATIENT } from "@/lib/case";
import type { ProsodicFeature } from "@/lib/prosody";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One agent turn, in the order the architecture requires:
 *
 *   1. The finalized utterance goes into the live session index immediately, so
 *      the conversation is searchable while it is still happening.
 *   2. Ambient retrieval fires across both indexes BEFORE the model is called.
 *      No retrieval tool, no second round trip.
 *   3. The model gets chart evidence and session evidence separated, and picks
 *      the next question.
 *
 * Retrieval is on the critical path. That is the claim, and this route is where
 * it is either true or it is not.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      visitId: string;
      utterance: { id: string; text: string };
      transcript: { speaker: "patient" | "agent"; text: string }[];
      acoustic?: ProsodicFeature[];
    };

    if (!body.visitId || !body.utterance?.text) {
      return NextResponse.json(
        { error: "visitId and utterance.text are required" },
        { status: 400 },
      );
    }

    const at = new Date().toISOString();

    // 1. Live indexing of what was just said.
    await indexUtterance({
      visitId: body.visitId,
      id: body.utterance.id,
      text: body.utterance.text,
      speaker: "patient",
      at,
    });

    // 2. Ambient retrieval, both indexes, before the model call.
    const retrieval = await retrieve({
      patientId: PATIENT.id,
      visitId: body.visitId,
      query: body.utterance.text,
      topK: 4,
    });

    // 3. The turn.
    const turn = await nextTurn({
      transcript: body.transcript ?? [],
      evidence: retrieval.evidence,
      acoustic: body.acoustic ?? [],
    });

    return NextResponse.json({
      turn,
      retrieval: {
        evidence: retrieval.evidence,
        timings: retrieval.timings,
        totalMs: retrieval.totalMs,
        indexesQueried: retrieval.indexesQueried,
      },
      at,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
