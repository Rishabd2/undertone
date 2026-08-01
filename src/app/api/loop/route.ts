import { NextResponse } from "next/server";
import { runLoop } from "@/lib/loop";
import { PATIENT } from "@/lib/case";
import { patientUrl } from "@/lib/medplum-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Run the whole intake loop against Medplum and return what it wrote.
 *
 * Every resource in the response is a real id in the caller's Medplum project.
 * The console renders each one as a link into the Medplum app, because the
 * claim being made is that the record is real, and a link is the cheapest way
 * to let someone check.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      utterances?: string[];
      callerPhone?: string;
    };

    const utterances = body.utterances?.length
      ? body.utterances
      : [
          "Hi, it's Maria. Luna's been limping on her back left leg since yesterday evening.",
          "She jumped off the couch and yelped. She's putting some weight on it but not much.",
          "She's still eating fine and drinking normally. No vomiting.",
        ];

    const result = await runLoop({
      callerPhone: body.callerPhone ?? PATIENT.ownerPhone,
      utterances,
    });

    return NextResponse.json({
      ...result,
      patientUrl: patientUrl(result.patientId),
      utterances,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
