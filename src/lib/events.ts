/**
 * The event log. Everything the system does emits one of these, and the right
 * hand column of the console renders them in order. If it is not an event, it
 * did not happen.
 */

export type UndertoneEvent =
  | { type: "visit.started"; visitId: string; keytermCount: number; at: string }
  | { type: "transcript.partial"; text: string; at: string }
  | { type: "transcript.final"; id: string; text: string; speaker: "patient" | "agent"; at: string }
  | {
      type: "retrieval.completed";
      query: string;
      indexes: number;
      sdkMs: { chart?: number; session?: number };
      totalMs: number;
      hits: number;
      at: string;
    }
  | { type: "acoustic.window.sealed"; windowId: string; seconds: number; sha256: string; at: string }
  | {
      type: "acoustic.signal.detected";
      provider: string;
      features: { label: string; value: number; unit: string }[];
      at: string;
    }
  | { type: "agent.question.spoken"; text: string; at: string }
  | { type: "followup.review_required"; proposalId: string; summary: string; at: string }
  | { type: "followup.approved"; proposalId: string; by: string; resources: string[]; at: string }
  | { type: "followup.rejected"; proposalId: string; by: string; at: string }
  | { type: "eligibility.checked"; headline: string; testMode: true; ms: number; at: string }
  | { type: "visit.ended"; visitId: string; sessionPushed: boolean; at: string }
  | { type: "error"; where: string; message: string; at: string };

export const now = () => new Date().toISOString();

/** Short label for the activity stream. */
export function eventTag(event: UndertoneEvent): string {
  switch (event.type) {
    case "visit.started":
      return "VISIT";
    case "transcript.partial":
    case "transcript.final":
      return "STT";
    case "retrieval.completed":
      return "MOSS";
    case "acoustic.window.sealed":
    case "acoustic.signal.detected":
      return "ACOUSTIC";
    case "agent.question.spoken":
      return "AGENT";
    case "followup.review_required":
      return "REVIEW";
    case "followup.approved":
      return "APPROVED";
    case "followup.rejected":
      return "REJECTED";
    case "eligibility.checked":
      return "STEDI";
    case "visit.ended":
      return "VISIT";
    case "error":
      return "ERROR";
  }
}
