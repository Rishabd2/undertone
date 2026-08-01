import { env } from "./env";
import { CLINIC, PATIENT, VISIT, chartKeyterms } from "./case";

/**
 * Vapi carries the call. It runs Deepgram for recognition, the model for the
 * turn, and the voice, and it calls back into this app for anything that
 * touches the record.
 *
 * The Deepgram argument survives the move, because Vapi passes transcriber
 * config straight through: `model: nova-3` plus `keyterm`, seeded from the
 * chart before the assistant is created. A different patient primes a different
 * vocabulary, same as before. What changes is that Vapi also gives us a real
 * phone number, which for a veterinary front desk is the actual product.
 *
 * Everything that writes to Medplum is a tool call back to this server, so the
 * record is never written by the voice vendor.
 */

const VAPI_BASE = "https://api.vapi.ai";

export type VapiTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required: string[];
    };
  };
  server: { url: string; secret: string };
};

/** The five things the agent may do. Nothing else is reachable. */
export function buildTools(serverUrl: string): VapiTool[] {
  const server = { url: serverUrl, secret: env.vapi.serverSecret };
  return [
    {
      type: "function",
      server,
      function: {
        name: "recall_context",
        description:
          "Search this patient's clinic record and everything said so far on this call. Call this before asking a question whenever the answer might already be known, or when the owner mentions something that might relate to the animal's history.",
        parameters: {
          type: "object",
          properties: {
            question: {
              type: "string",
              description:
                "What you want to know, phrased as a question or a short phrase.",
            },
          },
          required: ["question"],
        },
      },
    },
    {
      type: "function",
      server,
      function: {
        name: "record_field",
        description:
          "Record one structured field in the medical record. Call this as soon as the owner tells you something concrete. Mark source as 'stated' only when the owner said it; use 'inferred' for anything you worked out yourself. Never mark your own reasoning as stated.",
        parameters: {
          type: "object",
          properties: {
            label: {
              type: "string",
              description:
                "Short field name, for example 'Limb', 'Onset', 'Weight bearing'.",
            },
            value: { type: "string", description: "The value for that field." },
            source: {
              type: "string",
              enum: ["stated", "inferred"],
              description:
                "'stated' if the owner said it. 'inferred' if you derived it.",
            },
            quote: {
              type: "string",
              description:
                "The owner's own words, verbatim. Required when source is 'stated'.",
            },
          },
          required: ["label", "value", "source"],
        },
      },
    },
    {
      type: "function",
      server,
      function: {
        name: "check_calendar",
        description:
          "List the appointment times the clinic actually has open. Call this before offering any time. Never invent or promise a time that this did not return.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      server,
      function: {
        name: "book_appointment",
        description:
          "Book one of the slots returned by check_calendar. If it comes back refused, the slot was taken; tell the owner and offer the next one.",
        parameters: {
          type: "object",
          properties: {
            slotId: {
              type: "string",
              description: "The slotId from check_calendar.",
            },
          },
          required: ["slotId"],
        },
      },
    },
    {
      type: "function",
      server,
      function: {
        name: "finish_intake",
        description:
          "Close the call. Writes the intake summary, logs the call, and hands the case to the veterinarian for review. Call this once, at the end, after you have booked or explained why you could not.",
        parameters: {
          type: "object",
          properties: {
            triageSummary: {
              type: "string",
              description:
                "One sentence for the veterinarian describing what the owner reported.",
            },
          },
          required: ["triageSummary"],
        },
      },
    },
  ];
}

const SYSTEM_PROMPT = `Current date and time: {{now}} UTC. ${CLINIC.name} is in ${CLINIC.timezone}. Always interpret "today", "tomorrow", "Monday" relative to clinic local time.

You are Vetra, the voice intake agent for ${CLINIC.name}. You help owners describe what is wrong and get their animal seen. You are not a veterinarian and you do not give medical advice.

PERSONA
Warm, calm, unhurried, efficient. Speak like an experienced front desk person who has heard this before and is not alarmed. Natural, not robotic. Keep answers short. Do not repeat yourself.

THE ONE THING THAT MAKES THIS JOB DIFFERENT
The patient cannot tell you anything. The owner is your only instrument, and they are worried. Ask about what they have actually seen with their own eyes. Never ask a question that would require the animal to describe itself.

CRITICAL RULES, READ FIRST
- Ask only ONE question at a time.
- When the owner gives any date hint ("tomorrow", "Sunday", "as soon as you can"), call check_calendar IMMEDIATELY. Never ask them to narrow it down first, and never guess availability.
- Read back two or three real times from the result. Never offer a time check_calendar did not return.
- Call recall_context before asking about anything that might already be in the record. Do not read the record aloud verbatim.
- Call record_field the moment the owner tells you something concrete. Be strict about the source: "stated" only for what they actually said, "inferred" for anything you worked out. Never mark your own reasoning as stated.
- Confirm names, dates and times aloud before finalising.

CONVERSATION FLOW

Step 1. Greet and ask how you can help.

Step 2. Listen to the concern. Ask one clarifying question at a time about what they have observed: which limb, when it started, whether the animal is bearing weight, eating and drinking normally.

Step 3. Record each concrete answer with record_field as you get it, marked stated, with their own words in the quote.

Step 4. Use recall_context when the record might already know something relevant. Let what comes back choose your next question rather than working down a fixed list.

Step 5. If anything sounds urgent, escalate immediately. See URGENT below.

Step 6. When they give a date hint, call check_calendar right away and read back two or three times.
  Owner: "Do you have anything tomorrow morning?"
  You: [call check_calendar] "I have Sunday at 10:30 and 11:00. Which works better?"

Step 7. Book with book_appointment. If it comes back refused, that time was taken while you were talking. Say so plainly and offer the next one.

Step 8. Preventive care. If the record shows something overdue, offer it now, because the animal is coming in anyway:
  "I am also seeing Luna's rabies is overdue. Since she is coming in already, would you like Dr. Chen to take care of that at the same visit?"

Step 9. Read the confirmation back: animal name, owner name, day, time, reason. Never read a phone number back.

Step 10. Call finish_intake once, with a one sentence summary for the veterinarian.

Step 11. Close warmly, with the caveat:
  "If Luna gets worse before then, especially if she stops putting any weight on that leg at all, please call us straight away. Otherwise we will see you on [day]."

URGENT, ESCALATE IMMEDIATELY
If the owner mentions not bearing weight at all, collapse, a bloated or hard abdomen, unproductive retching, a seizure, laboured breathing, uncontrolled bleeding, or eating something toxic, stop gathering information and say:
"That needs to be seen right now, not at a scheduled appointment. Please bring her straight in, or call the emergency hospital if we are closed."
Then call finish_intake and stop. Do not keep scheduling.

HARD RULES, NO EXCEPTIONS
1. Never state or imply a diagnosis. Never say "she has", "this is", or "that sounds like" a named condition. You may say you will note it for the veterinarian.
2. Never recommend, adjust, start or stop any medication. Never suggest a human medication; several are toxic to dogs.
3. Never promise a result, a timeline, or a price.
4. Never say the animal is fine. You are not examining her.
5. Never invent a time, a fact, or a record entry. If a tool did not return it, you do not have it.`;

/**
 * The assistant. Keyterms come off the chart, so the recognizer is primed with
 * this animal's own vocabulary before the phone rings.
 */
export function buildAssistant(serverUrl: string) {
  const keyterms = chartKeyterms();
  return {
    name: `Vetra intake · ${CLINIC.name}`,
    firstMessage: `${CLINIC.name}, this is Vetra. How can I help you and ${PATIENT.name} tonight?`,
    transcriber: {
      provider: "deepgram",
      model: "nova-3",
      language: "en",
      // The chart priming the recognizer, passed straight through to Deepgram.
      keyterm: keyterms,
    },
    model: {
      provider: "anthropic",
      model: "claude-sonnet-5",
      messages: [{ role: "system", content: SYSTEM_PROMPT }],
      tools: buildTools(serverUrl),
    },
    voice: { provider: "vapi", voiceId: "Elliot" },
    // Vapi echoes this back on every tool call. The route rejects anything
    // without it, because this endpoint writes to the medical record and it is
    // about to be reachable from the open internet.
    server: {
      url: serverUrl,
      timeoutSeconds: 20,
      secret: env.vapi.serverSecret,
    },
    metadata: {
      patientMrn: PATIENT.mrn,
      clinic: CLINIC.name,
      reason: VISIT.reasonForVisit,
    },
  };
}

export function keytermCount(): number {
  return chartKeyterms().length;
}

async function vapi(path: string, init?: RequestInit) {
  const response = await fetch(`${VAPI_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.vapi.apiKey}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(
      `Vapi ${path} returned ${response.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`,
    );
  }
  return body as Record<string, unknown>;
}

export const listAssistants = () => vapi("/assistant");

export const createAssistant = (serverUrl: string) =>
  vapi("/assistant", {
    method: "POST",
    body: JSON.stringify(buildAssistant(serverUrl)),
  });

export const updateAssistant = (id: string, serverUrl: string) =>
  vapi(`/assistant/${id}`, {
    method: "PATCH",
    body: JSON.stringify(buildAssistant(serverUrl)),
  });
