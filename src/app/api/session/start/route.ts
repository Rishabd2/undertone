import { NextResponse } from "next/server";
import { grantToken, buildListenParams } from "@/lib/deepgram";
import { resolveActors } from "@/lib/medplum";
import { ensureChartLoaded, getSession } from "@/lib/moss";
import { PATIENT, VISIT, CHART, chartKeyterms } from "@/lib/case";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start a visit.
 *
 * Order matters here and is the whole point of the Deepgram integration: the
 * chart is read BEFORE the socket opens, so the keyterms handed to the
 * recognizer come from this patient's medications, problems, and allergies. A
 * different patient primes a different vocabulary.
 */
export async function POST() {
  try {
    const visitId = `visit-${Date.now()}`;

    // Chart first. The recognizer is configured from it.
    const keyterms = chartKeyterms();
    const listen = buildListenParams(keyterms);

    const [actors, token] = await Promise.all([
      resolveActors(PATIENT.mrn),
      grantToken(120),
    ]);

    // Warm both indexes so the first retrieval of the call is not the slow one.
    await Promise.all([
      ensureChartLoaded(PATIENT.id).catch(() => undefined),
      getSession(visitId).catch(() => undefined),
    ]);

    return NextResponse.json({
      visitId,
      actors,
      token: token.accessToken,
      tokenExpiresIn: token.expiresIn,
      listen: { model: listen.model, query: listen.query, keyterms },
      patient: {
        name: PATIENT.name,
        age: PATIENT.ageYears,
        descriptor: `${PATIENT.genderStatus.display} ${PATIENT.breed.text} · ${PATIENT.weightKg} kg`,
        owner: PATIENT.ownerName,
        mrn: PATIENT.mrn,
        banner: PATIENT.banner,
      },
      visit: VISIT,
      chart: CHART.map((c) => ({
        id: c.id,
        label: c.label,
        date: c.date,
        category: c.category,
        resourceType: c.resourceType,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
