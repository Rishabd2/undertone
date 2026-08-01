/**
 * Validate every resource shape against the real R4 StructureDefinitions,
 * offline, with no credentials and no network.
 *
 *   npm run validate
 *
 * This is the first gate in the pipeline. A shape error found here costs a
 * minute. The same error found when the demo is on screen costs the demo.
 */

import "./load-env";
import type { Bundle, Resource, StructureDefinition } from "@medplum/fhirtypes";
import { indexStructureDefinitionBundle, validateResource } from "@medplum/core";
import { readJson } from "@medplum/definitions";
import {
  buildAnimalPatient,
  buildCallCommunication,
  buildFieldObservation,
  buildFieldProvenance,
  buildIntakeComposition,
  buildSlot,
  buildWeightObservation,
  practiceTimezoneExtension,
} from "../src/lib/fhir-builders";
import { CLINIC, PATIENT, VISIT } from "../src/lib/case";
import { structure, triage } from "../src/lib/loop";

// Load the spec. profiles-types must come first: resources reference the types.
for (const file of [
  "fhir/r4/profiles-types.json",
  "fhir/r4/profiles-resources.json",
  "fhir/r4/profiles-medplum.json",
]) {
  indexStructureDefinitionBundle(
    readJson(file) as Bundle<StructureDefinition>,
  );
}

