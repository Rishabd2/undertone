import type {
  AuditEvent,
  Composition,
  Observation,
  Provenance,
  Task,
} from "@medplum/fhirtypes";
import { getMedplum, UNDERTONE_IDENTIFIER_SYSTEM } from "./medplum";
import type { ProsodicFeature } from "./prosody";

/**
 * The write-back, and the reasons it is shaped this way.
 *
 * Observation  status "preliminary", category "survey", derivedFrom the sealed
 *              audio window. A machine measured it and a human has not signed it.
 * Provenance   names the Device that authored it and the audio window it came
 *              from, so the observation is traceable to its source.
 * Task         intent "proposal" until approved, then "order" with status
 *              "requested". The approval gate is expressed in FHIR rather than
 *              in a status column of our own invention.
 * AuditEvent   written on approve AND on reject. A rejection is a clinical
 *              decision and belongs in the record.
 * Composition  the pre-visit brief, with acoustic findings in their own section.
 *
 * A Condition is never created here. A voice signal is not a diagnosis.
 */

export type ApprovalInput = {
  patientId: string;
  practitionerId: string;
  deviceId: string;
  proposal: {
    id: string;
    summary: string;
    requestedAction: string;
    rationale: {
      transcript: string[];
      chart: string[];
      acoustic: string[];
    };
  };
  acoustic: ProsodicFeature[];
  audioWindow?: { id: string; sha256: string; seconds: number };
  decision: "approved" | "rejected";
  transcript: { speaker: "patient" | "agent"; text: string }[];
};

