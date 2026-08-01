import { NextResponse } from "next/server";
import type {
  Appointment,
  Communication,
  Composition,
  Immunization,
  Observation,
  Patient,
  Provenance,
  RelatedPerson,
  Task,
} from "@medplum/fhirtypes";
import { getMedplum, UNDERTONE_IDENTIFIER_SYSTEM } from "@/lib/medplum";
import { PATIENT } from "@/lib/case";
import { written } from "@/lib/medplum-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ANIMAL_EXT = "http://hl7.org/fhir/StructureDefinition/patient-animal";
const LOINC = "http://loinc.org";

/**
 * Luna's record, shaped for the careVet walkthrough.
 * Every id is a real Medplum resource the UI can deep-link.
 */
export async function GET() {
  try {
    const medplum = await getMedplum();
    const on = (value: string) =>
      `identifier=${UNDERTONE_IDENTIFIER_SYSTEM}|${value}`;

    const patient = await medplum.searchOne("Patient", on(PATIENT.mrn));
    if (!patient?.id) {
      return NextResponse.json(
        { error: "Run `npm run seed` first." },
        { status: 500 },
      );
    }
    const subject = `Patient/${patient.id}`;

    const [
      owners,
      weights,
      immunizations,
      intakeObs,
      provenances,
      appointments,
      compositions,
      communications,
      tasks,
    ] = await Promise.all([
      medplum.searchResources("RelatedPerson", { patient: subject }),
      medplum.searchResources("Observation", {
        subject,
        code: `${LOINC}|29463-7`,
        _sort: "-date",
        _count: "5",
      }),
      medplum.searchResources("Immunization", { patient: subject }),
      medplum.searchResources("Observation", {
        subject,
        status: "preliminary",
        _sort: "-_lastUpdated",
        _count: "60",
      }),
      medplum.searchResources("Provenance", {
        _sort: "-_lastUpdated",
        _count: "200",
      }),
      medplum.searchResources("Appointment", {
        actor: subject,
        _sort: "-date",
        _count: "5",
      }),
      medplum.searchResources("Composition", {
        subject,
        _sort: "-date",
        _count: "3",
      }),
      medplum.searchResources("Communication", {
        subject,
        _sort: "-sent",
        _count: "3",
      }),
      medplum.searchResources("Task", {
        subject,
        _sort: "-_lastUpdated",
        _count: "5",
      }),
    ]);

    const sourceByTarget = new Map<string, "stated" | "inferred">();
    const provenanceByTarget = new Map<string, string>();
    for (const p of provenances as Provenance[]) {
      for (const t of p.target ?? []) {
        if (!t.reference) continue;
        const stated = /informant/i.test(
          p.agent?.[0]?.type?.coding?.[0]?.code ?? "",
        );
        sourceByTarget.set(t.reference, stated ? "stated" : "inferred");
        if (p.id) provenanceByTarget.set(t.reference, p.id);
      }
    }

    const intakeByLabel = new Map<
      string,
      {
        label: string;
        value: string;
        source: "stated" | "inferred";
        quote?: string;
        at?: string;
        observation: ReturnType<typeof written>;
        provenance?: ReturnType<typeof written>;
      }
    >();
    for (const o of intakeObs as Observation[]) {
      const ref = `Observation/${o.id}`;
      const label = o.code?.text ?? "Field";
      const note = o.note?.[0]?.text ?? "";
      const quoted = note.match(/Owner's words: "(.+)"$/);
      const field = {
        label,
        value: o.valueString ?? "",
        source: sourceByTarget.get(ref) ?? ("inferred" as const),
        quote: quoted?.[1],
        at: o.meta?.lastUpdated,
        observation: written(ref, label),
        provenance: provenanceByTarget.has(ref)
          ? written(`Provenance/${provenanceByTarget.get(ref)}`, "who said it")
          : undefined,
      };
      const prev = intakeByLabel.get(label);
      if (!prev || (field.at ?? "") > (prev.at ?? "")) {
        intakeByLabel.set(label, field);
      }
    }

    const animal = (patient as Patient).extension?.find(
      (e) => e.url === ANIMAL_EXT,
    );
    const sub = (url: string) =>
      animal?.extension?.find((e) => e.url === url)?.valueCodeableConcept;

    const owner = (owners as RelatedPerson[])[0];
    const imm = (immunizations as Immunization[])[0];
    const appointment = (appointments as Appointment[])[0];
    const composition = (compositions as Composition[])[0];
    const communication = (communications as Communication[])[0];
    const task = (tasks as Task[])[0];

    return NextResponse.json({
      patient: {
        id: patient.id,
        name: patient.name?.[0]?.text ?? PATIENT.name,
        species: sub("species")?.text ?? PATIENT.species.text,
        breed: sub("breed")?.text ?? PATIENT.breed.text,
        genderStatus: sub("genderStatus")?.text ?? PATIENT.genderStatus.display,
        birthDate: patient.birthDate ?? PATIENT.birthDate,
        url: written(`Patient/${patient.id}`, "Luna").url,
      },
      owner: owner
        ? {
            name: owner.name?.[0]?.text ?? PATIENT.ownerName,
            phone: owner.telecom?.[0]?.value ?? PATIENT.ownerPhone,
            url: owner.id
              ? written(`RelatedPerson/${owner.id}`, "owner").url
              : undefined,
          }
        : {
            name: PATIENT.ownerName,
            phone: PATIENT.ownerPhone,
          },
      weights: (weights as Observation[]).map((o) => ({
        value: o.valueQuantity?.value,
        unit: o.valueQuantity?.unit ?? "kg",
        date: o.effectiveDateTime,
        url: written(`Observation/${o.id}`, "weight").url,
        reference: `Observation/${o.id}`,
      })),
      immunization: imm
        ? {
            label: imm.vaccineCode?.text ?? "Rabies",
            date: imm.occurrenceDateTime,
            note: imm.note?.[0]?.text,
            overdue: /overdue/i.test(
              imm.note?.map((n) => n.text).join(" ") ?? "",
            ),
            url: written(`Immunization/${imm.id}`, "rabies").url,
            reference: `Immunization/${imm.id}`,
          }
        : null,
      intake: [...intakeByLabel.values()].sort((a, b) =>
        (b.at ?? "").localeCompare(a.at ?? ""),
      ),
      appointment: appointment
        ? {
            start: appointment.start,
            status: appointment.status,
            description: appointment.description,
            url: written(`Appointment/${appointment.id}`, "booked").url,
            reference: `Appointment/${appointment.id}`,
          }
        : null,
      composition: composition
        ? {
            title: composition.title,
            url: written(`Composition/${composition.id}`, "intake summary").url,
            reference: `Composition/${composition.id}`,
          }
        : null,
      communication: communication
        ? {
            topic: communication.topic?.text,
            sent: communication.sent,
            utterances: (communication.payload ?? [])
              .map((p) => p.contentString)
              .filter((t): t is string => Boolean(t)),
            url: written(`Communication/${communication.id}`, "the call").url,
            reference: `Communication/${communication.id}`,
          }
        : null,
      task: task
        ? {
            description: task.description,
            intent: task.intent,
            url: written(`Task/${task.id}`, "proposal").url,
            reference: `Task/${task.id}`,
          }
        : null,
      at: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