const now = new Date().toISOString();
const org = { reference: "Organization/11111111-1111-1111-1111-111111111111" };
const patient = { reference: "Patient/22222222-2222-2222-2222-222222222222" };
const practitioner = {
  reference: "Practitioner/33333333-3333-3333-3333-333333333333",
};
const device = { reference: "Device/44444444-4444-4444-4444-444444444444" };
const owner = { reference: "RelatedPerson/55555555-5555-5555-5555-555555555555" };
const schedule = { reference: "Schedule/66666666-6666-6666-6666-666666666666" };
const location = { reference: "Location/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
const slotRef = { reference: "Slot/77777777-7777-7777-7777-777777777777" };
const composition = {
  reference: "Composition/88888888-8888-8888-8888-888888888888",
};

const utterances = [
  "Hi, it's Maria. Luna's been limping on her back left leg since yesterday evening.",
  "She jumped off the couch and yelped. She's putting some weight on it but not much.",
  "She's still eating fine and drinking normally. No vomiting.",
];
const fields = structure(utterances);
const triaged = triage(utterances);

/** Every shape the seed and the loop actually send. */
const cases: Array<[string, Resource]> = [
  [
    "Organization (with the practice timezone the old PIMS could not expose)",
    {
      resourceType: "Organization",
      active: true,
      name: CLINIC.name,
      extension: practiceTimezoneExtension(),
    },
  ],
  ["Patient (patient-animal extension)", buildAnimalPatient(org)],
  [
    "RelatedPerson (the owner, who is the informant)",
    {
      resourceType: "RelatedPerson",
      active: true,
      patient,
      name: [{ text: PATIENT.ownerName }],
      telecom: [{ system: "phone", value: PATIENT.ownerPhone, use: "mobile" }],
      relationship: [{ text: "Owner" }],
    },
  ],
  [
    "Device (the agent, so Provenance can name a machine)",
    {
      resourceType: "Device",
      status: "active",
      owner: org,
      deviceName: [{ name: "Vetra intake agent", type: "user-friendly-name" }],
      version: [{ value: "0.1.0" }],
    },
  ],
  [
    "Observation (body weight, LOINC 29463-7)",
    buildWeightObservation({
      key: "obs-weight-2026-07",
      subject: patient,
      performer: practitioner,
      value: PATIENT.weightKg,
      effectiveDateTime: "2026-07-01",
    }),
  ],
  [
    "Immunization (rabies, lapsed, no CVX exists for veterinary products)",
    {
      resourceType: "Immunization",
      status: "completed",
      vaccineCode: { text: "Rabies vaccine, 1 year product" },
      patient,
      occurrenceDateTime: "2025-07-14",
      lotNumber: "RB-3318",
      performer: [{ actor: practitioner }],
      note: [{ text: "Next dose was due 2026-07-14 and has not been given." }],
    },
  ],
  [
    "Location (the clinic as a place, which Schedule.actor accepts)",
    {
      resourceType: "Location",
      status: "active",
      name: CLINIC.name,
      managingOrganization: org,
    },
  ],
  [
    "Schedule (actor is Practitioner + Location, never Organization)",
    {
      resourceType: "Schedule",
      active: true,
      actor: [practitioner, location],
      comment: `${CLINIC.name} · ${CLINIC.timezone}`,
    },
  ],
  [
    "Slot (busy, so a double booking is refused by the record)",
    buildSlot({
      key: "slot-1000",
      schedule,
      start: "2026-08-02T14:00:00.000Z",
      end: "2026-08-02T14:30:00.000Z",
      status: "busy",
    }),
  ],
  [
    "Appointment",
    {
      resourceType: "Appointment",
      status: "booked",
      slot: [slotRef],
      start: "2026-08-02T14:30:00.000Z",
      end: "2026-08-02T15:00:00.000Z",
      description: VISIT.reasonForVisit,
      reasonCode: [{ text: "Next available appointment" }],
      participant: [
        { actor: patient, status: "accepted" },
        { actor: practitioner, status: "accepted" },
        { actor: owner, status: "accepted" },
      ],
    },
  ],
  [
    "Communication (the call itself)",
    buildCallCommunication({
      subject: patient,
      sender: owner,
      recipient: device,
      topic: VISIT.reasonForVisit,
      utterances,
      sent: now,
    }),
  ],
  [
    "Composition (stated and inferred in separate sections)",
    buildIntakeComposition({
      subject: patient,
      author: device,
      date: now,
      stated: fields.filter((f) => f.source === "stated").map((f) => f.label),
      inferred: fields
        .filter((f) => f.source === "inferred")
        .map((f) => f.label),
      triage: [triaged.matched?.name ?? "no rule matched"],
    }),
  ],
  [
    "Task (intent proposal, the approval gate expressed in FHIR)",
    {
      resourceType: "Task",
      status: "requested",
      intent: "proposal",
      priority: "routine",
      description: "Clinician review of intake",
      for: patient,
      authoredOn: now,
      requester: device,
      owner: practitioner,
      focus: composition,
    },
  ],
  [
    "AuditEvent (the refusal to assert a diagnosis)",
    {
      resourceType: "AuditEvent",
      type: {
        system: "http://terminology.hl7.org/CodeSystem/audit-event-type",
        code: "rest",
        display: "RESTful Operation",
      },
      action: "E",
      recorded: now,
      outcome: "4",
      outcomeDesc: "Condition creation refused.",
      agent: [{ who: device, requestor: true }],
      source: { observer: device },
      entity: [{ what: patient }],
    },
  ],
];

// Every typed field, both provenance flavours.
for (const field of fields) {
  cases.push([
    `Observation · ${field.label} (${field.source})`,
    buildFieldObservation({
      subject: patient,
      device,
      label: field.label,
      value: field.value,
      quote: field.quote,
      effectiveDateTime: now,
    }),
  ]);
}
for (const source of ["stated", "inferred"] as const) {
  cases.push([
    `Provenance · ${source} (author is the ${source === "stated" ? "owner" : "agent"})`,
    buildFieldProvenance({
      target: { reference: "Observation/99999999-9999-9999-9999-999999999999" },
      source,
      owner,
      device,
      recorded: now,
    }),
  ]);
}

let failed = 0;
console.log("\nValidating against FHIR R4 StructureDefinitions, offline\n");

for (const [label, resource] of cases) {
  try {
    const issues = validateResource(resource);
    const errors = issues.filter(
      (i) => i.severity === "error" || i.severity === "fatal",
    );
    if (errors.length === 0) {
      const warnings = issues.length;
      console.log(
        `PASS  ${label}${warnings ? `  (${warnings} warning${warnings === 1 ? "" : "s"})` : ""}`,
      );
    } else {
      failed++;
      console.log(`FAIL  ${label}`);
      for (const issue of errors) {
        console.log(
          `        ${issue.details?.text ?? issue.diagnostics ?? "unknown"} @ ${issue.expression?.join(", ") ?? "?"}`,
        );
      }
    }
  } catch (err) {
    failed++;
    console.log(`FAIL  ${label}`);
    console.log(`        ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log("");
if (failed === 0) {
  console.log(
    `All ${cases.length} resource shapes are valid R4. The writes will not fail on structure.\n`,
  );
} else {
  console.log(`${failed} of ${cases.length} shapes are invalid. Fix before seeding.\n`);
  process.exitCode = 1;
}
