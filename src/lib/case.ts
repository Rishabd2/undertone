/**
 * The case. Everything domain-specific lives here so the loop, the retrieval
 * layer, and the FHIR writer never need to know what species they are serving.
 *
 * SYNTHETIC PATIENT. No real animal, no real client. Safe to display and record.
 *
 * This replaces the OpenVPM PIMS that the earlier version of this demo ran
 * against. Two findings from that build are the reason:
 *
 *   1. OpenVPM makes `source` mandatory on a SOAP write, echoes it back, and
 *      emits it on the webhook, but `soap_notes` has no column for it. The
 *      provenance is required in transport and dropped in the record. Tomorrow
 *      you cannot tell an agent-written note from a clinician's.
 *   2. The integrator API cannot read the practice timezone. Appointments demand
 *      an absolute timestamp but `practices` is not exposed on /api/v1.
 *
 * FHIR has had Provenance as a first-class resource the entire time, and
 * Medplum gives it to us with a search index on it. That is the argument.
 */

export type ChartEntry = {
  id: string;
  resourceType:
    | "Condition"
    | "MedicationStatement"
    | "AllergyIntolerance"
    | "Observation"
    | "Immunization"
    | "DocumentReference"
    | "Encounter";
  date: string;
  label: string;
  /** The text Moss embeds. Written as a vet would say it, not as JSON. */
  text: string;
  category: "problem" | "medication" | "allergy" | "vital" | "lab" | "immunization" | "note";
  /** Terms worth priming the speech recognizer with, if any. */
  keyterms?: string[];
};

/** The animal. FHIR calls it a Patient, and the animal extension says which kind. */
export const PATIENT = {
  id: "vetra-synthetic-luna",
  name: "Luna",
  /** The owner is the informant. The patient cannot self-report. */
  ownerName: "Maria Gonzalez",
  ownerPhone: "+15550101002",
  species: { code: "448771007", display: "Canis lupus familiaris", text: "Dog" },
  breed: { text: "German Shepherd Dog" },
  genderStatus: { code: "spayed", display: "Spayed" },
  sex: "female" as const,
  birthDate: "2020-04-18",
  ageYears: 6,
  weightKg: 28.6,
  mrn: "VETRA-LUNA-001",
  banner: "SYNTHETIC PATIENT",
} as const;

export const CLINIC = {
  name: "Urbana Paws Clinic",
  timezone: "America/Chicago",
  clinician: "Dr. Elaine Chen",
  frontDesk: "Morgan Bailey",
  /** The agent's name, matching the production assistant callers already know. */
  agentName: "Haley",
  emergencyHospital: "Riverbend Emergency Vet Hospital",
} as const;

export const VISIT = {
  reasonForVisit: "Acute left hind lameness since yesterday evening",
  presentingConcern:
    "Jumped off the couch, audible yelp, partial weight bearing since",
  clinician: CLINIC.clinician,
  clinicianRole: "Small animal general practice",
  scheduledFor: "tomorrow morning",
} as const;

/**
 * The chart the clinic already holds. Seeded into Medplum as FHIR and embedded
 * into the Moss index. Both readers see the same source of truth.
 */
export const CHART: ChartEntry[] = [
  {
    id: "obs-weight-2026-07",
    resourceType: "Observation",
    date: "2026-07-01",
    label: "Weight 28.6 kg",
    text: "Body weight 28.6 kilograms at the July 2026 wellness visit. Stable over the last two years.",
    category: "vital",
  },
  {
    id: "obs-weight-2025-07",
    resourceType: "Observation",
    date: "2025-07-14",
    label: "Weight 28.1 kg",
    text: "Body weight 28.1 kilograms, July 2025.",
    category: "vital",
  },
  {
    id: "imm-rabies-2025",
    resourceType: "Immunization",
    date: "2025-07-14",
    label: "Rabies, 1 year, lapsed",
    text: "Rabies vaccine, one year product, administered July 2025. Due July 2026 and not yet given. Currently overdue, which matters because a lapsed rabies vaccination changes what the clinic is allowed to do at the visit.",
    category: "immunization",
    keyterms: ["rabies"],
  },
  {
    id: "enc-2026-07",
    resourceType: "Encounter",
    date: "2026-07-01",
    label: "Wellness visit, July 2026",
    text: "Annual wellness examination July 2026. No lameness noted. Body condition score 5 of 9. Owner reported no concerns.",
    category: "note",
  },
  {
    id: "note-cruciate-risk",
    resourceType: "DocumentReference",
    date: "2026-07-01",
    label: "Breed risk note",
    text: "German Shepherd Dogs are among the breeds reported with increased risk of cranial cruciate ligament disease. Dogs that rupture one cruciate ligament frequently rupture the contralateral one later, so the opposite hind limb is worth asking about whenever one is lame.",
    category: "note",
    keyterms: ["cranial cruciate ligament", "cruciate"],
  },
  {
    id: "note-no-meds",
    resourceType: "DocumentReference",
    date: "2026-07-01",
    label: "No current medications",
    text: "No current medications on file as of July 2026. No corticosteroids, which matters before any NSAID is considered because concurrent NSAID and corticosteroid administration carries gastrointestinal ulceration risk.",
    category: "medication",
    keyterms: ["carprofen", "corticosteroid", "NSAID"],
  },
  {
    id: "note-no-allergies",
    resourceType: "DocumentReference",
    date: "2026-07-01",
    label: "No known drug reactions",
    text: "No known adverse drug reactions recorded.",
    category: "allergy",
  },
];

/**
 * Terms handed to Deepgram before the socket opens, so the recognizer is chart
 * aware. Derived from the chart, not hand-written: a different patient primes a
 * different vocabulary.
 */
export function chartKeyterms(): string[] {
  const terms = new Set<string>();
  for (const entry of CHART) {
    for (const term of entry.keyterms ?? []) terms.add(term);
  }
  terms.add(PATIENT.name);
  terms.add(PATIENT.ownerName.split(" ")[0]);
  terms.add(PATIENT.breed.text);
  terms.add("lameness");
  terms.add("stifle");
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

/**
 * Clinic-defined triage rules. The agent does not diagnose; it matches the
 * clinic's own rules and records which one fired. Carried over unchanged from
 * the OpenVPM build because the principle did not change with the backend.
 */
export const TRIAGE_RULES = [
  {
    name: "Non-weight-bearing or suspected fracture",
    autonomous: false,
    result: "Same-day appointment, clinician triage before booking",
    test: (text: string) =>
      /(not (bearing|putting) any weight|cannot walk|won'?t stand|fracture|bone (is )?(out|sticking))/i.test(
        text,
      ),
  },
  {
    name: "Partial weight bearing lameness, otherwise well",
    autonomous: true,
    result: "Next available appointment, standard lameness exam",
    test: (text: string) =>
      /(limp|lame|favou?ring|holding up|sore leg)/i.test(text) &&
      /(eating|drinking|some weight|partial|putting.*weight)/i.test(text),
  },
  {
    name: "Systemic signs present",
    autonomous: false,
    result: "Clinician review before scheduling",
    test: (text: string) =>
      /(vomit|collapse|seizure|not eating|lethargic|pale gums|bloat)/i.test(text),
  },
] as const;

export const chartIndexName = (patientId: string) => `chart-${patientId}`;
export const sessionIndexName = (visitId: string) => `session-${visitId}`;
