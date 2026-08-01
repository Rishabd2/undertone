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
import { getMedplum } from "@/lib/medplum";
import { written } from "@/lib/medplum-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ANIMAL_EXT = "http://hl7.org/fhir/StructureDefinition/patient-animal";

/** One animal's chart, assembled for a clinician rather than for a developer. */
export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const medplum = await getMedplum();
    const patient = await medplum.readResource("Patient", id);
    const subject = `Patient/${id}`;

    const [
      owners,
      observations,
      weightObs,
      immunizations,
      appointments,
      compositions,
      communications,
      tasks,
      provenances,
    ] = await Promise.all([
      medplum.searchResources("RelatedPerson", { patient: subject }),
      medplum.searchResources("Observation", {
        subject,
        status: "preliminary",
        _sort: "-_lastUpdated",
        _count: "60",
      }),
      medplum.searchResources("Observation", {
        subject,
        code: "http://loinc.org|29463-7",
        _sort: "-date",
        _count: "5",
      }),
      medplum.searchResources("Immunization", { patient: subject }),
      medplum.searchResources("Appointment", { actor: subject, _sort: "-date" }),
      medplum.searchResources("Composition", { subject, _sort: "-date" }),
      medplum.searchResources("Communication", { subject, _sort: "-sent" }),
      medplum.searchResources("Task", { subject, _sort: "-_lastUpdated" }),
      medplum.searchResources("Provenance", { _count: "200", _sort: "-_lastUpdated" }),
    ]);

    // Provenance is what separates "the owner said it" from "the agent guessed".
    const sourceByTarget = new Map<string, "stated" | "inferred">();
    for (const p of provenances as Provenance[]) {
      for (const t of p.target ?? []) {
        if (!t.reference) continue;
        sourceByTarget.set(
          t.reference,
          /informant/i.test(p.agent?.[0]?.type?.coding?.[0]?.code ?? "")
            ? "stated"
            : "inferred",
        );
      }
    }

    const obs = observations as Observation[];
    const intakeRaw = obs
      .filter((o) => o.status === "preliminary")
      .map((o) => {
        const ref = `Observation/${o.id}`;
        const note = o.note?.[0]?.text ?? "";
        const quoted = note.match(/Owner's words: "(.+)"$/);
        return {
          label: o.code?.text ?? "Field",
          value: o.valueString ?? "",
          source: sourceByTarget.get(ref) ?? ("inferred" as const),
          quote: quoted?.[1],
          at: o.meta?.lastUpdated,
          url: written(ref, "").url,
          reference: ref,
        };
      });

    // Rehearsals leave many copies of the same field. Keep the newest per label.
    const intakeByLabel = new Map<string, (typeof intakeRaw)[number]>();
    for (const field of intakeRaw) {
      const prev = intakeByLabel.get(field.label);
      if (!prev || (field.at ?? "") > (prev.at ?? "")) {
        intakeByLabel.set(field.label, field);
      }
    }
    const intake = [...intakeByLabel.values()].sort((a, b) =>
      (b.at ?? "").localeCompare(a.at ?? ""),
    );

    const vitals = (weightObs as Observation[]).map((o) => ({
      label: o.code?.text ?? "Weight",
      value: `${o.valueQuantity?.value} ${o.valueQuantity?.unit ?? ""}`.trim(),
      date: o.effectiveDateTime,
      url: written(`Observation/${o.id}`, "").url,
    }));

    const animal = patient.extension?.find((e) => e.url === ANIMAL_EXT);
    const sub = (url: string) =>
      animal?.extension?.find((e) => e.url === url)?.valueCodeableConcept;

    return NextResponse.json({
      patient: {
        id,
        name: patient.name?.[0]?.text ?? "Unnamed",
        species: sub("species")?.text,
        speciesCode: sub("species")?.coding?.[0]?.code,
        breed: sub("breed")?.text,
        genderStatus: sub("genderStatus")?.text,
        birthDate: patient.birthDate,
        url: written(`Patient/${id}`, "").url,
      },
      owner: (owners as RelatedPerson[])[0]
        ? {
            name: (owners as RelatedPerson[])[0].name?.[0]?.text,
            phone: (owners as RelatedPerson[])[0].telecom?.[0]?.value,
          }
        : undefined,
      intake,
      stated: intake.filter((f) => f.source === "stated").length,
      inferred: intake.filter((f) => f.source === "inferred").length,
      vitals,
      immunizations: (immunizations as Immunization[]).map((i) => ({
        label: i.vaccineCode?.text ?? "Vaccine",
        date: i.occurrenceDateTime,
        note: i.note?.[0]?.text,
        overdue: /overdue/i.test(i.note?.map((n) => n.text).join(" ") ?? ""),
        url: written(`Immunization/${i.id}`, "").url,
      })),
      appointments: (appointments as Appointment[])
        .slice(0, 3)
        .map((a) => ({
          start: a.start,
          status: a.status,
          description: a.description,
          url: written(`Appointment/${a.id}`, "").url,
        })),
      notes: (compositions as Composition[]).slice(0, 2).map((c) => ({
        title: c.title ?? "Note",
        status: c.status,
        date: c.date,
        sections: (c.section ?? []).map((s) => ({
          title: s.title,
          html: s.text?.div ?? "",
        })),
        url: written(`Composition/${c.id}`, "").url,
      })),
      calls: (communications as Communication[]).slice(0, 1).map((c) => ({
        sent: c.sent,
        topic: c.topic?.text,
        utterances: (c.payload ?? [])
          .map((p) => p.contentString)
          .filter(Boolean) as string[],
        url: written(`Communication/${c.id}`, "").url,
      })),
      tasks: (tasks as Task[]).slice(0, 3).map((t) => ({
        description: t.description,
        status: t.status,
        intent: t.intent,
        url: written(`Task/${t.id}`, "").url,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
