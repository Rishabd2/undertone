/**
 * Seed the clinic into Medplum as a real FHIR R4 graph.
 *
 *   npm run seed
 *
 * Idempotent: every resource is upserted on a stable identifier.
 *
 * This is the part that replaces OpenVPM. The graph, and why each piece is here:
 *
 *   Organization    the practice, carrying its timezone as an extension. The
 *                   PIMS this replaces could not expose the practice timezone
 *                   on its integrator API, so a laptop in California booked
 *                   three hours off. Here the timezone is in the record.
 *   Patient         Luna, an animal, modeled with the FHIR patient-animal
 *                   extension: species, breed, genderStatus. R4 shipped this
 *                   and almost nobody uses it.
 *   RelatedPerson   Maria, the owner. The patient cannot self-report, so the
 *                   owner is the informant and the record should say so.
 *   Practitioner    Dr. Chen, who approves.
 *   Device          Vetra itself, so Provenance can name a machine as author.
 *   Observation     body weight, real LOINC.
 *   Immunization    rabies, lapsed. The overdue flag drives a later beat.
 *   DocumentReference  the chart notes Moss indexes.
 *   Schedule + Slot the clinic's calendar. Booking writes an Appointment
 *                   against a free Slot and flips it to busy, so a double
 *                   booking is refused by the record rather than by our code.
 */

import "./load-env";
import type {
  Device,
  DocumentReference,
  Encounter,
  Immunization,
  Location,
  Observation,
  Organization,
  Patient,
  Practitioner,
  RelatedPerson,
  Schedule,
  Slot,
} from "@medplum/fhirtypes";
import { getMedplum, UNDERTONE_IDENTIFIER_SYSTEM } from "../src/lib/medplum";
import { CHART, CLINIC, PATIENT } from "../src/lib/case";
import {
  buildAnimalPatient,
  buildSlot,
  buildWeightObservation,
  practiceTimezoneExtension,
} from "../src/lib/fhir-builders";

const LOINC = "http://loinc.org";
const SNOMED = "http://snomed.info/sct";

/** Wall clock in a named timezone to a UTC instant. */
function wallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(guess)).map((p) => [p.type, p.value]),
  );
  const asSeen = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === "24" ? "0" : parts.hour),
    Number(parts.minute),
  );
  return new Date(guess + (guess - asSeen));
}

