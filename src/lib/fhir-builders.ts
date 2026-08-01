import type {
  Communication,
  Composition,
  Device,
  Observation,
  Organization,
  Patient,
  Practitioner,
  Provenance,
  Reference,
  RelatedPerson,
  Schedule,
  Slot,
} from "@medplum/fhirtypes";
import { CLINIC, PATIENT } from "./case";

/**
 * Pure builders for the resource shapes most likely to be wrong.
 *
 * These exist so `npm run validate` can check the exact objects that seed.ts and
 * loop.ts send to Medplum, against the real R4 StructureDefinitions, without
 * needing credentials or a network. A shape error found here costs a minute; the
 * same error found at 4:45pm costs the demo.
 */

export const UNDERTONE_IDENTIFIER_SYSTEM = "https://undertone.health/mrn";
export const ANIMAL_EXTENSION =
  "http://hl7.org/fhir/StructureDefinition/patient-animal";
export const PRACTICE_TIMEZONE_EXTENSION =
  "https://vetra.health/fhir/StructureDefinition/practice-timezone";

const SNOMED = "http://snomed.info/sct";
const LOINC = "http://loinc.org";

const ident = (value: string) => [
  { system: UNDERTONE_IDENTIFIER_SYSTEM, value },
];

/**
 * The animal. R4 shipped the patient-animal extension with species, breed, and
 * genderStatus sub-extensions, and almost nobody uses it.
 *
 * Breed is deliberately text-only: the SNOMED breed code was not verified, and a
 * wrong code is worse than an honest string.
 */
export function buildAnimalPatient(
  managingOrganization: Reference<Organization>,
): Patient {
  return {
    resourceType: "Patient",
    identifier: ident(PATIENT.mrn),
    active: true,
    name: [{ use: "usual", text: PATIENT.name, given: [PATIENT.name] }],
    gender: PATIENT.sex,
    birthDate: PATIENT.birthDate,
    managingOrganization,
    extension: [
      {
        url: ANIMAL_EXTENSION,
        extension: [
          {
            url: "species",
            valueCodeableConcept: {
              coding: [
                {
                  system: SNOMED,
                  code: PATIENT.species.code,
                  display: PATIENT.species.display,
                },
              ],
              text: PATIENT.species.text,
            },
          },
          {
            url: "breed",
            valueCodeableConcept: { text: PATIENT.breed.text },
          },
          {
            url: "genderStatus",
            valueCodeableConcept: {
              coding: [
                {
                  system:
                    "http://terminology.hl7.org/CodeSystem/animal-genderstatus",
                  code: PATIENT.genderStatus.code,
                  display: PATIENT.genderStatus.display,
                },
              ],
              text: PATIENT.genderStatus.display,
            },
          },
        ],
      },
    ],
  };
}

/** One half-hour slot on the clinic calendar. */
export function buildSlot(args: {
  key: string;
  schedule: Reference<Schedule>;
  start: string;
  end: string;
  status: "free" | "busy";
}): Slot {
  return {
    resourceType: "Slot",
    identifier: ident(args.key),
    schedule: args.schedule,
    status: args.status,
    start: args.start,
    end: args.end,
    comment:
      args.status === "busy"
        ? "Held for another patient"
        : "Available for booking",
  };
}

/**
 * A typed field pulled off the call. Preliminary: no vet has signed it.
 *
 * The agent goes in `Observation.device`, not `Observation.performer`. R4
 * restricts performer to Practitioner, PractitionerRole, Organization, CareTeam,
 * Patient, and RelatedPerson, so a Device there is invalid. Authorship by a
 * machine belongs in `device`, and the accountable authorship statement belongs
 * in the Provenance.
 */
export function buildFieldObservation(args: {
  subject: Reference<Patient>;
  device: Reference<Device>;
  label: string;
  value: string;
  quote?: string;
  effectiveDateTime: string;
}): Observation {
  return {
    resourceType: "Observation",
    status: "preliminary",
    category: [
      {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/observation-category",
            code: "survey",
          },
        ],
      },
    ],
    code: { text: args.label },
    subject: args.subject,
    effectiveDateTime: args.effectiveDateTime,
    device: args.device,
    valueString: args.value,
    note: args.quote
      ? [{ text: `Owner's words: "${args.quote}"` }]
      : [{ text: "Derived by the intake agent, not stated by the owner." }],
  };
}

