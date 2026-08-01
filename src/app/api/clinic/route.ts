import { NextResponse } from "next/server";
import type {
  Appointment,
  Communication,
  Composition,
  Immunization,
  Observation,
  Patient,
  Provenance,
  Task,
} from "@medplum/fhirtypes";
import { getMedplum } from "@/lib/medplum";
import { written } from "@/lib/medplum-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ANIMAL_EXT = "http://hl7.org/fhir/StructureDefinition/patient-animal";

/**
 * Everything the clinician dashboard needs, in one call.
 *
 * Medplum is a headless FHIR backend: app.medplum.com is an admin console for
 * developers, and the clinical UI is the thing you build on top. This route is
 * the read side of that UI. It does no interpretation, it only assembles.
 */
export async function GET() {
  try {
    const medplum = await getMedplum();

    const patients = await medplum.searchResources("Patient", {
      _sort: "-_lastUpdated",
      _count: "20",
    });

    const roster = await Promise.all(
      (patients as Patient[]).map(async (p) => {
        const animal = p.extension?.find((e) => e.url === ANIMAL_EXT);
        const sub = (url: string) =>
          animal?.extension?.find((e) => e.url === url)?.valueCodeableConcept;

        const [appts, tasks] = await Promise.all([
          medplum.searchResources("Appointment", {
            actor: `Patient/${p.id}`,
            _sort: "-date",
            _count: "1",
          }),
          medplum.searchResources("Task", {
            subject: `Patient/${p.id}`,
            status: "requested",
            _count: "5",
          }),
        ]);

        return {
          id: p.id!,
          name: p.name?.[0]?.text ?? p.name?.[0]?.given?.[0] ?? "Unnamed",
          species: sub("species")?.text,
          breed: sub("breed")?.text,
          genderStatus: sub("genderStatus")?.text,
          birthDate: p.birthDate,
          nextAppointment: appts[0]?.start,
          openTasks: tasks.length,
          url: written(`Patient/${p.id}`, "").url,
        };
      }),
    );

    // The review queue. This is the doctor's inbox.
    const inbox = await medplum.searchResources("Task", {
      status: "requested",
      _sort: "-_lastUpdated",
      _count: "20",
    });

    const queue = await Promise.all(
      (inbox as Task[]).map(async (t) => {
        const subjectRef = t.for?.reference;
        const patient = subjectRef
          ? (patients as Patient[]).find(
              (p) => `Patient/${p.id}` === subjectRef,
            )
          : undefined;
        return {
          id: t.id!,
          description: t.description ?? "Review",
          intent: t.intent,
          priority: t.priority,
          authoredOn: t.authoredOn,
          patientName: patient?.name?.[0]?.text ?? "Unknown",
          patientId: patient?.id,
          composition: t.focus?.reference,
          url: written(`Task/${t.id}`, "").url,
        };
      }),
    );

    return NextResponse.json({ roster, queue, at: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