async function main() {
  const medplum = await getMedplum();
  const created: string[] = [];
  const note = (r: { resourceType: string; id?: string }) => {
    created.push(`${r.resourceType}/${r.id}`);
    console.log(`  ${r.resourceType}/${r.id}`);
  };
  const on = (value: string) =>
    `identifier=${UNDERTONE_IDENTIFIER_SYSTEM}|${value}`;
  const ident = (value: string) => [
    { system: UNDERTONE_IDENTIFIER_SYSTEM, value },
  ];

  console.log("\nSeeding the clinic into Medplum\n");

  // ---- Organization, with the timezone the old PIMS could not expose -------
  const organization = await medplum.upsertResource<Organization>(
    {
      resourceType: "Organization",
      identifier: ident("clinic-neighborhood-vet"),
      active: true,
      name: CLINIC.name,
      extension: practiceTimezoneExtension(),
    },
    on("clinic-neighborhood-vet"),
  );
  note(organization);
  const managingOrganization = { reference: `Organization/${organization.id}` };

  // ---- Practitioner --------------------------------------------------------
  const practitioner = await medplum.upsertResource<Practitioner>(
    {
      resourceType: "Practitioner",
      identifier: ident("clinician-chen"),
      name: [{ given: ["Elaine"], family: "Chen", prefix: ["Dr"] }],
    },
    on("clinician-chen"),
  );
  note(practitioner);

  // ---- Patient: an animal, modeled the way R4 says to ----------------------
  const patient = await medplum.upsertResource<Patient>(
    buildAnimalPatient(managingOrganization),
    on(PATIENT.mrn),
  );
  note(patient);
  const subject = { reference: `Patient/${patient.id}` };

  // ---- The owner. The patient cannot self-report, so this matters. --------
  const owner = await medplum.upsertResource<RelatedPerson>(
    {
      resourceType: "RelatedPerson",
      identifier: ident("owner-maria"),
      active: true,
      patient: subject,
      name: [{ text: PATIENT.ownerName }],
      telecom: [{ system: "phone", value: PATIENT.ownerPhone, use: "mobile" }],
      relationship: [{ text: "Owner" }],
    },
    on("owner-maria"),
  );
  note(owner);

  // ---- Device: the agent, so Provenance can name a machine as author ------
  const device = await medplum.upsertResource<Device>(
    {
      resourceType: "Device",
      identifier: ident("vetra-intake-agent"),
      status: "active",
      owner: managingOrganization,
      deviceName: [
        { name: "Vetra intake agent", type: "user-friendly-name" },
      ],
      version: [{ value: "0.1.0" }],
    },
    on("vetra-intake-agent"),
  );
  note(device);

  // ---- Weight history ------------------------------------------------------
  for (const [key, value, date] of [
    ["obs-weight-2026-07", 28.6, "2026-07-01"],
    ["obs-weight-2025-07", 28.1, "2025-07-14"],
    ["obs-weight-2024-07", 27.9, "2024-07-09"],
  ] as const) {
    const observation = await medplum.upsertResource<Observation>(
      buildWeightObservation({
        key,
        subject,
        performer: { reference: `Practitioner/${practitioner.id}` },
        value,
        effectiveDateTime: date,
      }),
      on(key),
    );
    note(observation);
  }

  // ---- Rabies, lapsed ------------------------------------------------------
  const rabies = await medplum.upsertResource<Immunization>(
    {
      resourceType: "Immunization",
      identifier: ident("imm-rabies-2025"),
      status: "completed",
      // No CVX code exists for veterinary rabies products, so this is text.
      vaccineCode: { text: "Rabies vaccine, 1 year product" },
      patient: subject,
      occurrenceDateTime: "2025-07-14",
      lotNumber: "RB-3318",
      performer: [
        { actor: { reference: `Practitioner/${practitioner.id}` } },
      ],
      note: [
        {
          text: "One year product. Next dose was due 2026-07-14 and has not been given. Currently overdue.",
        },
      ],
    },
    on("imm-rabies-2025"),
  );
  note(rabies);

  // ---- The July wellness encounter ---------------------------------------
  const encounter = await medplum.upsertResource<Encounter>(
    {
      resourceType: "Encounter",
      identifier: ident("enc-2026-07"),
      status: "finished",
      class: {
        system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
        code: "AMB",
        display: "ambulatory",
      },
      subject,
      serviceProvider: managingOrganization,
      participant: [
        { individual: { reference: `Practitioner/${practitioner.id}` } },
      ],
      period: { start: "2026-07-01T14:00:00Z", end: "2026-07-01T14:30:00Z" },
      reasonCode: [{ text: "Annual wellness examination" }],
    },
    on("enc-2026-07"),
  );
  note(encounter);

  // ---- Chart notes, the documents Moss indexes ---------------------------
  for (const entry of CHART.filter(
    (c) => c.resourceType === "DocumentReference",
  )) {
    const document = await medplum.upsertResource<DocumentReference>(
      {
        resourceType: "DocumentReference",
        identifier: ident(entry.id),
        status: "current",
        type: { text: entry.label },
        subject,
        date: `${entry.date}T12:00:00Z`,
        author: [{ reference: `Practitioner/${practitioner.id}` }],
        content: [
          {
            attachment: {
              contentType: "text/plain",
              data: Buffer.from(entry.text, "utf8").toString("base64"),
              title: entry.label,
            },
          },
        ],
      },
      on(entry.id),
    );
    note(document);
  }

  // ---- The calendar. A booking is refused by the record, not by our code. --
  // Schedule.actor does not accept Organization in R4, so the place is a
  // Location. Caught by `npm run validate` before a single write went out.
  const location = await medplum.upsertResource<Location>(
    {
      resourceType: "Location",
      identifier: ident("location-neighborhood-vet"),
      status: "active",
      name: CLINIC.name,
      managingOrganization,
    },
    on("location-neighborhood-vet"),
  );
  note(location);

  const schedule = await medplum.upsertResource<Schedule>(
    {
      resourceType: "Schedule",
      identifier: ident("schedule-chen"),
      active: true,
      actor: [
        { reference: `Practitioner/${practitioner.id}` },
        { reference: `Location/${location.id}` },
      ],
      comment: `${CLINIC.name} · ${CLINIC.timezone}`,
    },
    on("schedule-chen"),
  );
  note(schedule);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const year = tomorrow.getFullYear();
  const month = tomorrow.getMonth() + 1;
  const day = tomorrow.getDate();

  // 10:00 is deliberately seeded busy. The agent has to be told no and move on,
  // which is the beat that proves the calendar belongs to the clinic.
  const slotPlan: Array<[number, number, "busy" | "free"]> = [
    [10, 0, "busy"],
    [10, 30, "free"],
    [11, 0, "free"],
    [11, 30, "free"],
    [14, 0, "free"],
  ];

  console.log(
    `\n  Slots for ${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} in ${CLINIC.timezone}:`,
  );
  for (const [hour, minute, status] of slotPlan) {
    const start = wallClockToUtc(year, month, day, hour, minute, CLINIC.timezone);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const key = `slot-${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}`;
    const slot = await medplum.upsertResource<Slot>(
      buildSlot({
        key,
        schedule: { reference: `Schedule/${schedule.id}` },
        start: start.toISOString(),
        end: end.toISOString(),
        status,
      }),
      on(key),
    );
    console.log(
      `    ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} local  ${start.toISOString()}  ${status}`,
    );
    created.push(`Slot/${slot.id}`);
  }

  console.log(`\n${created.length} resources upserted.`);
  console.log(`Patient/${patient.id} is ${PATIENT.name}.`);
  console.log(
    `\nOpen https://app.medplum.com/Patient/${patient.id} to show the graph.\n`,
  );
}

main().catch((err) => {
  console.error("\nSeed failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
