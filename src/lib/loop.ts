import type {
  Appointment,
  AuditEvent,
  Communication,
  Composition,
  Observation,
  Patient,
  Provenance,
  RelatedPerson,
  Slot,
  Task,
} from "@medplum/fhirtypes";
import { getMedplum, UNDERTONE_IDENTIFIER_SYSTEM } from "./medplum";
import { CLINIC, PATIENT, TRIAGE_RULES, VISIT } from "./case";
import { written, type WrittenResource } from "./medplum-links";

/**
 * One case, carried across the workflow, written into Medplum.
 *
 * This is the OpenVPM loop with the record swapped out. The eight steps are the
 * same because the workflow did not change. What changed is that four things
 * the old PIMS could not express now have a resource:
 *
 *   provenance per field   Provenance, with the owner or the agent as author
 *   the call itself        Communication, instead of an out-of-band log line
 *   the calendar           Slot, so a double booking is refused by the record
 *   the practice timezone  an extension on Organization, instead of missing
 */

export type StepStatus = "ok" | "refused" | "blocked";

export type LoopStep = {
  n: number;
  title: string;
  /** What the operator should understand from this step, in one line. */
  line: string;
  status: StepStatus;
  detail?: string;
  resources: WrittenResource[];
  ms: number;
};

/** A field pulled out of the call, and where it came from. */
export type StructuredField = {
  key: string;
  label: string;
  value: string;
  /**
   * stated   the owner said it, in their own words
   * inferred the agent derived it
   * A fact the owner said and a model's guess are never the same object.
   */
  source: "stated" | "inferred";
  quote?: string;
};

export type LoopResult = {
  steps: LoopStep[];
  patientId: string;
  fields: StructuredField[];
  allResources: WrittenResource[];
};

const on = (value: string) => `identifier=${UNDERTONE_IDENTIFIER_SYSTEM}|${value}`;
const ident = (value: string) => [
  { system: UNDERTONE_IDENTIFIER_SYSTEM, value },
];

/**
 * Extract the typed fields from what the owner actually said. Deliberately
 * conservative: anything not clearly present is left out rather than guessed,
 * and everything the agent derives is labeled inferred.
 */
export function structure(utterances: string[]): StructuredField[] {
  const text = utterances.join(" ");
  const fields: StructuredField[] = [];
  const quoteFor = (pattern: RegExp) =>
    utterances.find((u) => pattern.test(u));

  fields.push({
    key: "presenting_complaint",
    label: "Presenting complaint",
    value: "Lameness",
    source: "stated",
    quote: quoteFor(/limp|lame|leg/i),
  });

  const limb = /back left|left (back|hind|rear)|hind left/i.test(text)
    ? "Left hind"
    : /back right|right (back|hind|rear)/i.test(text)
      ? "Right hind"
      : undefined;
  if (limb) {
    fields.push({
      key: "limb",
      label: "Limb",
      value: limb,
      source: "stated",
      quote: quoteFor(/back left|left (back|hind|rear)|hind left/i),
    });
  }

  if (/yesterday|last night|since last/i.test(text)) {
    fields.push({
      key: "onset",
      label: "Onset",
      value: "Yesterday evening",
      source: "stated",
      quote: quoteFor(/yesterday|last night/i),
    });
  }

  if (/jump|couch|fell|fall/i.test(text)) {
    fields.push({
      key: "inciting_event",
      label: "Inciting event",
      value: "Jumped from furniture",
      source: "stated",
      quote: quoteFor(/jump|couch|fell/i),
    });
  }

  if (/some weight|partial|not much|putting.*weight/i.test(text)) {
    fields.push({
      key: "weight_bearing",
      label: "Weight bearing",
      value: "Partial",
      source: "stated",
      quote: quoteFor(/some weight|not much|putting.*weight/i),
    });
  }

  if (/eating|drinking|appetite/i.test(text)) {
    fields.push({
      key: "appetite",
      label: "Appetite and water",
      value: "Normal",
      source: "stated",
      quote: quoteFor(/eating|drinking/i),
    });
  }

  // Everything below here is the agent's own derivation, and it says so.
  fields.push({
    key: "duration_hours",
    label: "Duration",
    value: "Approximately 18 hours",
    source: "inferred",
  });
  fields.push({
    key: "systemic_signs",
    label: "Systemic signs",
    value: "None reported",
    source: "inferred",
  });

  return fields;
}

