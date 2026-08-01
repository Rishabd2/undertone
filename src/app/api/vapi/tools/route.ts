import { NextResponse } from "next/server";
import type {
  Appointment,
  AuditEvent,
  Communication,
  Composition,
  Observation,
  Provenance,
  Slot,
  Task,
} from "@medplum/fhirtypes";
import { getMedplum, UNDERTONE_IDENTIFIER_SYSTEM } from "@/lib/medplum";
import { retrieve, indexUtterance } from "@/lib/moss";
import { CLINIC, PATIENT, VISIT } from "@/lib/case";
import {
  buildCallCommunication,
  buildFieldObservation,
  buildFieldProvenance,
  buildIntakeComposition,
} from "@/lib/fhir-builders";
import { written, type WrittenResource } from "@/lib/medplum-links";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every tool the voice agent can call.
 *
 * Vapi runs the call. It never writes to the record. Anything that touches
 * Medplum comes back through here, so the record has exactly one author and the
 * voice vendor is not it.
 *
 * Vapi posts { message: { type: "tool-calls", toolCallList: [{ id, name,
 * arguments }] } } and expects { results: [{ toolCallId, result }] }.
 */

type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

/**
 * Per-call state, keyed by Vapi call id. In-process on purpose: a demo runs one
 * call at a time, and a database here would be scaffolding nobody looks at.
 */
type CallState = {
  fields: Array<{
    label: string;
    value: string;
    source: "stated" | "inferred";
    quote?: string;
  }>;
  utterances: string[];
  written: WrittenResource[];
};
const calls = new Map<string, CallState>();

function stateFor(callId: string): CallState {
  let state = calls.get(callId);
  if (!state) {
    state = { fields: [], utterances: [], written: [] };
    calls.set(callId, state);
  }
  return state;
}

/** The seeded actors, resolved once per process. */
async function actors() {
  const medplum = await getMedplum();
  const on = (value: string) =>
    `identifier=${UNDERTONE_IDENTIFIER_SYSTEM}|${value}`;
  const [patient, practitioner, device, owner, schedule] = await Promise.all([
    medplum.searchOne("Patient", on(PATIENT.mrn)),
    medplum.searchOne("Practitioner", on("clinician-chen")),
    medplum.searchOne("Device", on("vetra-intake-agent")),
    medplum.searchOne("RelatedPerson", on("owner-maria")),
    medplum.searchOne("Schedule", on("schedule-chen")),
  ]);
  if (!patient?.id || !practitioner?.id || !device?.id || !owner?.id || !schedule?.id) {
    throw new Error("Clinic resources missing. Run `npm run seed`.");
  }
  return {
    medplum,
    subject: { reference: `Patient/${patient.id}` as const },
    practitionerRef: { reference: `Practitioner/${practitioner.id}` as const },
    deviceRef: { reference: `Device/${device.id}` as const },
    ownerRef: { reference: `RelatedPerson/${owner.id}` as const },
    scheduleId: schedule.id,
    patientId: patient.id,
  };
}

export async function POST(request: Request) {
  // This endpoint writes to the medical record and is reachable from the open
  // internet, so it authenticates before it does anything else. Vapi sends the
  // secret from the assistant's server config on every call.
  const presented =
    request.headers.get("x-vapi-secret") ??
    request.headers.get("x-vapi-signature") ??
    "";
  if (!env.vapi.serverSecret || presented !== env.vapi.serverSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ results: [] });
  }

  const message = body?.message;
  const callId: string = message?.call?.id ?? "demo-call";
  const toolCalls: ToolCall[] = message?.toolCallList ?? message?.toolCalls ?? [];

  if (message?.type !== "tool-calls" || toolCalls.length === 0) {
    // Vapi sends many other message types (status-update, transcript, end-of-call).
    // Capture the owner's words for retrieval, then acknowledge and move on.
    if (message?.type === "transcript" && message?.role === "user") {
      const text = String(message.transcript ?? "").trim();
      if (text) {
        const state = stateFor(callId);
        state.utterances.push(text);
        void indexUtterance({
          visitId: callId,
          id: `utt-${Date.now()}`,
          text,
          speaker: "patient",
          at: new Date().toISOString(),
        }).catch(() => undefined);
      }
    }
    return NextResponse.json({ results: [] });
  }

  const results = await Promise.all(
    toolCalls.map(async (call) => {
      try {
        const result = await dispatch(callId, call);
        return { toolCallId: call.id, result };
      } catch (err) {
        return {
          toolCallId: call.id,
          result: `That did not work: ${err instanceof Error ? err.message : String(err)}. Tell the owner you will have someone from the clinic call back, and do not retry.`,
        };
      }
    }),
  );

  return NextResponse.json({ results });
}