export async function writeDecision(input: ApprovalInput): Promise<{
  resources: string[];
}> {
  const medplum = await getMedplum();
  const subject = { reference: `Patient/${input.patientId}` };
  const practitioner = { reference: `Practitioner/${input.practitionerId}` };
  const device = { reference: `Device/${input.deviceId}` };
  const recorded = new Date().toISOString();
  const written: string[] = [];

  // A rejection records the decision and nothing else. No Task is created.
  if (input.decision === "rejected") {
    const audit = await medplum.createResource<AuditEvent>(
      buildAudit({
        action: "R",
        outcomeDesc: `Clinician rejected proposal ${input.proposal.id}`,
        recorded,
        practitioner,
        device,
        subject,
      }),
    );
    written.push(`AuditEvent/${audit.id}`);
    return { resources: written };
  }

  // ---- Observation, preliminary, one per measured feature ------------------
  const observations: Observation[] = [];
  for (const feature of input.acoustic) {
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
              display: "Survey",
            },
          ],
        },
      ],
      code: { text: `Prosodic feature: ${feature.label}` },
      subject,
      effectiveDateTime: recorded,
      performer: [device],
      valueQuantity: {
        value: feature.value,
        unit: feature.unit || "1",
      },
      note: [
        {
          text: `${feature.method}. Descriptive acoustic measurement, not diagnostic. Requires clinician review.`,
        },
      ],
      ...(input.audioWindow
        ? {
            derivedFrom: [
              {
                display: `Audio window ${input.audioWindow.id} · sha256 ${input.audioWindow.sha256.slice(0, 16)} · ${input.audioWindow.seconds}s`,
              },
            ],
          }
        : {}),
    });
    observations.push(observation);
    written.push(`Observation/${observation.id}`);
  }

  // ---- Provenance: who authored the observations, and from what ------------
  if (observations.length > 0) {
    const provenance = await medplum.createResource<Provenance>({
      resourceType: "Provenance",
      target: observations.map((o) => ({ reference: `Observation/${o.id}` })),
      recorded,
      activity: {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/v3-DataOperation",
            code: "CREATE",
          },
        ],
      },
      agent: [
        {
          type: {
            coding: [
              {
                system:
                  "http://terminology.hl7.org/CodeSystem/provenance-participant-type",
                code: "author",
              },
            ],
          },
          who: device,
        },
        {
          type: {
            coding: [
              {
                system:
                  "http://terminology.hl7.org/CodeSystem/provenance-participant-type",
                code: "verifier",
              },
            ],
          },
          who: practitioner,
        },
      ],
      ...(input.audioWindow
        ? {
            entity: [
              {
                role: "source",
                what: {
                  display: `Audio window ${input.audioWindow.id} · sha256 ${input.audioWindow.sha256}`,
                },
              },
            ],
          }
        : {}),
    });
    written.push(`Provenance/${provenance.id}`);
  }

  // ---- Task: proposal becomes an order at the moment of approval -----------
  const task = await medplum.createResource<Task>({
    resourceType: "Task",
    identifier: [
      { system: UNDERTONE_IDENTIFIER_SYSTEM, value: input.proposal.id },
    ],
    status: "requested",
    intent: "order",
    priority: "routine",
    description: input.proposal.requestedAction,
    for: subject,
    authoredOn: recorded,
    lastModified: recorded,
    requester: practitioner,
    owner: practitioner,
    note: [
      { text: `Proposal summary: ${input.proposal.summary}` },
      ...input.proposal.rationale.transcript.map((t) => ({
        text: `Transcript evidence: ${t}`,
      })),
      ...input.proposal.rationale.chart.map((t) => ({
        text: `Chart evidence: ${t}`,
      })),
      ...input.proposal.rationale.acoustic.map((t) => ({
        text: `Acoustic evidence (descriptive, not diagnostic): ${t}`,
      })),
    ],
  });
  written.push(`Task/${task.id}`);

  // ---- Composition: the pre-visit brief the clinician reads ---------------
  const composition = await medplum.createResource<Composition>({
    resourceType: "Composition",
    status: "preliminary",
    type: { text: "Pre-visit intake brief" },
    subject,
    date: recorded,
    author: [device],
    title: "Undertone pre-visit brief",
    attester: [{ mode: "professional", time: recorded, party: practitioner }],
    section: [
      {
        title: "What the patient said",
        text: {
          status: "generated",
          div: divOf(
            input.transcript
              .filter((t) => t.speaker === "patient")
              .map((t) => t.text),
          ),
        },
      },
      {
        title: "From the chart",
        text: {
          status: "generated",
          div: divOf(input.proposal.rationale.chart),
        },
      },
      {
        title: "Acoustic signals, clinician review required",
        text: {
          status: "generated",
          div: divOf([
            ...input.acoustic.map(
              (f) => `${f.label}: ${f.value}${f.unit} (${f.method})`,
            ),
            "Descriptive acoustic measurements. Not diagnostic. No condition has been asserted.",
          ]),
        },
      },
      {
        title: "Proposed follow-up, approved by clinician",
        text: {
          status: "generated",
          div: divOf([input.proposal.summary, input.proposal.requestedAction]),
        },
      },
    ],
  });
  written.push(`Composition/${composition.id}`);

  // ---- AuditEvent: the approval itself ------------------------------------
  const audit = await medplum.createResource<AuditEvent>(
    buildAudit({
      action: "C",
      outcomeDesc: `Clinician approved proposal ${input.proposal.id}. Created ${written.join(", ")}`,
      recorded,
      practitioner,
      device,
      subject,
    }),
  );
  written.push(`AuditEvent/${audit.id}`);

  return { resources: written };
}

function buildAudit(args: {
  action: "C" | "R";
  outcomeDesc: string;
  recorded: string;
  practitioner: { reference: string };
  device: { reference: string };
  subject: { reference: string };
}): AuditEvent {
  return {
    resourceType: "AuditEvent",
    type: {
      system: "http://terminology.hl7.org/CodeSystem/audit-event-type",
      code: "rest",
      display: "RESTful Operation",
    },
    action: args.action,
    recorded: args.recorded,
    outcome: "0",
    outcomeDesc: args.outcomeDesc,
    agent: [
      {
        who: args.practitioner,
        requestor: true,
      },
      {
        who: args.device,
        requestor: false,
      },
    ],
    source: { observer: args.device },
    entity: [{ what: args.subject }],
  };
}

/** FHIR narrative div. Escaped, because this text came from a conversation. */
function divOf(lines: string[]): string {
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
