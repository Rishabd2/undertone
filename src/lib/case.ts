/**
 * The synthetic case. Everything domain-specific lives here so the demo can be
 * re-pointed at a different patient, or a different species, without touching
 * the agent loop, the retrieval layer, or the FHIR writer.
 *
 * SYNTHETIC PATIENT. No real person. Safe to display, record, and submit.
 */

export type ChartEntry = {
  id: string;
  /** Maps to the FHIR resource this becomes in Medplum. */
  resourceType:
    | "Condition"
    | "MedicationStatement"
    | "AllergyIntolerance"
    | "Observation"
    | "DocumentReference"
    | "Encounter";
  /** ISO date. Drives Moss recency filtering and the chart timeline. */
  date: string;
  /** Short label for the UI. */
  label: string;
  /** The text Moss embeds. Written as a clinician would say it, not as JSON. */
  text: string;
  /** Coarse bucket used for metadata filtering. */
  category: "problem" | "medication" | "allergy" | "vital" | "lab" | "note";
  /** Terms worth priming the speech recognizer with, if any. */
  keyterms?: string[];
};

export const PATIENT = {
  id: "undertone-synthetic-001",
  givenName: "Dana",
  familyName: "Whitfield",
  /** Stated by the patient and recorded in the chart. Not inferred from the name. */
  pronouns: "she/her",
  gender: "female" as const,
  birthDate: "1972-03-14",
  ageYears: 54,
  mrn: "UT-000001",
  phone: "+15551230144",
  /** Shown on screen at all times. Non-negotiable rule 6. */
  banner: "SYNTHETIC PATIENT",
} as const;

export const VISIT = {
  reasonForVisit: "Fatigue and shortness of breath on exertion, about 3 weeks",
  /** The appointment the pre-visit intake is happening ahead of. */
  scheduledFor: "today, 2:40pm",
  clinician: "Dr. Amara Osei",
  clinicianRole: "Primary care",
} as const;

/**
 * The chart. This is seeded into Medplum as FHIR and, separately, embedded into
 * the Moss cloud index. Both readers see the same source of truth.
 */
