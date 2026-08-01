import { NextResponse } from "next/server";
import type { Observation, Provenance } from "@medplum/fhirtypes";
import { getMedplum, UNDERTONE_IDENTIFIER_SYSTEM } from "@/lib/medplum";
import { PATIENT } from "@/lib/case";
import { written } from "@/lib/medplum-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the record looks like right now.
 *
 * The live view polls this instead of any in-process state, because the record
 * IS the state. Vapi talks to whichever process is hosting the webhook, but
 * both that process and this one read the same Medplum project, so the call is
 * visible from anywhere. That is the whole argument, made load-bearing.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const minutes = Number(url.searchParams.get("minutes") ?? 30);
    const since = new Date(Date.now() - minutes * 60_000).toISOString();

    const medplum = await getMedplum();
    const patient = await medplum.searchOne(
      "Patient",
      `identifier=${UNDERTONE_IDENTIFIER_SYSTEM}|${PATIENT.mrn}`,
    );
    if (!patient?.id) {
      return NextResponse.json({ error: "Run `npm run seed` first." }, { status: 500 });
    }

    // Everything the agent has written to this animal since the call started.
    const [observations, provenances] = await Promise.all([
      medplum.searchResources("Observation", {
        subject: `Patient/${patient.id}`,
        status: "preliminary",
        _lastUpdated: `gt${since}`,
        _sort: "_lastUpdated",
        _count: "50",
      }),
      medplum.searchResources("Provenance", {
        _lastUpdated: `gt${since}`,
        _sort: "_lastUpdated",
        _count: "100",
      }),
    ]);

    // Provenance is what makes a field "stated" or "inferred", so the join is
    // the point, not an implementation detail.
    const sourceByTarget = new Map<string, "stated" | "inferred">();
    const provenanceIdByTarget = new Map<string, string>();
    for (const p of provenances as Provenance[]) {
      for (const target of p.target ?? []) {
        if (!target.reference) continue;
        const isStated = /informant/i.test(
          p.agent?.[0]?.type?.coding?.[0]?.code ?? "",
        );
        sourceByTarget.set(target.reference, isStated ? "stated" : "inferred");
        if (p.id) provenanceIdByTarget.set(target.reference, p.id);
      }
    }

    const fields = (observations as Observation[]).map((o) => {
      const ref = `Observation/${o.id}`;
      const note = o.note?.[0]?.text ?? "";
      const quoted = note.match(/Owner's words: "(.+)"$/);
      return {
        label: o.code?.text ?? "Field",
        value: o.valueString ?? "",
        source: sourceByTarget.get(ref) ?? "inferred",
        quote: quoted?.[1],
        at: o.meta?.lastUpdated,
        observation: written(ref, o.code?.text ?? "field"),
        provenance: provenanceIdByTarget.has(ref)
          ? written(`Provenance/${provenanceIdByTarget.get(ref)}`, "who said it")
          : undefined,
      };
    });

    // Anything else the call produced, newest first.
    const [appointments, compositions, tasks, communications] = await Promise.all([
      medplum.searchResources("Appointment", {
        _lastUpdated: `gt${since}`,
        _count: "5",
      }),
      medplum.searchResources("Composition", {
        subject: `Patient/${patient.id}`,
        _lastUpdated: `gt${since}`,
        _count: "5",
      }),
      medplum.searchResources("Task", {
        _lastUpdated: `gt${since}`,
        _count: "5",
      }),
      medplum.searchResources("Communication", {
        subject: `Patient/${patient.id}`,
        _lastUpdated: `gt${since}`,
        _count: "5",
      }),
    ]);

    return NextResponse.json({
      patientId: patient.id,
      fields,
      stated: fields.filter((f) => f.source === "stated").length,
      inferred: fields.filter((f) => f.source === "inferred").length,
      outcomes: [
        ...appointments.map((a) =>
          written(`Appointment/${a.id}`, `booked ${a.start ?? ""}`),
        ),
        ...communications.map((c) =>
          written(`Communication/${c.id}`, "the call itself"),
        ),
        ...compositions.map((c) =>
          written(`Composition/${c.id}`, "intake summary"),
        ),
        ...tasks.map((t) =>
          written(`Task/${t.id}`, `${t.intent} for the veterinarian`),
        ),
      ],
      at: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
