/**
 * Seed the synthetic patient into Medplum as a real FHIR R4 graph.
 *
 *   npm run seed
 *
 * Idempotent: every resource is upserted on a stable identifier, so running it
 * twice does not duplicate the chart.
 *
 * The graph, and why each piece is here:
 *   Patient              the subject, carrying stated pronouns as an extension
 *   Practitioner         the clinician who approves, so approval has an identity
 *   Device               Undertone itself, so Provenance can name the author
 *   Condition            chart problems, from history, never from a voice signal
 *   MedicationStatement  what she takes, and the source of Deepgram keyterms
 *   AllergyIntolerance   ditto
 *   Observation          labs and vitals with real LOINC codes
 *   Encounter            the March visit the retrieval will surface
 *   Coverage             so the post-approval eligibility check has a subscriber
 */

import "./load-env";
import type {
  AllergyIntolerance,
  Condition,
  Coverage,
  Device,
  Encounter,
  MedicationStatement,
  Observation,
  Patient,
  Practitioner,
} from "@medplum/fhirtypes";
import { getMedplum, UNDERTONE_IDENTIFIER_SYSTEM } from "../src/lib/medplum";
import { PATIENT, VISIT } from "../src/lib/case";

const SNOMED = "http://snomed.info/sct";
const LOINC = "http://loinc.org";
const RXNORM = "http://www.nlm.nih.gov/research/umls/rxnorm";