/**
 * The resource the old PIMS had nowhere to put.
 *
 * `informant` when the owner said it, `author` when the agent derived it. Two
 * different objects, and the record can tell them apart tomorrow.
 */
export function buildFieldProvenance(args: {
  target: Reference<Observation>;
  source: "stated" | "inferred";
  owner: Reference<RelatedPerson>;
  device: Reference<Device>;
  recorded: string;
}): Provenance {
  const stated = args.source === "stated";
  return {
    resourceType: "Provenance",
    target: [args.target],
    recorded: args.recorded,
    activity: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/v3-DataOperation",
          code: "CREATE",
        },
      ],
      text: stated ? "Stated by owner" : "Inferred by agent",
    },
    agent: [
      {
        type: {
          coding: [
            {
              system:
                "http://terminology.hl7.org/CodeSystem/provenance-participant-type",
              code: stated ? "informant" : "author",
            },
          ],
        },
        who: stated ? args.owner : args.device,
      },
    ],
  };
}

/** The call itself, which the old integrator API could only log out of band. */
export function buildCallCommunication(args: {
  subject: Reference<Patient>;
  sender: Reference<RelatedPerson>;
  recipient: Reference<Device>;
  topic: string;
  utterances: string[];
  sent: string;
}): Communication {
  return {
    resourceType: "Communication",
    status: "completed",
    subject: args.subject,
    sent: args.sent,
    sender: args.sender,
    recipient: [args.recipient],
    medium: [
      {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/v3-ParticipationMode",
            code: "PHONE",
          },
        ],
      },
    ],
    topic: { text: args.topic },
    payload: args.utterances.map((text) => ({ contentString: text })),
  };
}

/** The intake summary. Stated and inferred stay in separate sections. */
export function buildIntakeComposition(args: {
  subject: Reference<Patient>;
  author: Reference<Device>;
  date: string;
  stated: string[];
  inferred: string[];
  triage: string[];
}): Composition {
  return {
    resourceType: "Composition",
    status: "preliminary",
    type: { text: "Pre-visit intake summary" },
    subject: args.subject,
    date: args.date,
    author: [args.author],
    title: `Intake summary · ${PATIENT.name}`,
    section: [
      {
        title: "Stated by the owner",
        text: { status: "generated", div: div(args.stated) },
      },
      {
        title: "Inferred by the agent",
        text: { status: "generated", div: div(args.inferred) },
      },
      {
        title: "Triage",
        text: { status: "generated", div: div(args.triage) },
      },
    ],
  };
}

/** Body weight, the one Observation with a real LOINC code. */
export function buildWeightObservation(args: {
  key: string;
  subject: Reference<Patient>;
  performer: Reference<Practitioner>;
  value: number;
  effectiveDateTime: string;
}): Observation {
  return {
    resourceType: "Observation",
    identifier: ident(args.key),
    status: "final",
    category: [
      {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/observation-category",
            code: "vital-signs",
          },
        ],
      },
    ],
    code: {
      coding: [{ system: LOINC, code: "29463-7", display: "Body weight" }],
      text: "Body weight",
    },
    subject: args.subject,
    effectiveDateTime: args.effectiveDateTime,
    performer: [args.performer],
    valueQuantity: {
      value: args.value,
      unit: "kg",
      system: "http://unitsofmeasure.org",
      code: "kg",
    },
  };
}

export const practiceTimezoneExtension = () => [
  { url: PRACTICE_TIMEZONE_EXTENSION, valueString: CLINIC.timezone },
];

/** FHIR narrative div. Escaped, because this text came from a phone call. */
export function div(lines: string[]): string {
  const escaped = lines
    .filter(Boolean)
    .map(
      (line) =>
        `<p>${line
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</p>`,
    )
    .join("");
  return `<div xmlns="http://www.w3.org/1999/xhtml">${escaped || "<p>None recorded.</p>"}</div>`;
}
