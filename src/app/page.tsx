"use client";

import { useEffect, useRef } from "react";
import { useVisit } from "@/lib/client/useVisit";
import { eventTag, type UndertoneEvent } from "@/lib/events";

/**
 * The console. Three columns, and the division is the argument:
 *
 *   left    the chart, which existed before the call
 *   centre  the conversation, and what the agent proposes from it
 *   right   every action the system took, with real latency
 *
 * Evidence keeps its origin colour everywhere it appears. A chart fact is never
 * rendered the same way as something the patient just said.
 */
export default function Console() {
  const { state, start, end, decide, checkCoverage } = useVisit();
  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    streamRef.current?.scrollTo({
      top: streamRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [state.events.length]);

  const live = state.status === "live";

  return (
    <main className="min-h-screen">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-3 rule">
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-semibold tracking-tight">Undertone</span>
          <span className="text-[12px] text-[var(--ink-faint)]">
            pre-visit intake
          </span>
        </div>

        <span className="rounded-sm bg-[#fdf0ef] px-2 py-[3px] text-[10px] font-semibold tracking-wide text-[var(--alert)]">
          {state.patient?.banner ?? "SYNTHETIC PATIENT"}
        </span>

        {state.model && (
          <span className="mono text-[11px] text-[var(--ink-soft)]">
            {state.model}
          </span>
        )}

        {state.keyterms.length > 0 && (
          <span
            className="mono text-[11px] text-[var(--chart)]"
            title={state.keyterms.join(", ")}
          >
            {state.keyterms.length} chart terms primed
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {live && (
            <span className="flex items-center gap-1.5 text-[11px] text-[var(--ink-soft)]">
              <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-[var(--alert)]" />
              listening
            </span>
          )}
          {state.status === "idle" || state.status === "error" ? (
            <button
              onClick={start}
              className="rounded-md bg-[var(--ink)] px-3 py-1.5 text-[12px] font-medium text-white"
            >
              Start check-in
            </button>
          ) : (
            <button
              onClick={end}
              disabled={state.status === "ended"}
              className="rounded-md border px-3 py-1.5 text-[12px] font-medium rule disabled:opacity-40"
            >
              End visit
            </button>
          )}
        </div>
      </header>

      {state.error && (
        <div className="border-b bg-[#fdf0ef] px-5 py-2 text-[12px] text-[var(--alert)] rule">
          {state.error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_320px]">
        {/* ---- Chart: what existed before the call --------------------- */}
        <aside className="border-b p-4 lg:border-r lg:border-b-0 rule">
          <SectionLabel>Patient</SectionLabel>
          {state.patient ? (
            <div className="mb-4">
              <div className="text-[14px] font-semibold">{state.patient.name}</div>
              <div className="text-[12px] text-[var(--ink-soft)]">
                {state.patient.age} · {state.patient.pronouns}
              </div>
              <div className="mono mt-0.5 text-[11px] text-[var(--ink-faint)]">
                {state.patient.mrn}
              </div>
              {state.visit && (
                <p className="mt-2 text-[12px] leading-snug text-[var(--ink-soft)]">
                  {state.visit.reasonForVisit}
                  <br />
                  <span className="text-[var(--ink-faint)]">
                    {state.visit.scheduledFor} · {state.visit.clinician}
                  </span>
                </p>
              )}
            </div>
          ) : (
            <p className="mb-4 text-[12px] text-[var(--ink-faint)]">
              Start the check-in to load the chart.
            </p>
          )}

          <SectionLabel>Chart</SectionLabel>
          <ul className="space-y-1.5">
            {state.chart.map((entry) => (
              <li key={entry.id} className="text-[12px] leading-tight">
                <span className="origin-chart">{entry.label}</span>
                <span className="mono ml-1 text-[10px] text-[var(--ink-faint)]">
                  {entry.date}
                </span>
              </li>
            ))}
          </ul>
        </aside>

        {/* ---- The conversation and what comes out of it ---------------- */}
        <section className="border-b p-5 lg:border-b-0 rule">
          <SectionLabel>Conversation</SectionLabel>
          <div className="mb-6 space-y-2">
            {state.lines.length === 0 && !state.partial && (
              <p className="text-[13px] text-[var(--ink-faint)]">
                Nothing yet. The transcript appears as it is recognized, partials
                in grey and finals in ink.
              </p>
            )}
            {state.lines.map((line) => (
              <p
                key={line.id}
                className={`rise text-[14px] leading-relaxed ${
                  line.speaker === "agent"
                    ? "text-[var(--session)]"
                    : "text-[var(--ink)]"
                }`}
              >
                <span className="mono mr-2 text-[10px] uppercase text-[var(--ink-faint)]">
                  {line.speaker}
                </span>
                {line.text}
              </p>
            ))}
            {state.partial && (
              <p className="text-[14px] leading-relaxed text-[var(--ink-faint)]">
                <span className="mono mr-2 text-[10px] uppercase">patient</span>
                {state.partial}
              </p>
            )}
          </div>

          {/* Retrieval, with the SDK's own latency, not ours. */}
          {state.evidence.length > 0 && (
            <div className="mb-6">
              <SectionLabel>
                Retrieved evidence
                {state.retrievalTiming && (
                  <span className="mono ml-2 text-[10px] font-normal text-[var(--ink-faint)]">
                    Moss · {state.retrievalTiming.indexes} indexes ·{" "}
                    {formatTimings(state.retrievalTiming.sdk)} · fused{" "}
                    {state.retrievalTiming.totalMs.toFixed(1)}ms
                  </span>
                )}
              </SectionLabel>
              <ul className="space-y-1.5">
                {state.evidence.map((item) => (
                  <li key={`${item.origin}-${item.id}`} className="rise text-[12px]">
                    <span
                      className={`mono mr-2 text-[10px] uppercase ${
                        item.origin === "chart" ? "origin-chart" : "origin-session"
                      }`}
                    >
                      {item.origin}
                    </span>
                    <span className="text-[var(--ink-soft)]">{item.text}</span>
                    <span className="mono ml-2 text-[10px] text-[var(--ink-faint)]">
                      {item.score.toFixed(3)}
                      {item.metadata.resourceId
                        ? ` · ${item.metadata.resourceId}`
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* The acoustic channel, labeled exactly as honestly as it deserves. */}
          {state.acoustic.length > 0 && (
            <div className="mb-6 rounded-lg border p-3 rule">
              <SectionLabel>
                <span className="origin-acoustic">Acoustic channel</span>
                <span className="mono ml-2 text-[10px] font-normal text-[var(--ink-faint)]">
                  local-prosody · on-device
                </span>
              </SectionLabel>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                {state.acoustic.map((feature) => (
                  <div key={feature.label} title={feature.method}>
                    <div className="mono origin-acoustic text-[13px]">
                      {feature.value}
                      <span className="ml-0.5 text-[10px]">{feature.unit}</span>
                    </div>
                    <div className="text-[10px] text-[var(--ink-faint)]">
                      {feature.label}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px] leading-snug text-[var(--ink-faint)]">
                Prosodic features computed on-device from the same audio Deepgram
                transcribed. Descriptive, not diagnostic. No condition has been
                asserted.
              </p>
            </div>
          )}

          {/* The gate. */}
          {state.proposal && (
            <div className="rounded-lg border-2 border-[var(--ink)] p-4">
              <SectionLabel>
                Proposed follow-up · clinician review required
              </SectionLabel>
              <p className="mb-1 text-[14px] font-medium">
                {state.proposal.summary}
              </p>
              <p className="mb-3 text-[13px] text-[var(--ink-soft)]">
                {state.proposal.requestedAction}
              </p>

              <Rationale
                label="From the conversation"
                origin="session"
                lines={state.proposal.rationale.transcript}
              />
              <Rationale
                label="From the chart"
                origin="chart"
                lines={state.proposal.rationale.chart}
              />
              <Rationale
                label="From the acoustic channel"
                origin="acoustic"
                lines={state.proposal.rationale.acoustic}
              />

              {!state.decision ? (
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => decide("approved")}
                    className="rounded-md bg-[var(--chart)] px-3 py-1.5 text-[12px] font-medium text-white"
                  >
                    Approve as Dr. Osei
                  </button>
                  <button
                    onClick={() => decide("rejected")}
                    className="rounded-md border px-3 py-1.5 text-[12px] font-medium rule"
                  >
                    Reject
                  </button>
                </div>
              ) : (
                <div className="mt-4">
                  <p className="text-[12px] font-medium">
                    {state.decision.decision === "approved"
                      ? "Approved. Written to Medplum:"
                      : "Rejected. Decision recorded, no Task created."}
                  </p>
                  <ul className="mono mt-1 space-y-0.5 text-[11px] text-[var(--ink-soft)]">
                    {state.decision.resources.map((resource) => (
                      <li key={resource}>{resource}</li>
                    ))}
                  </ul>

                  {/* Coverage only becomes available after approval. */}
                  {state.decision.decision === "approved" && (
                    <div className="mt-3">
                      {!state.eligibility ? (
                        <button
                          onClick={checkCoverage}
                          className="rounded-md border px-3 py-1.5 text-[12px] font-medium rule"
                        >
                          Check coverage for the approved service
                        </button>
                      ) : (
                        <p className="text-[12px]">
                          {state.eligibility.headline}
                          <span className="mono ml-2 text-[10px] text-[var(--ink-faint)]">
                            Stedi · TEST MODE ·{" "}
                            {Math.round(state.eligibility.elapsedMs)}ms
                          </span>
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        {/* ---- Everything the system did -------------------------------- */}
        <aside
          ref={streamRef}
          className="stream max-h-[70vh] overflow-y-auto p-4 lg:h-[calc(100vh-49px)] lg:max-h-none"
        >
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--stream-faint)]">
            Activity
          </div>
          <ul className="space-y-2">
            {state.events.map((event, index) => (
              <li key={index} className="rise text-[11px] leading-snug">
                <span className="mono mr-2 text-[9px] uppercase text-[var(--stream-faint)]">
                  {eventTag(event)}
                </span>
                <span className="mono">{describe(event)}</span>
              </li>
            ))}
            {state.events.length === 0 && (
              <li className="text-[11px] text-[var(--stream-faint)]">
                Every action the system takes appears here, with the latency it
                actually took.
              </li>
            )}
          </ul>
        </aside>
      </div>
    </main>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-faint)]">
      {children}
    </div>
  );
}

function Rationale({
  label,
  origin,
  lines,
}: {
  label: string;
  origin: "chart" | "session" | "acoustic";
  lines: string[];
}) {
  if (lines.length === 0) return null;
  return (
    <div className="mb-2">
      <div className={`mono origin-${origin} text-[10px] uppercase`}>{label}</div>
      <ul className="mt-0.5 space-y-0.5">
        {lines.map((line, index) => (
          <li key={index} className="text-[12px] text-[var(--ink-soft)]">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatTimings(sdk: { chart?: number; session?: number }): string {
  const parts: string[] = [];
  if (sdk.chart !== undefined) parts.push(`chart ${sdk.chart.toFixed(1)}ms`);
  if (sdk.session !== undefined)
    parts.push(`session ${sdk.session.toFixed(1)}ms`);
  return parts.join(" · ") || "no sdk timing";
}

function describe(event: UndertoneEvent): string {
  switch (event.type) {
    case "visit.started":
      return `${event.visitId} · ${event.keytermCount} keyterms primed from chart`;
    case "transcript.final":
      return `"${truncate(event.text, 60)}"`;
    case "transcript.partial":
      return truncate(event.text, 60);
    case "retrieval.completed":
      return `${event.indexes} indexes · ${event.hits} hits · fused ${event.totalMs.toFixed(1)}ms`;
    case "acoustic.window.sealed":
      return `${event.seconds}s window · sha256 ${event.sha256.slice(0, 12)}`;
    case "acoustic.signal.detected":
      return `${event.provider} · ${event.features.map((f) => `${f.label} ${f.value}${f.unit}`).join(", ")}`;
    case "agent.question.spoken":
      return `"${truncate(event.text, 60)}"`;
    case "followup.review_required":
      return `${event.proposalId} · ${truncate(event.summary, 50)}`;
    case "followup.approved":
      return `by ${event.by} · ${event.resources.join(", ")}`;
    case "followup.rejected":
      return `by ${event.by} · no Task created`;
    case "eligibility.checked":
      return `${event.headline} · TEST MODE · ${event.ms}ms`;
    case "visit.ended":
      return `${event.visitId} · session ${event.sessionPushed ? "pushed to cloud" : "not pushed"}`;
    case "error":
      return `${event.where}: ${event.message}`;
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}
