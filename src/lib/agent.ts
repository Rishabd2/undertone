import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";
import type { Evidence } from "./moss";
import { PATIENT, VISIT } from "./case";
import type { ProsodicFeature } from "./prosody";

/**
 * The intake agent. Two jobs, one call:
 *   1. Decide the next question, given what the chart and the live conversation
 *      just returned from retrieval.
 *   2. When there is enough to say something useful, draft ONE follow-up
 *      proposal with its evidence kept separated by source.
 *
 * It abstains rather than guesses, and it never diagnoses. Those rules are in
 * the system prompt and enforced again by the caller.
 */

const MODEL = "claude-sonnet-5";

export type AgentTurn = {
  /** What the agent says next. Spoken via Deepgram TTS. */
  question: string;
  /** Set when the agent has enough to propose a follow-up. */
  proposal?: {
    id: string;
    summary: string;
    /** Why, split by where each piece came from. Never merged. */
    rationale: {
      transcript: string[];
      chart: string[];
      acoustic: string[];
    };
    /** What a clinician would be approving. */
    requestedAction: string;
  };
  /** True when the agent declined to propose because evidence was thin. */
  abstained: boolean;
  abstainReason?: string;
};

const SYSTEM = `You are Undertone, a pre-visit intake agent talking with a patient by voice before their appointment. You are not a clinician and you never behave like one.

PATIENT: ${PATIENT.givenName} ${PATIENT.familyName}, ${PATIENT.ageYears}, pronouns ${PATIENT.pronouns}. This is a SYNTHETIC patient for a demo.
APPOINTMENT: ${VISIT.scheduledFor} with ${VISIT.clinician}, ${VISIT.clinicianRole}.
STATED REASON: ${VISIT.reasonForVisit}

YOUR JOB
Ask one short, natural question at a time. You are gathering what the clinician will need. Sound like a careful person on the phone, not a form. Never ask two things at once. Keep each question under 25 words.

USE THE EVIDENCE
You will be given retrieved evidence, separated by origin:
  CHART evidence comes from the patient's medical record.
  SESSION evidence comes from what the patient has already said in this conversation.
Let the evidence choose your next question. If the chart shows something related that the patient has not mentioned, ask about it directly and naturally. Do not read the chart aloud verbatim. Do not say "according to your chart".
If SESSION evidence shows the patient already answered something, do not ask it again.

HARD RULES, NO EXCEPTIONS
1. Never state or imply a diagnosis. Never say "you have", "this is", "that sounds like [condition]".
2. Never interpret how the patient's voice sounds. Acoustic features are measurements for a clinician, not something you comment on to the patient.
3. Never recommend, adjust, start, or stop any medication or treatment.
4. Never promise a result, a timeline, or a cost.
5. If the patient describes something urgent (chest pain, trouble breathing at rest, fainting, one-sided weakness, thoughts of self-harm), stop gathering and tell them to contact their clinician or emergency services now. Set the proposal to an urgent clinician review.

THE PROPOSAL
When you have enough to be useful, draft exactly one follow-up proposal for the clinician. It proposes; it does not decide. Permitted framing: "screening opportunity", "worth a clinician's review", "associated with", "requires clinician review". Forbidden: "diagnosed", "confirmed", "the patient has".
Keep each rationale bullet to one sentence, and put it under the source it came from. Do not put a chart fact under transcript, or a transcript fact under chart.
If the evidence is thin, conflicting, or you have only had one or two exchanges, abstain and keep asking questions instead.

OUTPUT
Reply with a single JSON object and nothing else:
{"question": string, "abstained": boolean, "abstainReason": string | null, "proposal": null | {"summary": string, "requestedAction": string, "rationale": {"transcript": string[], "chart": string[], "acoustic": string[]}}}`;

let client: Anthropic | undefined;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: env.anthropic.apiKey });
  return client;
}

export async function nextTurn(input: {
  transcript: { speaker: "patient" | "agent"; text: string }[];
  evidence: Evidence[];
  acoustic: ProsodicFeature[];
}): Promise<AgentTurn> {
  const chartEvidence = input.evidence.filter((e) => e.origin === "chart");
  const sessionEvidence = input.evidence.filter((e) => e.origin === "session");

  const evidenceBlock = [
    "CHART evidence:",
    chartEvidence.length
      ? chartEvidence
          .map(
            (e) =>
              `  - [${e.metadata.label ?? e.id} · ${e.metadata.date ?? "undated"}] ${e.text}`,
          )
          .join("\n")
      : "  (none returned)",
    "",
    "SESSION evidence (already said in this conversation):",
    sessionEvidence.length
      ? sessionEvidence.map((e) => `  - ${e.text}`).join("\n")
      : "  (none yet)",
    "",
    "ACOUSTIC measurements (for the clinician, never for the patient):",
    input.acoustic.length
      ? input.acoustic.map((f) => `  - ${f.label}: ${f.value}${f.unit}`).join("\n")
      : "  (none yet)",
  ].join("\n");

  const conversation = input.transcript
    .map((t) => `${t.speaker === "patient" ? "Patient" : "You"}: ${t.text}`)
    .join("\n");

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 900,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Conversation so far:\n${conversation || "(the call just connected)"}\n\n${evidenceBlock}\n\nGive your next turn as JSON.`,
      },
    ],
  });

  const text = response.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();

  return parseTurn(text);
}

function parseTurn(raw: string): AgentTurn {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) {
    return {
      question: "Sorry, could you say that once more?",
      abstained: true,
      abstainReason: "agent returned unparseable output",
    };
  }
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    const proposal = parsed.proposal
      ? {
          id: `proposal-${Date.now()}`,
          summary: String(parsed.proposal.summary ?? ""),
          requestedAction: String(parsed.proposal.requestedAction ?? ""),
          rationale: {
            transcript: toLines(parsed.proposal.rationale?.transcript),
            chart: toLines(parsed.proposal.rationale?.chart),
            acoustic: toLines(parsed.proposal.rationale?.acoustic),
          },
        }
      : undefined;
    return {
      question: String(parsed.question ?? "").trim(),
      abstained: Boolean(parsed.abstained),
      abstainReason: parsed.abstainReason ?? undefined,
      proposal,
    };
  } catch {
    return {
      question: "Sorry, could you say that once more?",
      abstained: true,
      abstainReason: "agent returned invalid JSON",
    };
  }
}

function toLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v)).filter(Boolean);
}
