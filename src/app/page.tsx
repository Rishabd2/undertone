"use client";

import { useState } from "react";
import type { LoopStep, StructuredField } from "@/lib/loop";
import type { WrittenResource } from "@/lib/medplum-links";

/**
 * The console.
 *
 * The claim is that the record is real, so the screen is built to be checked
 * rather than admired: every resource the loop writes renders as a link into
 * Medplum's own app. A judge can click any of them mid-demo and see the
 * resource that was created seconds earlier.
 */

type LoopResponse = {
  steps: LoopStep[];
  fields: StructuredField[];
  allResources: WrittenResource[];
  patientId: string;
  patientUrl: string;
  provenanceUrl: string;
  animal: {
    name: string;
    species?: string;
    speciesCode?: string;
    breed?: string;
    genderStatus?: string;
    birthDate?: string;
    owner: string;
  };
  utterances: string[];
  error?: string;
};

const DEFAULT_CALL = [
  "Hi, it's Maria. Luna's been limping on her back left leg since yesterday evening.",
  "She jumped off the couch and yelped. She's putting some weight on it but not much.",
  "She's still eating fine and drinking normally. No vomiting.",
];

export default function Console() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<LoopResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [utterances] = useState(DEFAULT_CALL);

  async function run() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/loop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ utterances }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "loop failed");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-[1180px] px-5 py-6">
      <header className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-[17px] font-semibold tracking-tight">Vetra</h1>
        <span className="text-[13px] text-[var(--ink-soft)]">
          one case, carried across the workflow, written into Medplum
        </span>
        <span className="rounded-sm bg-[#fdf0ef] px-2 py-[3px] text-[10px] font-semibold tracking-wide text-[var(--alert)]">
          SYNTHETIC PATIENT
        </span>

        <div className="ml-auto flex items-center gap-2">
          <a
            href="/voice"
            className="rounded-md border px-3 py-1.5 text-[12px] font-medium rule"
          >
            Live voice intake
          </a>
          {result && (
            <a
              href={result.patientUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border px-3 py-1.5 text-[12px] font-medium rule"
            >
              Open Luna in Medplum
            </a>
          )}
          <button
            onClick={run}
            disabled={running}
            className="rounded-md bg-[var(--ink)] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
          >
            {running ? "Running..." : "Run intake"}
          </button>
        </div>
      </header>

      <p className="mb-6 max-w-[70ch] border-l-2 pl-3 text-[13px] leading-relaxed text-[var(--ink-soft)] rule">
        This ran against a self-hosted open-source PIMS before. That PIMS made{" "}
        <code className="mono text-[12px]">source</code> mandatory on every write,
        echoed it back, emitted it on the webhook, and then had no column to store
        it in. Tomorrow you could not tell an agent-written note from a
        clinician&apos;s. FHIR has had{" "}
        <code className="mono text-[12px]">Provenance</code> as a first-class
        resource the entire time, so the record moved to Medplum. Every id below is
        a link into it.
      </p>

      {error && (
        <div className="mb-6 rounded-md bg-[#fdf0ef] px-3 py-2 text-[12px] text-[var(--alert)]">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* ---- The call, and what it became --------------------------- */}
        <aside>
          {result?.animal && (
            <div className="mb-6 rounded-lg border p-3 rule">
              <SectionLabel>
                Patient · decoded from the animal extension
              </SectionLabel>
              <div className="text-[15px] font-semibold">
                {result.animal.name}
              </div>
              <div className="text-[12px] text-[var(--ink-soft)]">
                {[
                  result.animal.species,
                  result.animal.breed,
                  result.animal.genderStatus,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              <div className="text-[12px] text-[var(--ink-soft)]">
                Owner: {result.animal.owner}
              </div>
              <p className="mono mt-2 text-[10px] leading-snug text-[var(--ink-faint)]">
                patient-animal · species {result.animal.speciesCode}
              </p>
              <p className="mt-1 text-[10px] leading-snug text-[var(--ink-faint)]">
                Medplum&apos;s own patient header renders this as a human, because
                FHIR&apos;s does. The species, breed, and gender status are in the
                R4 animal extension, decoded here.
              </p>
            </div>
          )}

          <SectionLabel>The call</SectionLabel>
          <div className="mb-6 space-y-2">
            {utterances.map((line, index) => (
              <p key={index} className="text-[12px] leading-snug">
                <span className="mono mr-1.5 text-[10px] uppercase text-[var(--ink-faint)]">
                  owner
                </span>
                {line}
              </p>
            ))}
          </div>

          {result && (
            <>
              <SectionLabel>Typed fields</SectionLabel>
              <p className="mb-2 text-[11px] leading-snug text-[var(--ink-faint)]">
                A fact the owner said and a model&apos;s guess are never the same
                object.
              </p>
              <ul className="space-y-2">
                {result.fields.map((field) => (
                  <li key={field.key} className="text-[12px] leading-tight">
                    <span
                      className={`mono mr-1.5 text-[9px] uppercase ${
                        field.source === "stated"
                          ? "origin-chart"
                          : "origin-acoustic"
                      }`}
                    >
                      {field.source}
                    </span>
                    <span className="font-medium">{field.label}</span>
                    <span className="text-[var(--ink-soft)]"> · {field.value}</span>
                    {field.quote && (
                      <div className="mt-0.5 pl-1 text-[11px] italic text-[var(--ink-faint)]">
                        &ldquo;{field.quote}&rdquo;
                      </div>
                    )}
                  </li>
                ))}
              </ul>

              <div className="mt-5 rounded-lg border p-3 rule">
                <SectionLabel>Provenance ledger</SectionLabel>
                <div className="flex gap-4">
                  <div>
                    <div className="origin-chart mono text-[18px]">
                      {result.fields.filter((f) => f.source === "stated").length}
                    </div>
                    <div className="text-[10px] text-[var(--ink-faint)]">
                      owner stated
                    </div>
                  </div>
                  <div>
                    <div className="origin-acoustic mono text-[18px]">
                      {
                        result.fields.filter((f) => f.source === "inferred")
                          .length
                      }
                    </div>
                    <div className="text-[10px] text-[var(--ink-faint)]">
                      agent inferred
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-[10px] leading-snug text-[var(--ink-faint)]">
                  The old PIMS could not tell these apart. Medplum indexes
                  Provenance by target, so tomorrow you can still ask which is
                  which.
                </p>
                <a
                  href={result.provenanceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mono mt-2 inline-block text-[11px] underline decoration-dotted underline-offset-2"
                >
                  Search Provenance in Medplum
                </a>
              </div>
            </>
          )}
        </aside>

        {/* ---- The eight steps ---------------------------------------- */}
        <section>
          {!result && !running && (
            <p className="text-[13px] text-[var(--ink-faint)]">
              Run the intake. Eight steps, each one writing into Medplum, each
              resource linked so you can check it.
            </p>
          )}
          {running && (
            <p className="text-[13px] text-[var(--ink-soft)]">
              Writing into Medplum...
            </p>
          )}

          <ol className="space-y-5">
            {result?.steps.map((step) => (
              <li key={step.n} className="rise border-l-2 pl-4 rule">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="mono text-[11px] text-[var(--ink-faint)]">
                    STEP {step.n}
                  </span>
                  <span className="text-[13px] font-semibold tracking-tight">
                    {step.title}
                  </span>
                  <StatusPill status={step.status} />
                  <span className="mono ml-auto text-[10px] text-[var(--ink-faint)]">
                    {step.ms.toFixed(0)}ms
                  </span>
                </div>

                <p className="mt-1 text-[13px] leading-snug">{step.line}</p>

                {step.detail && (
                  <p className="mt-1 text-[11px] leading-snug text-[var(--ink-faint)]">
                    {step.detail}
                  </p>
                )}

                {step.resources.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {step.resources.map((resource) => (
                      <li key={resource.reference} className="text-[11px]">
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
                )}
              </li>
            ))}
          </ol>

          {result && (
            <div className="mt-8 border-t pt-4 rule">
              <SectionLabel>
                {result.allResources.length} resources written this run
              </SectionLabel>
              <p className="mb-2 text-[11px] text-[var(--ink-faint)]">
                Every one of these exists in the Medplum project right now. Open
                any of them.
              </p>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {result.allResources.map((resource) => (
                  <a
                    key={resource.reference}
                    href={resource.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mono text-[11px] underline decoration-dotted underline-offset-2"
                  >
                    {resource.reference}
                  </a>
                ))}
              </div>
            </div>
          )}
        </section>
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

function StatusPill({ status }: { status: LoopStep["status"] }) {
  const style =
    status === "ok"
      ? "bg-[#eaf3ef] text-[var(--chart)]"
      : status === "refused"
        ? "bg-[#fdf3ea] text-[var(--acoustic)]"
        : "bg-[#eef0fb] text-[var(--session)]";
  const label =
    status === "ok" ? "written" : status === "refused" ? "refused" : "handed off";
  return (
    <span
      className={`rounded-sm px-1.5 py-[2px] text-[9px] font-semibold uppercase tracking-wide ${style}`}
    >
      {label}
    </span>
  );
}