async function dispatch(callId: string, call: ToolCall): Promise<unknown> {
  const state = stateFor(callId);

  switch (call.name) {
    // ---- Retrieval, on the critical path of the conversation -------------
    case "recall_context": {
      const question = String(call.arguments.question ?? "");
      const retrieval = await retrieve({
        patientId: PATIENT.id,
        visitId: callId,
        query: question,
        topK: 3,
      });
      if (retrieval.evidence.length === 0) {
        return "Nothing in the record about that.";
      }
      return {
        found: retrieval.evidence.map((e) => ({
          from: e.origin === "chart" ? "clinic record" : "earlier on this call",
          text: e.text,
        })),
        retrievalMs: Number(retrieval.totalMs.toFixed(1)),
        note: "Use this to choose your next question. Do not read it aloud verbatim.",
      };
    }

    // ---- The provenance beat --------------------------------------------
    case "record_field": {
      const label = String(call.arguments.label ?? "").trim();
      const value = String(call.arguments.value ?? "").trim();
      const source =
        call.arguments.source === "stated" ? "stated" : "inferred";
      const quote = call.arguments.quote
        ? String(call.arguments.quote)
        : undefined;
      if (!label || !value) return "Need both a label and a value.";

      const { medplum, subject, deviceRef, ownerRef } = await actors();
      const now = new Date().toISOString();

      const observation = await medplum.createResource<Observation>(
        buildFieldObservation({
          subject,
          device: deviceRef,
          label,
          value,
          quote,
          effectiveDateTime: now,
        }),
      );
      const provenance = await medplum.createResource<Provenance>(
        buildFieldProvenance({
          target: { reference: `Observation/${observation.id}` },
          source,
          owner: ownerRef,
          device: deviceRef,
          recorded: now,
        }),
      );

      state.fields.push({ label, value, source, quote });
      state.written.push(
        written(`Observation/${observation.id}`, `${label}: ${value} (${source})`),
        written(
          `Provenance/${provenance.id}`,
          `${source} · author is the ${source === "stated" ? "owner" : "agent"}`,
        ),
      );
      return `Recorded ${label} as ${value}, marked ${source}.`;
    }

    // ---- The calendar belongs to the clinic ------------------------------
    case "check_calendar": {
      const { medplum, scheduleId } = await actors();
      const slots = await medplum.searchResources("Slot", {
        schedule: `Schedule/${scheduleId}`,
        status: "free",
        _sort: "start",
        _count: "4",
      });
      if (slots.length === 0) {
        return "Nothing open. Tell the owner the clinic will call back with a time.";
      }
      return {
        open: slots.map((slot) => ({
          slotId: slot.id,
          time: localTime(slot.start),
        })),
        note: "Offer one of these. Do not offer any other time.",
      };
    }

    case "book_appointment": {
      const slotId = String(call.arguments.slotId ?? "");
      const { medplum, subject, practitionerRef, ownerRef } = await actors();
      const slot = await medplum.readResource("Slot", slotId);

      // The record refuses, not our code.
      if (slot.status !== "free") {
        return `That time was just taken. Offer the owner the next one instead.`;
      }

      const appointment = await medplum.createResource<Appointment>({
        resourceType: "Appointment",
        status: "booked",
        slot: [{ reference: `Slot/${slot.id}` }],
        start: slot.start,
        end: slot.end,
        description: VISIT.reasonForVisit,
        participant: [
          { actor: subject, status: "accepted" },
          { actor: practitionerRef, status: "accepted" },
          { actor: ownerRef, status: "accepted" },
        ],
      });
      await medplum.updateResource<Slot>({ ...slot, status: "busy" });

      state.written.push(
        written(`Appointment/${appointment.id}`, `Booked ${localTime(slot.start)}`),
        written(`Slot/${slot.id}`, "Flipped free to busy on booking"),
      );
      return `Booked for ${localTime(slot.start)}. Confirm that back to the owner.`;
    }

    // ---- Close the call and hand it to a human ---------------------------
    case "finish_intake": {
      const triageSummary = String(call.arguments.triageSummary ?? "");
      const { medplum, subject, deviceRef, ownerRef, practitionerRef } =
        await actors();
      const now = new Date().toISOString();

      const composition = await medplum.createResource<Composition>(
        buildIntakeComposition({
          subject,
          author: deviceRef,
          date: now,
          stated: state.fields
            .filter((f) => f.source === "stated")
            .map(
              (f) =>
                `${f.label}: ${f.value}${f.quote ? `. Owner's words: "${f.quote}"` : ""}`,
            ),
          inferred: state.fields
            .filter((f) => f.source === "inferred")
            .map((f) => `${f.label}: ${f.value}`),
          triage: [triageSummary, "No diagnosis was made by the agent."],
        }),
      );

      const communication = await medplum.createResource<Communication>(
        buildCallCommunication({
          subject,
          sender: ownerRef,
          recipient: deviceRef,
          topic: VISIT.reasonForVisit,
          utterances: state.utterances.length
            ? state.utterances
            : ["Call transcript not captured."],
          sent: now,
        }),
      );

      // The boundary. A triage summary is not a diagnosis, so no Condition.
      const audit = await medplum.createResource<AuditEvent>({
        resourceType: "AuditEvent",
        type: {
          system: "http://terminology.hl7.org/CodeSystem/audit-event-type",
          code: "rest",
          display: "RESTful Operation",
        },
        action: "E",
        recorded: now,
        outcome: "4",
        outcomeDesc:
          "Condition creation refused. The intake agent may not assert a diagnosis.",
        agent: [{ who: deviceRef, requestor: true }],
        source: { observer: deviceRef },
        entity: [{ what: subject }],
      });

      const task = await medplum.createResource<Task>({
        resourceType: "Task",
        status: "requested",
        intent: "proposal",
        priority: "routine",
        description: `Clinician review of intake for ${PATIENT.name}: ${triageSummary}`,
        for: subject,
        authoredOn: now,
        requester: deviceRef,
        owner: practitionerRef,
        focus: { reference: `Composition/${composition.id}` },
      });

      state.written.push(
        written(`Composition/${composition.id}`, "Intake summary, sources separated"),
        written(`Communication/${communication.id}`, "The call itself"),
        written(`AuditEvent/${audit.id}`, "Refusal to assert a diagnosis"),
        written(`Task/${task.id}`, "intent: proposal, owner is Dr. Chen"),
      );

      return `Intake closed. ${state.written.length} resources in the record, and Dr. Chen has it for review. Thank the owner and end the call.`;
    }

    default:
      return `No tool named ${call.name}.`;
  }
}

/** What the caller hears is clinic local time, resolved through the record. */
function localTime(iso?: string): string {
  if (!iso) return "an unconfirmed time";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CLINIC.timezone,
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** Read what a call wrote, for the console. */
export async function GET(request: Request) {
  const callId = new URL(request.url).searchParams.get("callId") ?? "demo-call";
  const state = calls.get(callId);
  return NextResponse.json({
    callId,
    fields: state?.fields ?? [],
    written: state?.written ?? [],
    utterances: state?.utterances ?? [],
  });
}
