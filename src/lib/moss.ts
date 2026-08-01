import type { MossClient, SessionIndex } from "@moss-dev/moss";
import { env } from "./env";
import { chartIndexName, sessionIndexName } from "./case";

/**
 * Retrieval layer.
 *
 * Two indexes, queried together on every finalized utterance:
 *   chart-{patientId}   cloud index, loaded into memory so queries are local
 *   session-{visitId}   live SessionIndex, holding the conversation so far
 *
 * The Moss SDK (v1.4.x) queries one index per call, so "two indexes" means two
 * parallel queries fused into a single global top-K. That is what the UI says.
 * It does not claim a single-call multi-index API, because there isn't one.
 */

export type Evidence = {
  id: string;
  text: string;
  score: number;
  /** Which index answered. Drives the source separation in the UI. */
  origin: "chart" | "session";
  metadata: Record<string, string>;
};

export type RetrievalResult = {
  evidence: Evidence[];
  /** Milliseconds, as reported by the Moss SDK, per index. Never estimated. */
  timings: { chart?: number; session?: number };
  /** Wall-clock for the fused call, measured around Promise.all. */
  totalMs: number;
  indexesQueried: number;
};

let clientPromise: Promise<MossClient> | undefined;

/**
 * Moss ships a native Rust binding. Importing it at module scope makes the
 * Next build fail while collecting page data, because the build environment
 * loads route modules without being able to resolve the platform binary. So the
 * import happens on first use, at runtime, where the right binary is present.
 */
export function getMoss(): Promise<MossClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { MossClient: Client } = await import("@moss-dev/moss");
      return new Client(env.moss.projectId, env.moss.projectKey);
    })().catch((err) => {
      clientPromise = undefined;
      throw err;
    });
  }
  return clientPromise;
}

/** Chart indexes already pulled into memory this process. */
const loadedCharts = new Set<string>();

export async function ensureChartLoaded(patientId: string): Promise<string> {
  const name = chartIndexName(patientId);
  if (!loadedCharts.has(name)) {
    const moss = await getMoss();
    await moss.loadIndex(name);
    loadedCharts.add(name);
  }
  return name;
}

/** Live session indexes, one per visit, held for the life of the process. */
const sessions = new Map<string, SessionIndex>();

export async function getSession(visitId: string): Promise<SessionIndex> {
  const name = sessionIndexName(visitId);
  let session = sessions.get(name);
  if (!session) {
    const moss = await getMoss();
    session = await moss.session(name);
    sessions.set(name, session);
  }
  return session;
}

/**
 * Hybrid weighting, tuned by what is being asked.
 * Symptom language is semantic. Drug and lab names are lexical.
 */
export function alphaFor(query: string): number {
  const lexical =
    /\b(mg|mcg|milligram|microgram|a1c|tsh|bnp|levothyroxine|metformin|lisinopril|atorvastatin|sulfamethoxazole)\b/i;
  return lexical.test(query) ? 0.3 : 0.9;
}

/**
 * The ambient retrieval call. Fires on every transcript.final, before the LLM
 * turn, so retrieval sits on the critical path rather than annotating after.
 */
export async function retrieve(opts: {
  patientId: string;
  visitId: string;
  query: string;
  topK?: number;
  /** Optional metadata filter, e.g. recency scoping on the chart index. */
  chartFilter?: unknown;
}): Promise<RetrievalResult> {
  const { patientId, visitId, query, topK = 4, chartFilter } = opts;
  const alpha = alphaFor(query);
  const started = performance.now();

  const moss = await getMoss();
  const chartIndex = await ensureChartLoaded(patientId);
  const session = await getSession(visitId);

  const [chartResult, sessionResult] = await Promise.all([
    moss
      .query(chartIndex, query, { topK, alpha, filter: chartFilter })
      .catch(() => undefined),
    session.query(query, { topK, alpha }).catch(() => undefined),
  ]);

  const totalMs = performance.now() - started;

  const evidence: Evidence[] = [
    ...(chartResult?.docs ?? []).map((d) => ({
      id: d.id,
      text: d.text,
      score: d.score,
      origin: "chart" as const,
      metadata: d.metadata ?? {},
    })),
    ...(sessionResult?.docs ?? []).map((d) => ({
      id: d.id,
      text: d.text,
      score: d.score,
      origin: "session" as const,
      metadata: d.metadata ?? {},
    })),
  ]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return {
    evidence,
    timings: {
      chart: chartResult?.timeTakenInMs,
      session: sessionResult?.timeTakenInMs,
    },
    totalMs,
    indexesQueried: (chartResult ? 1 : 0) + (sessionResult ? 1 : 0),
  };
}

/** Add a finalized utterance to the live session index as it arrives. */
export async function indexUtterance(opts: {
  visitId: string;
  id: string;
  text: string;
  speaker: "patient" | "agent";
  at: string;
}): Promise<void> {
  const session = await getSession(opts.visitId);
  await session.addDocs([
    {
      id: opts.id,
      text: opts.text,
      metadata: {
        speaker: opts.speaker,
        date: opts.at,
        source: "transcript",
        visitId: opts.visitId,
      },
    },
  ]);
}

/**
 * At visit end the session becomes a persistent cloud index, so this
 * conversation is retrievable at the next visit.
 */
export async function persistSession(visitId: string) {
  const session = sessions.get(sessionIndexName(visitId));
  if (!session) return { pushed: false as const };
  await session.pushIndex();
  return { pushed: true as const, index: sessionIndexName(visitId) };
}
