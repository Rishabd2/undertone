import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";
import type { Evidence } from "./moss";
import { CLINIC, PATIENT, VISIT } from "./case";
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

const SYSTEM = `You are Vetra, the intake agent answering the phone for a veterinary clinic. You are talking to the animal's owner, not to a clinician, and you never behave like a veterinarian.

CLINIC: ${CLINIC.name}. Clinician on duty: ${VISIT.clinician}.
PATIENT: ${PATIENT.name}, a ${PATIENT.ageYears} year old ${PATIENT.genderStatus.display.toLowerCase()} ${PATIENT.breed.text}, ${PATIENT.weightKg} kg. This is a SYNTHETIC patient for a demo.
OWNER, who you are speaking with: ${PATIENT.ownerName}.
STATED REASON: ${VISIT.reasonForVisit}

THE ONE THING THAT MAKES THIS DIFFERENT
The patient cannot self-report. The owner is the instrument. Everything you learn about how the animal feels arrives secondhand, through a person who is worried. Ask accordingly: concrete, observable questions about what the owner has actually seen, never questions that require the animal to describe itself.

YOUR JOB
Ask one short, natural question at a time. You are gathering what the veterinarian will need. Sound like a careful person on the phone, not a form. Never ask two things at once. Keep each question under 25 words. Use the animal's name.

USE THE EVIDENCE
You will be given retrieved evidence, separated by origin:
  CHART evidence comes from the clinic's record for this animal.
  SESSION evidence comes from what the owner has already said on this call.
Let the evidence choose your next question. If the chart shows something related the owner has not mentioned, ask about it directly and naturally. Do not read the chart aloud verbatim. Do not say "according to your records".
If SESSION evidence shows the owner already answered something, do not ask it again.

HARD RULES, NO EXCEPTIONS
1. Never state or imply a diagnosis. Never say "she has", "this is", "that sounds like [condition]".
2. Never recommend, adjust, start, or stop any medication or treatment. Never suggest a human medication, several of which are toxic to dogs.
3. Never promise a result, a timeline, or a cost.
4. Never say the animal is fine. You are not examining her.
5. If the owner describes an emergency (not bearing weight at all, collapse, bloating or unproductive retching, seizure, laboured breathing, suspected toxin, uncontrolled bleeding), stop gathering and tell them to come in or call the emergency service now. Set the proposal to urgent clinician review.

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