export const CHART: ChartEntry[] = [
  {
    id: "cond-hypothyroid",
    resourceType: "Condition",
    date: "2019-06-11",
    label: "Hypothyroidism",
    text: "Hypothyroidism, diagnosed June 2019, managed with levothyroxine replacement. Stable on recheck through 2024.",
    category: "problem",
    keyterms: ["hypothyroidism", "levothyroxine"],
  },
  {
    id: "cond-prediabetes",
    resourceType: "Condition",
    date: "2023-09-02",
    label: "Prediabetes",
    text: "Prediabetes, hemoglobin A1c 6.1 percent in September 2023. Lifestyle counseling given. Metformin started 2024 for glycemic control.",
    category: "problem",
    keyterms: ["prediabetes", "hemoglobin A1c", "metformin"],
  },
  {
    id: "med-levothyroxine",
    resourceType: "MedicationStatement",
    date: "2025-11-04",
    label: "Levothyroxine 88 mcg daily",
    text: "Levothyroxine 88 micrograms by mouth once daily, taken in the morning on an empty stomach. Dose last adjusted November 2025.",
    category: "medication",
    keyterms: ["levothyroxine"],
  },
  {
    id: "med-metformin",
    resourceType: "MedicationStatement",
    date: "2024-02-19",
    label: "Metformin 500 mg twice daily",
    text: "Metformin 500 milligrams by mouth twice daily with meals. Tolerated without gastrointestinal upset.",
    category: "medication",
    keyterms: ["metformin"],
  },
  {
    id: "med-lisinopril",
    resourceType: "MedicationStatement",
    date: "2025-01-08",
    label: "Lisinopril 10 mg daily",
    text: "Lisinopril 10 milligrams by mouth once daily for blood pressure. Started January 2025.",
    category: "medication",
    keyterms: ["lisinopril"],
  },
  {
    id: "med-atorvastatin",
    resourceType: "MedicationStatement",
    date: "2025-01-08",
    label: "Atorvastatin 20 mg nightly",
    text: "Atorvastatin 20 milligrams by mouth at bedtime for lipid management.",
    category: "medication",
    keyterms: ["atorvastatin"],
  },
  {
    id: "allergy-smx",
    resourceType: "AllergyIntolerance",
    date: "2018-04-22",
    label: "Sulfamethoxazole, rash",
    text: "Allergy to sulfamethoxazole. Reaction was a diffuse maculopapular rash, no airway involvement. Documented April 2018.",
    category: "allergy",
    keyterms: ["sulfamethoxazole"],
  },
  {
    id: "note-march-fluid",
    resourceType: "DocumentReference",
    date: "2026-03-19",
    label: "March visit note",
    text: "Patient mentioned drinking noticeably more water over the past several weeks and waking once or twice most nights to urinate. Attributed at the time to increased fluid intake in warm weather. No workup ordered. Advised to mention it again if it persisted.",
    category: "note",
    keyterms: ["nocturia", "polydipsia"],
  },
  {
    id: "note-fhx",
    resourceType: "DocumentReference",
    date: "2023-09-02",
    label: "Family history",
    text: "Family history: father with heart failure diagnosed in his late fifties. Mother with hypothyroidism. No known family history of malignancy.",
    category: "note",
    keyterms: ["heart failure"],
  },
  {
    id: "obs-tsh-2026-03",
    resourceType: "Observation",
    date: "2026-03-19",
    label: "TSH 4.8 mIU/L",
    text: "Thyroid stimulating hormone 4.8 milli-international units per liter, March 2026. Upper end of the reference range. Prior value 2.9 in 2025.",
    category: "lab",
    keyterms: ["TSH", "thyroid stimulating hormone"],
  },
  {
    id: "obs-a1c-2026-03",
    resourceType: "Observation",
    date: "2026-03-19",
    label: "A1c 6.1 percent",
    text: "Hemoglobin A1c 6.1 percent, March 2026. Unchanged from prior.",
    category: "lab",
    keyterms: ["hemoglobin A1c"],
  },
  {
    id: "obs-bp-2026-03",
    resourceType: "Observation",
    date: "2026-03-19",
    label: "BP 138/86",
    text: "Blood pressure 138 over 86 millimeters of mercury, seated, March 2026.",
    category: "vital",
  },
  {
    id: "obs-weight-2025-08",
    resourceType: "Observation",
    date: "2025-08-14",
    label: "Weight 71.2 kg",
    text: "Body weight 71.2 kilograms, August 2025.",
    category: "vital",
  },
  {
    id: "obs-weight-2026-03",
    resourceType: "Observation",
    date: "2026-03-19",
    label: "Weight 75.4 kg",
    text: "Body weight 75.4 kilograms, March 2026. Up 4.2 kilograms since August 2025.",
    category: "vital",
  },
  {
    id: "enc-2026-03",
    resourceType: "Encounter",
    date: "2026-03-19",
    label: "Routine follow-up, March 2026",
    text: "Routine follow-up visit March 2026. Reviewed thyroid replacement and glycemic control. Patient reported feeling generally well aside from increased fluid intake.",
    category: "note",
  },
];

/**
 * Terms passed to Deepgram as keyterms before the socket opens, so the
 * recognizer is chart-aware. Derived from the chart, not hand-written, which is
 * the point: a different patient primes a different vocabulary.
 */
export function chartKeyterms(): string[] {
  const terms = new Set<string>();
  for (const entry of CHART) {
    for (const term of entry.keyterms ?? []) {
      terms.add(term);
    }
  }
  terms.add(PATIENT.givenName);
  terms.add(VISIT.clinician.replace(/^Dr\.\s*/, ""));
  return [...terms];
}

/**
 * The chart as Moss documents. Metadata values must be strings: the Moss
 * document metadata map is Record<string, string>.
 */
export function chartDocuments() {
  return CHART.map((entry) => ({
    id: entry.id,
    text: entry.text,
    metadata: {
      resourceType: entry.resourceType,
      resourceId: entry.id,
      date: entry.date,
      category: entry.category,
      label: entry.label,
      source: "medplum",
    },
  }));
}

/** Index naming. One cloud index per patient, one session index per visit. */
export const chartIndexName = (patientId: string) => `chart-${patientId}`;
export const sessionIndexName = (visitId: string) => `session-${visitId}`;
