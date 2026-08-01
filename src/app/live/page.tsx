"use client";

import { useEffect, useRef, useState } from "react";
import type { WrittenResource } from "@/lib/medplum-links";

/**
 * The live view.
 *
 * This polls Medplum, not the phone. Vapi talks to whichever process hosts the
 * webhook, but this page and that process read the same record, so the call is
 * visible from anywhere: this laptop, the deployed site, a judge's phone.
 *
 * If the record is the source of truth, watching the record is watching the
 * call. That is the claim, and this page is the demonstration of it.
 */

type Field = {
  label: string;
  value: string;
  source: "stated" | "inferred";
  quote?: string;
  at?: string;
  observation: WrittenResource;
  provenance?: WrittenResource;
};

type Live = {
  patientId: string;
  fields: Field[];
  stated: number;
  inferred: number;
  outcomes: WrittenResource[];
  at: string;
  error?: string;
};

export default function LivePage() {
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(30);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const response = await fetch(`/api/live?minutes=${minutes}`, {
          cache: "no-store",
        });
        const data = await response.json();
        if (cancelled) return;
        if (data.error) setError(data.error);
        else {
          setError(null);
          setLive(data);
        }
      } catch {
        /* transient, the next tick will retry */
      }
    }
    tick();
    const id = setInterval(tick, 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [minutes]);

  return (
    <main className="mx-auto min-h-screen max-w-[900px] px-5 py-6">
      <header className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-[17px] font-semibold tracking-tight">
          Live intake
        </h1>
        <span className="flex items-center gap-1.5 text-[12px] text-[var(--ink-soft)]">
          <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-[var(--alert)]" />
          watching the record
        </span>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="rounded-md border px-2 py-1 text-[12px] rule"
          >
            <option value={5}>last 5 min</option>
            <option value={30}>last 30 min</option>
            <option value={240}>last 4 hours</option>
          </select>
          {live && (
            <a
              href={`https://app.medplum.com/Patient/${live.patientId}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border px-3 py-1.5 text-[12px] font-medium rule"
            >
              Open in Medplum
            </a>
          )}
        </div>
      </header>

      {error && (
        <div className="mb-5 rounded-md bg-[#fdf0ef] px-3 py-2 text-[12px] text-[var(--alert)]">
          {error}
        </div>
      )}

      <div className="mb-6 flex gap-6">
        <Counter n={live?.stated ?? 0} label="owner stated" tone="chart" />
        <Counter n={live?.inferred ?? 0} label="agent inferred" tone="acoustic" />
        <Counter n={live?.outcomes.length ?? 0} label="outcomes written" tone="session" />
      </div>

      <SectionLabel>Fields, as they land</SectionLabel>
      {(!live || live.fields.length === 0) && (
        <p className="mb-6 text-[13px] text-[var(--ink-faint)]">
          Nothing yet. Fields appear here the moment Haley records one.
        </p>
      )}
      <ul className="mb-8 space-y-2">
        {live?.fields.map((field) => {
          const isNew = !seen.current.has(field.observation.reference);
          seen.current.add(field.observation.reference);
          return (
            <li
              key={field.observation.reference}
              className={`${isNew ? "rise" : ""} border-l-2 pl-3 text-[13px] rule`}
            >
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span
                  className={`mono text-[9px] uppercase ${
                    field.source === "stated" ? "origin-chart" : "origin-acoustic"
                  }`}
                >
                  {field.source}
                </span>
                <span className="font-medium">{field.label}</span>
                <span className="text-[var(--ink-soft)]">{field.value}</span>
                <span className="mono ml-auto text-[10px] text-[var(--ink-faint)]">
                  {field.at ? new Date(field.at).toLocaleTimeString() : ""}
                </span>
              </div>
              {field.quote && (
                <div className="mt-0.5 text-[12px] italic text-[var(--ink-faint)]">
                  &ldquo;{field.quote}&rdquo;
                </div>
              )}
              <div className="mt-1 flex flex-wrap gap-x-3">
                <a
                  href={field.observation.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mono text-[10px] underline decoration-dotted underline-offset-2"
                >
                  {field.observation.reference}
                </a>
                {field.provenance && (
                  <a
                    href={field.provenance.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mono text-[10px] underline decoration-dotted underline-offset-2"
                  >
                    {field.provenance.reference}
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {live && live.outcomes.length > 0 && (
        <>
          <SectionLabel>What the call produced</SectionLabel>
          <ul className="space-y-1">
            {live.outcomes.map((resource) => (
              <li key={resource.reference} className="text-[12px]">
                <a
                  href={resource.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mono underline decoration-dotted underline-offset-2"
                >
                  {resource.reference}
                </a>
                <span className="ml-2 text-[var(--ink-faint)]">
                  {resource.why}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

function Counter({
  n,
  label,
  tone,
}: {
  n: number;
  label: string;
  tone: "chart" | "acoustic" | "session";
}) {
  return (
    <div>
      <div className={`mono origin-${tone} text-[26px] leading-none`}>{n}</div>
      <div className="mt-1 text-[10px] text-[var(--ink-faint)]">{label}</div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-faint)]">
      {children}
    </div>
  );
}
