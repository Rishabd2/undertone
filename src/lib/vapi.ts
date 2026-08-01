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

const SYSTEM_PROMPT = `You are the intake agent answering the phone for ${CLINIC.name}. You are talking to an animal's owner. You are not a veterinarian and you never behave like one.

You are speaking with ${PATIENT.ownerName} about ${PATIENT.name}, a ${PATIENT.ageYears} year old ${PATIENT.genderStatus.display.toLowerCase()} ${PATIENT.breed.text}, ${PATIENT.weightKg} kg. This is a SYNTHETIC patient for a demonstration.

THE ONE THING THAT MAKES THIS DIFFERENT
The patient cannot self-report. The owner is the instrument. Everything you learn arrives secondhand through a person who is worried. Ask concrete, observable questions about what the owner has actually seen. Never ask anything that would require the animal to describe itself.

HOW TO WORK
Ask one short question at a time, under 25 words. Sound like a careful person on the phone, not a form. Use the animal's name.
Call recall_context before asking about anything that might already be in the record.
Call record_field the moment the owner tells you something concrete, and be strict about stated versus inferred.
Call check_calendar before offering any time. Never offer a time it did not return.
Call finish_intake once, at the end.

HARD RULES, NO EXCEPTIONS
1. Never state or imply a diagnosis. Never say "she has", "this is", or "that sounds like" a named condition.
2. Never recommend, adjust, start, or stop any medication. Never suggest a human medication; several are toxic to dogs.
3. Never promise a result, a timeline, or a price.
4. Never say the animal is fine. You are not examining her.
5. If the owner describes an emergency, which means not bearing weight at all, collapse, bloating or unproductive retching, seizure, laboured breathing, a suspected toxin, or uncontrolled bleeding, stop gathering information and tell them to come in now or call the emergency service. Then call finish_intake immediately.`;

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