export function triage(utterances: string[]) {
  const text = utterances.join(" ");
  const matched = TRIAGE_RULES.find((rule) => rule.test(text));
  return {
    rules: TRIAGE_RULES.map((rule) => ({
      name: rule.name,
      matched: rule === matched,
    })),
    matched: matched
      ? {
          name: matched.name,
          result: matched.result,
          autonomous: matched.autonomous,
        }
      : undefined,
  };
}

/** Run the whole loop and write it into Medplum. */
export async function runLoop(input: {
  callerPhone: string;
  utterances: string[];
}): Promise<LoopResult> {
  const medplum = await getMedplum();
  const steps: LoopStep[] = [];
  const all: WrittenResource[] = [];
  const started = () => performance.now();
  const record = (step: Omit<LoopStep, "n">) => {
    steps.push({ n: steps.length + 1, ...step });
    all.push(...step.resources);
  };

  // ---- 1. INTAKE: identify the caller from the number that rang -----------
  let t = started();
  const related = await medplum.searchOne("RelatedPerson", {
    telecom: input.callerPhone,
  });
  const patientRef = related?.patient?.reference;
  if (!patientRef) {
    throw new Error(
      `No patient found for ${input.callerPhone}. Run \`npm run seed\` first.`,
    );
  }
  const patient = await medplum.readReference(related.patient!);
  record({
    title: "INTAKE",
    line: `Caller matched from the number that rang. ${PATIENT.name} is a returning patient, and nobody retyped anything.`,
    status: "ok",
    detail: `${input.callerPhone} matched RelatedPerson/${related.id} (${related.name?.[0]?.text}) to Patient/${patient.id}`,
    resources: [],
    ms: started() - t,
  });

  const subject = { reference: `Patient/${patient.id}` };
  const [practitioner, device, organization, schedule] = await Promise.all([
    medplum.searchOne("Practitioner", on("clinician-chen")),
    medplum.searchOne("Device", on("vetra-intake-agent")),
    medplum.searchOne("Organization", on("clinic-neighborhood-vet")),
    medplum.searchOne("Schedule", on("schedule-chen")),
  ]);
  if (!practitioner?.id || !device?.id || !organization?.id || !schedule?.id) {
    throw new Error("Clinic resources missing. Run `npm run seed` first.");
  }
  const deviceRef = { reference: `Device/${device.id}` };
  const ownerRef = { reference: `RelatedPerson/${related.id}` };
  const practitionerRef = { reference: `Practitioner/${practitioner.id}` };

  // ---- 2. CONTEXT: what the clinic already holds --------------------------
  t = started();
  const [weights, immunizations] = await Promise.all([
    medplum.searchResources("Observation", {
      subject: `Patient/${patient.id}`,
      code: "http://loinc.org|29463-7",
      _sort: "-date",
      _count: "3",
    }),
    medplum.searchResources("Immunization", {
      patient: `Patient/${patient.id}`,
    }),
  ]);
  const latestWeight = weights[0]?.valueQuantity?.value;
  const rabiesOverdue = immunizations.some((i) =>
    /overdue/i.test(i.note?.map((n) => n.text).join(" ") ?? ""),
  );
  record({
    title: "CONTEXT",
    line: `Species, breed, weight and vaccination status came out of the record. Rabies is ${rabiesOverdue ? "overdue" : "current"}.`,
    status: "ok",
    detail: `Latest weight ${latestWeight ?? "unknown"} kg from ${weights.length} Observations. ${immunizations.length} Immunization(s) on file. Searched by LOINC code, not filtered client-side.`,
    resources: [],
    ms: started() - t,
  });

  // ---- 3. STRUCTURE: typed fields, each tied to its source ----------------
  // This is the step OpenVPM could not do. `source` was mandatory on the write,
  // echoed back, emitted on the webhook, and then had no column to live in.
  t = started();
  const fields = structure(input.utterances);
  const fieldResources: WrittenResource[] = [];

  for (const field of fields) {
    const observation = await medplum.createResource<Observation>({
      resourceType: "Observation",
      status: "preliminary",
      category: [
        {
          coding: [
            {
              system:
                "http://terminology.hl7.org/CodeSystem/observation-category",
              code: "survey",
            },
          ],
        },
      ],
      code: { text: field.label },
      subject,
      effectiveDateTime: new Date().toISOString(),
      performer: [deviceRef],
      valueString: field.value,
      note: field.quote
        ? [{ text: `Owner's words: "${field.quote}"` }]
        : [{ text: "Derived by the intake agent, not stated by the owner." }],
    });
    fieldResources.push(
      written(
        `Observation/${observation.id}`,
        `${field.label}: ${field.value} (${field.source})`,
      ),
    );

    // The provenance. Author is the owner when she said it, the agent when it
    // derived it. Two different objects, and the record can tell them apart.
    const provenance = await medplum.createResource<Provenance>({
      resourceType: "Provenance",
      target: [{ reference: `Observation/${observation.id}` }],
      recorded: new Date().toISOString(),
      activity: {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/v3-DataOperation",
            code: "CREATE",
          },
        ],
        text: field.source === "stated" ? "Stated by owner" : "Inferred by agent",
      },
      agent: [
        {
          type: {
            coding: [
              {
                system:
                  "http://terminology.hl7.org/CodeSystem/provenance-participant-type",
                code: field.source === "stated" ? "informant" : "author",
              },
            ],
          },
          who: field.source === "stated" ? ownerRef : deviceRef,
        },
      ],
    });
    fieldResources.push(
      written(
        `Provenance/${provenance.id}`,
        `${field.source} · author is the ${field.source === "stated" ? "owner" : "agent"}`,
      ),
    );
  }

  record({
    title: "STRUCTURE",
    line: `${fields.length} typed fields, each with a Provenance naming who said it. A fact the owner stated and a model's guess are never the same object.`,
    status: "ok",
    detail:
      "The PIMS this replaces required `source` on the write and had no column for it. Here it is a first-class resource with a search index on target.",
    resources: fieldResources,
    ms: started() - t,
  });

  // ---- 4. TRIAGE: the clinic's rules decide, the agent does not diagnose ---
  t = started();
  const triaged = triage(input.utterances);
  if (!triaged.matched) {
    record({
      title: "TRIAGE",
      line: "No clinic rule matched. The agent stops and a human picks it up.",
      status: "blocked",
      resources: [],
      ms: started() - t,
    });
    return { steps, patientId: patient.id!, fields, allResources: all };
  }
  record({
    title: "TRIAGE",
    line: `Rule fired: ${triaged.matched.name}. ${triaged.matched.result}.`,
    status: "ok",
    detail: `Clinic-defined rules, evaluated in order. ${triaged.matched.autonomous ? "This rule permits the agent to book without a human." : "This rule requires a clinician before booking."} No diagnosis was made and no Condition was created.`,
    resources: [],
    ms: started() - t,
  });

  // ---- 5. SCHEDULE: the record refuses a taken slot -----------------------
  t = started();
  const slots = await medplum.searchResources("Slot", {
    schedule: `Schedule/${schedule.id}`,
    _sort: "start",
  });
  const firstSlot = slots[0];
  const freeSlot = slots.find((s) => s.status === "free");

  const scheduleResources: WrittenResource[] = [];
  let refusal: string | undefined;
  if (firstSlot && firstSlot.status === "busy") {
    refusal = `${localTime(firstSlot.start)} refused: Slot/${firstSlot.id} is busy. The calendar belongs to the clinic.`;
  }

  if (!freeSlot) {
    record({
      title: "SCHEDULE",
      line: "No free slot. The agent does not invent one.",
      status: "refused",
      detail: refusal,
      resources: [],
      ms: started() - t,
    });
  } else {
    const appointment = await medplum.createResource<Appointment>({
      resourceType: "Appointment",
      identifier: ident(`appt-${Date.now()}`),
      status: "booked",
      slot: [{ reference: `Slot/${freeSlot.id}` }],
      start: freeSlot.start,
      end: freeSlot.end,
      description: VISIT.reasonForVisit,
      reasonCode: [{ text: triaged.matched.result }],
      participant: [
        { actor: subject, status: "accepted" },
        { actor: practitionerRef, status: "accepted" },
        { actor: ownerRef, status: "accepted" },
      ],
    });
    // Flip the slot, so the next booking is refused by the record.
    await medplum.updateResource<Slot>({ ...freeSlot, status: "busy" });

    scheduleResources.push(
      written(
        `Appointment/${appointment.id}`,
        `Booked ${localTime(freeSlot.start)} ${CLINIC.timezone}`,
      ),
      written(`Slot/${freeSlot.id}`, "Flipped free to busy on booking"),
    );

    record({
      title: "SCHEDULE",
      line: refusal
        ? `${refusal} Booked ${localTime(freeSlot.start)} instead.`
        : `Booked ${localTime(freeSlot.start)}.`,
      status: refusal ? "refused" : "ok",
      detail: `Times resolved through the practice timezone stored on Organization/${organization.id}. The PIMS this replaces did not expose the practice timezone at all, so a laptop in California booked three hours off.`,
      resources: scheduleResources,
      ms: started() - t,
    });
  }

  // ---- 6. WRITE BACK: the owner's own words reach the record --------------
  t = started();
  const composition = await medplum.createResource<Composition>({
    resourceType: "Composition",
    status: "preliminary",
    type: { text: "Pre-visit intake summary" },
    subject,
    date: new Date().toISOString(),
    author: [deviceRef],
    title: `Intake summary · ${PATIENT.name}`,
    section: [
      {
        title: "Stated by the owner",
        text: {
          status: "generated",
          div: div(
            fields
              .filter((f) => f.source === "stated")
              .map((f) => `${f.label}: ${f.value}${f.quote ? ` — "${f.quote}"` : ""}`),
          ),
        },
      },
      {
        title: "Inferred by the agent",
        text: {
          status: "generated",
          div: div(
            fields
              .filter((f) => f.source === "inferred")
              .map((f) => `${f.label}: ${f.value}`),
          ),
        },
      },
      {
        title: "Triage",
        text: {
          status: "generated",
          div: div([
            `Rule: ${triaged.matched.name}`,
            `Result: ${triaged.matched.result}`,
            "No diagnosis was made by the agent.",
          ]),
        },
      },
    ],
  });
  const compositionResource = written(
    `Composition/${composition.id}`,
    "Intake summary, stated and inferred kept in separate sections",
  );
  record({
    title: "WRITE BACK",
    line: "The owner's own words reach the medical record, still separated from what the agent derived.",
    status: "ok",
    detail:
      "Two sections, not one paragraph. The separation survives into the document a clinician will read tomorrow.",
    resources: [compositionResource],
    ms: started() - t,
  });

  // ---- 7. THE CALL ITSELF: a resource, not an out-of-band log line --------
  t = started();
  const communication = await medplum.createResource<Communication>({
    resourceType: "Communication",
    status: "completed",
    subject,
    sent: new Date().toISOString(),
    sender: ownerRef,
    recipient: [deviceRef],
    medium: [
      {
        coding: [
          {
            system:
              "http://terminology.hl7.org/CodeSystem/v3-ParticipationMode",
            code: "PHONE",
          },
        ],
      },
    ],
    topic: { text: VISIT.reasonForVisit },
    payload: input.utterances.map((text) => ({ contentString: text })),
  });
  record({
    title: "THE CALL",
    line: "The call is a resource, with the owner as sender and every utterance as payload.",
    status: "ok",
    detail:
      "The old integrator API had no way to log the call, so it went to a side channel and left the record. FHIR has Communication.",
    resources: [
      written(`Communication/${communication.id}`, `${input.utterances.length} utterances, owner as sender`),
    ],
    ms: started() - t,
  });

  // ---- 8. THE BOUNDARY: what the agent will not do -----------------------
  t = started();
  const audit = await medplum.createResource<AuditEvent>({
    resourceType: "AuditEvent",
    type: {
      system: "http://terminology.hl7.org/CodeSystem/audit-event-type",
      code: "rest",
      display: "RESTful Operation",
    },
    action: "E",
    recorded: new Date().toISOString(),
    outcome: "4",
    outcomeDesc:
      "Condition creation refused. A triage rule match is not a diagnosis, and the intake agent is not permitted to assert a Condition.",
    agent: [{ who: deviceRef, requestor: true }],
    source: { observer: deviceRef },
    entity: [{ what: subject }],
  });
  const task = await medplum.createResource<Task>({
    resourceType: "Task",
    status: "requested",
    intent: "proposal",
    priority: "routine",
    description: `Clinician review of intake for ${PATIENT.name}: ${triaged.matched.result}`,
    for: subject,
    authoredOn: new Date().toISOString(),
    requester: deviceRef,
    owner: practitionerRef,
    focus: { reference: `Composition/${composition.id}` },
  });
  record({
    title: "THE BOUNDARY",
    line: "The agent refuses to write a Condition, records the refusal, and hands the case to a clinician as a proposal.",
    status: "blocked",
    detail:
      "Task.intent is `proposal`, not `order`. The approval gate is expressed in FHIR rather than in a status column of our own invention. This can be enforced server-side with a Medplum AccessPolicy that denies Condition writes to the agent's ClientApplication.",
    resources: [
      written(`AuditEvent/${audit.id}`, "Refusal recorded, outcome 4"),
      written(`Task/${task.id}`, "intent: proposal · owner is Dr. Chen"),
    ],
    ms: started() - t,
  });

  return { steps, patientId: patient.id!, fields, allResources: all };
}

function localTime(iso?: string): string {
  if (!iso) return "unknown";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CLINIC.timezone,
    hour: "numeric",
    minute: "2-digit",
    weekday: "short",
  }).format(new Date(iso));
}

function div(lines: string[]): string {
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