async function main() {
  const medplum = await getMedplum();
  const created: string[] = [];
  const note = (r: { resourceType: string; id?: string }) => {
    created.push(`${r.resourceType}/${r.id}`);
    console.log(`  ${r.resourceType}/${r.id}`);
  };

  console.log("\nSeeding synthetic patient into Medplum\n");

  // ---- Patient -------------------------------------------------------------
  const patient = await medplum.upsertResource<Patient>(
    {
      resourceType: "Patient",
      identifier: [
        { system: UNDERTONE_IDENTIFIER_SYSTEM, value: PATIENT.mrn },
      ],
      active: true,
      name: [
        {
          use: "official",
          given: [PATIENT.givenName],
          family: PATIENT.familyName,
        },
      ],
      gender: PATIENT.gender,
      birthDate: PATIENT.birthDate,
      telecom: [{ system: "phone", value: PATIENT.phone, use: "mobile" }],
      extension: [
        {
          // Pronouns as stated by the patient and recorded, not inferred.
          url: "http://hl7.org/fhir/StructureDefinition/individual-pronouns",
          extension: [
            {
              url: "value",
              valueCodeableConcept: { text: PATIENT.pronouns },
            },
          ],
        },
      ],
    },
    `identifier=${UNDERTONE_IDENTIFIER_SYSTEM}|${PATIENT.mrn}`,
  );
  note(patient);
  const subject = { reference: `Patient/${patient.id}` };

  // ---- Practitioner, the human who approves --------------------------------
  const practitioner = await medplum.upsertResource<Practitioner>(
    {
      resourceType: "Practitioner",
      identifier: [
        { system: UNDERTONE_IDENTIFIER_SYSTEM, value: "clinician-osei" },
      ],
      name: [{ given: ["Amara"], family: "Osei", prefix: ["Dr"] }],
    },
    `identifier=${UNDERTONE_IDENTIFIER_SYSTEM}|clinician-osei`,
  );
  note(practitioner);

  // ---- Device, so Provenance can say a machine authored the observation -----
  const device = await medplum.upsertResource<Device>(
    {
      resourceType: "Device",
      identifier: [
        { system: UNDERTONE_IDENTIFIER_SYSTEM, value: "undertone-intake-agent" },
      ],
      status: "active",
      deviceName: [{ name: "Undertone intake agent", type: "user-friendly-name" }],
      version: [{ value: "0.1.0" }],
    },
    `identifier=${UNDERTONE_IDENTIFIER_SYSTEM}|undertone-intake-agent`,
  );
  note(device);

  // ---- Conditions ----------------------------------------------------------
  const conditions: Array<[string, string, string, string]> = [
    ["cond-hypothyroid", "40930008", "Hypothyroidism", "2019-06-11"],
    ["cond-prediabetes", "714628002", "Prediabetes", "2023-09-02"],
  ];
  for (const [key, code, display, onset] of conditions) {
    const resource = await medplum.upsertResource<Condition>(
      {
        resourceType: "Condition",
        identifier: [{ system: UNDERTONE_IDENTIFIER_SYSTEM, value: key }],
        clinicalStatus: {
          coding: [
            {
              system:
                "http://terminology.hl7.org/CodeSystem/condition-clinical",
              code: "active",
            },
          ],
        },
        verificationStatus: {
          coding: [
            {
              system:
                "http://terminology.hl7.org/CodeSystem/condition-ver-status",
              code: "confirmed",
            },
          ],
        },
        category: [
          {
            coding: [
              {
                system:
                  "http://terminology.hl7.org/CodeSystem/condition-category",
                code: "problem-list-item",
              },
            ],
          },
        ],
        code: { coding: [{ system: SNOMED, code, display }], text: display },
        subject,
        onsetDateTime: onset,
      },
      `identifier=${UNDERTONE_IDENTIFIER_SYSTEM}|${key}`,
    );
    note(resource);
  }

  // ---- Medications ---------------------------------------------------------
  const meds: Array<[string, string, string, string]> = [
    ["med-levothyroxine", "10582", "Levothyroxine", "88 mcg by mouth once daily in the morning"],
    ["med-metformin", "6809", "Metformin", "500 mg by mouth twice daily with meals"],
    ["med-lisinopril", "29046", "Lisinopril", "10 mg by mouth once daily"],
    ["med-atorvastatin", "83367", "Atorvastatin", "20 mg by mouth at bedtime"],
  ];
  for (const [key, code, display, sig] of meds) {
    const resource = await medplum.upsertResource<MedicationStatement>(
      {
        resourceType: "MedicationStatement",
        identifier: [{ system: UNDERTONE_IDENTIFIER_SYSTEM, value: key }],
        status: "active",
        medicationCodeableConcept: {
          coding: [{ system: RXNORM, code, display }],
          text: display,
        },
        subject,
        dosage: [{ text: sig }],
      },
      `identifier=${UNDERTONE_IDENTIFIER_SYSTEM}|${key}`,
    );
    note(resource);
  }

  // ---- Allergy -------------------------------------------------------------
  const allergy = await medplum.upsertResource<AllergyIntolerance>(
    {
      resourceType: "AllergyIntolerance",
      identifier: [{ system: UNDERTONE_IDENTIFIER_SYSTEM, value: "allergy-smx" }],
      clinicalStatus: {
        coding: [
          {
            system:
              "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
            code: "active",
          },
        ],
      },
      type: "allergy",
      category: ["medication"],
      criticality: "low",
      code: {
        coding: [{ system: RXNORM, code: "10180", display: "Sulfamethoxazole" }],
        text: "Sulfamethoxazole",
      },
      patient: subject,
      recordedDate: "2018-04-22",
      reaction: [
        {
          manifestation: [{ text: "Diffuse maculopapular rash" }],
          severity: "mild",
        },
      ],
    },
    `identifier=${UNDERTONE_IDENTIFIER_SYSTEM}|allergy-smx`,
  );
  note(allergy);

  // ---- Observations, real LOINC ------------------------------------------
  type ObsSpec = {
    key: string;
    code: string;
    display: string;
    value: number;
    unit: string;
    date: string;
    category: "laboratory" | "vital-signs";
  };
  const observations: ObsSpec[] = [
    { key: "obs-tsh-2026-03", code: "3016-3", display: "Thyrotropin [Units/volume] in Serum or Plasma", value: 4.8, unit: "mIU/L", date: "2026-03-19", category: "laboratory" },
    { key: "obs-tsh-2025-04", code: "3016-3", display: "Thyrotropin [Units/volume] in Serum or Plasma", value: 2.9, unit: "mIU/L", date: "2025-04-08", category: "laboratory" },
    { key: "obs-a1c-2026-03", code: "4548-4", display: "Hemoglobin A1c/Hemoglobin.total in Blood", value: 6.1, unit: "%", date: "2026-03-19", category: "laboratory" },
    { key: "obs-weight-2026-03", code: "29463-7", display: "Body weight", value: 75.4, unit: "kg", date: "2026-03-19", category: "vital-signs" },
    { key: "obs-weight-2025-08", code: "29463-7", display: "Body weight", value: 71.2, unit: "kg", date: "2025-08-14", category: "vital-signs" },
    { key: "obs-weight-2024-11", code: "29463-7", display: "Body weight", value: 70.1, unit: "kg", date: "2024-11-02", category: "vital-signs" },
  ];
  for (const spec of observations) {
    const resource = await medplum.upsertResource<Observation>(
      {
        resourceType: "Observation",
        identifier: [{ system: UNDERTONE_IDENTIFIER_SYSTEM, value: spec.key }],
        status: "final",
        category: [
          {
            coding: [
              {
                system:
                  "http://terminology.hl7.org/CodeSystem/observation-category",
                code: spec.category,
              },
            ],
          },
        ],
        code: {
          coding: [{ system: LOINC, code: spec.code, display: spec.display }],
          text: spec.display,
        },
        subject,
        effectiveDateTime: spec.date,
        valueQuantity: {
          value: spec.value,
          unit: spec.unit,
          system: "http://unitsofmeasure.org",
          code: spec.unit,
        },
      },
      `identifier=${UNDERTONE_IDENTIFIER_SYSTEM}|${spec.key}`,
    );
    note(resource);
  }

  // Blood pressure as a proper panel with components.
  const bp = await medplum.upsertResource<Observation>(
    {
      resourceType: "Observation",
      identifier: [{ system: UNDERTONE_IDENTIFIER_SYSTEM, value: "obs-bp-2026-03" }],
      status: "final",
      category: [
        {
          coding: [
            {
              system:
                "http://terminology.hl7.org/CodeSystem/observation-category",
              code: "vital-signs",
            },
          ],
        },
      ],
      code: {
        coding: [{ system: LOINC, code: "85354-9", display: "Blood pressure panel" }],
        text: "Blood pressure",
      },
      subject,
      effectiveDateTime: "2026-03-19",
      component: [
        {
          code: { coding: [{ system: LOINC, code: "8480-6", display: "Systolic blood pressure" }] },
          valueQuantity: { value: 138, unit: "mm[Hg]", system: "http://unitsofmeasure.org", code: "mm[Hg]" },
        },
        {
          code: { coding: [{ system: LOINC, code: "8462-4", display: "Diastolic blood pressure" }] },
          valueQuantity: { value: 86, unit: "mm[Hg]", system: "http://unitsofmeasure.org", code: "mm[Hg]" },
        },
      ],
    },
    `identifier=${UNDERTONE_IDENTIFIER_SYSTEM}|obs-bp-2026-03`,
  );
  note(bp);

  // ---- The March encounter that retrieval will surface ---------------------
  const encounter = await medplum.upsertResource<Encounter>(
    {
      resourceType: "Encounter",
      identifier: [{ system: UNDERTONE_IDENTIFIER_SYSTEM, value: "enc-2026-03" }],
      status: "finished",
      class: {
        system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
        code: "AMB",
        display: "ambulatory",
      },
      subject,
      participant: [{ individual: { reference: `Practitioner/${practitioner.id}` } }],
      period: { start: "2026-03-19T15:00:00Z", end: "2026-03-19T15:25:00Z" },
      reasonCode: [{ text: "Routine follow-up, thyroid and glycemic control" }],
    },
    `identifier=${UNDERTONE_IDENTIFIER_SYSTEM}|enc-2026-03`,
  );
  note(encounter);

  // ---- Coverage, so eligibility has a subscriber ---------------------------
  const coverage = await medplum.upsertResource<Coverage>(
    {
      resourceType: "Coverage",
      identifier: [{ system: UNDERTONE_IDENTIFIER_SYSTEM, value: "coverage-primary" }],
      status: "active",
      beneficiary: subject,
      subscriberId: "UT0000000001",
      payor: [{ display: "Stedi test payer" }],
      relationship: { text: "self" },
    },
    `identifier=${UNDERTONE_IDENTIFIER_SYSTEM}|coverage-primary`,
  );
  note(coverage);

  console.log(`\n${created.length} resources upserted.`);
  console.log(`Patient/${patient.id} is the demo subject.`);
  console.log(`Visit reason: ${VISIT.reasonForVisit}\n`);
  console.log(
    "Open this patient in the Medplum app to show the graph during the pitch.\n",
  );
}

main().catch((err) => {
  console.error("\nSeed failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
