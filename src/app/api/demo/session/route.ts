import { NextResponse } from "next/server";
import { getMedplum, UNDERTONE_IDENTIFIER_SYSTEM } from "@/lib/medplum";
import { PATIENT } from "@/lib/case";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mint a short-lived Medplum access token for the careVet React demo so
 * @medplum/react components can read Luna's record in the browser.
 * Client secret never leaves the server.
 */
export async function GET() {
  try {
    const medplum = await getMedplum();
    const accessToken = medplum.getAccessToken();
    if (!accessToken) {
      return NextResponse.json(
        { error: "Medplum login produced no access token." },
        { status: 500 },
      );
    }

    const patient = await medplum.searchOne(
      "Patient",
      `identifier=${UNDERTONE_IDENTIFIER_SYSTEM}|${PATIENT.mrn}`,
    );
    if (!patient?.id) {
      return NextResponse.json(
        { error: "Run `npm run seed` first." },
        { status: 500 },
      );
    }

    const communication = await medplum.searchOne("Communication", {
      subject: `Patient/${patient.id}`,
      _sort: "-sent",
    });

    return NextResponse.json({
      baseUrl: env.medplum.baseUrl,
      accessToken,
      patientId: patient.id,
      patientReference: `Patient/${patient.id}`,
      communicationId: communication?.id ?? null,
      communicationReference: communication?.id
        ? `Communication/${communication.id}`
        : null,
      appUrl: process.env.NEXT_PUBLIC_MEDPLUM_APP_URL || "https://app.medplum.com",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
