"use client";

import { useEffect, useState } from "react";

/**
 * The clinician dashboard.
 *
 * Medplum is a headless FHIR backend. app.medplum.com is an admin console aimed
 * at developers, and Medplum deliberately does not ship a clinical UI, because
 * every practice's workflow differs. This is that UI: the thing a veterinarian
 * actually opens, reading the same record the intake agent writes to.
 *
 * It interprets nothing. Every value here is a field on a FHIR resource, and
 * every row links to that resource.
 */

type RosterEntry = {
  id: string;
  name: string;
  species?: string;
  breed?: string;
  genderStatus?: string;
  birthDate?: string;
  nextAppointment?: string;
  openTasks: number;
  url: string;
};

type QueueEntry = {
  id: string;
  description: string;
  intent?: string;
  priority?: string;
  authoredOn?: string;
  patientName: string;
  patientId?: string;
  url: string;
};

type Chart = {
  patient: {
    id: string;
    name: string;
    species?: string;
    speciesCode?: string;
    breed?: string;
    genderStatus?: string;
    birthDate?: string;
    url: string;
  };
  owner?: { name?: string; phone?: string };
  intake: {
    label: string;
    value: string;
    source: "stated" | "inferred";
    quote?: string;
    at?: string;
    url: string;
    reference: string;
  }[];
  stated: number;
  inferred: number;
  vitals: { label: string; value: string; date?: string; url: string }[];
  immunizations: {
    label: string;
    date?: string;
    note?: string;
    overdue: boolean;
    url: string;
  }[];
  appointments: {
    start?: string;
    status?: string;
    description?: string;
    url: string;
  }[];
  notes: {
    title: string;
    status?: string;
    date?: string;
    sections: { title?: string; html: string }[];
    url: string;
  }[];
  calls: {
    sent?: string;
    topic?: string;
    utterances: string[];
    url: string;
  }[];
  tasks: { description?: string; status?: string; intent?: string; url: string }[];
};

export default function Clinic() {
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [chart, setChart] = useState<Chart | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch("/api/clinic", { cache: "no-store" });
        const d = await r.json();
        if (cancelled) return;
        if (d.error) return setError(d.error);
        setRoster(d.roster);
        setQueue(d.queue);
        setSelected((s) => s ?? d.roster[0]?.id ?? null);
      } catch {
        /* next tick retries */
      }
    }
    load();
    const id = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    async function load() {
      const r = await fetch(`/api/clinic/patient?id=${selected}`, {
        cache: "no-store",
      });
      const d = await r.json();
      if (!cancelled && !d.error) setChart(d);
    }
    load();
    const id = setInterval(load, 2500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [selected]);

  return (
    <main className="min-h-screen">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-3 rule">
        <span className="text-[15px] font-semibold tracking-tight">
          Urbana Paws Clinic
        </span>
        <span className="text-[12px] text-[var(--ink-soft)]">
          Dr. Elaine Chen
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-[var(--ink-soft)]">
          <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-[var(--chart)]" />
          reading Medplum live
        </span>
        <div className="ml-auto flex gap-2">
          <a href="/carevet" className="rounded-md border px-3 py-1.5 text-[12px] rule">
            careVet demo
          </a>
          <a href="/vetra-demo" className="rounded-md border px-3 py-1.5 text-[12px] rule">
            HTML demo
          </a>
          <a href="/live" className="rounded-md border px-3 py-1.5 text-[12px] rule">
            Live call
          </a>
          {chart && (
            <a
              href={chart.patient.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border px-3 py-1.5 text-[12px] rule"
            >
              Open in Medplum
            </a>
          )}
        </div>
      </header>

      {error && (
        <div className="border-b bg-[#fdf0ef] px-5 py-2 text-[12px] text-[var(--alert)] rule">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[230px_minmax(0,1fr)_300px]">
        {/* ---- Patients ------------------------------------------------ */}
        <aside className="border-b p-4 lg:border-r lg:border-b-0 rule">
          <Label>Patients</Label>
          <ul className="space-y-1">
            {roster.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => setSelected(p.id)}
                  className={`w-full rounded-md px-2 py-1.5 text-left text-[12px] ${
                    selected === p.id ? "bg-[#eef1f5]" : ""
                  }`}
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="block text-[11px] text-[var(--ink-faint)]">
                    {[p.species, p.breed].filter(Boolean).join(" · ")}
                  </span>
                  {p.openTasks > 0 && (
                    <span className="mono text-[10px] text-[var(--acoustic)]">
                      {p.openTasks} awaiting review
                    </span>
                  )}
                </button>
              </li>
            ))}
            {roster.length === 0 && (
              <li className="text-[12px] text-[var(--ink-faint)]">
                No patients. Run the seed.
              </li>
            )}
          </ul>
        </aside>

        {/* ---- The chart ----------------------------------------------- */}
        <section className="border-b p-5 lg:border-b-0 rule">
          {!chart ? (
            <p className="text-[13px] text-[var(--ink-faint)]">Loading chart...</p>
          ) : (
            <>
              <div className="mb-5 rounded-lg border p-4 rule">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <h2 className="text-[20px] font-semibold tracking-tight">
                    {chart.patient.name}
                  </h2>
                  <span className="text-[13px] text-[var(--ink-soft)]">
                    {[
                      chart.patient.species,
                      chart.patient.breed,
                      chart.patient.genderStatus,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-5 text-[12px] text-[var(--ink-soft)]">
                  {chart.owner?.name && <span>Owner: {chart.owner.name}</span>}
                  {chart.owner?.phone && <span>{chart.owner.phone}</span>}
                  {chart.patient.birthDate && (
                    <span>DOB {chart.patient.birthDate}</span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {chart.immunizations.map((i) => (
                    <a
                      key={i.url}
                      href={i.url}
                      target="_blank"
                      rel="noreferrer"
                      className={`text-[11px] ${i.overdue ? "font-semibold text-[var(--alert)]" : "text-[var(--ink-soft)]"}`}
                    >
                      {i.label}
                      {i.overdue ? " · OVERDUE" : ""}
                    </a>
                  ))}
                  {chart.vitals.slice(0, 2).map((v) => (
                    <span key={v.url} className="text-[11px] text-[var(--ink-soft)]">
                      {v.label} {v.value}
                    </span>
                  ))}
                </div>
              </div>

              {chart.appointments.length > 0 && (
                <div className="mb-5">
                  <Label>Appointments</Label>
                  {chart.appointments.slice(0, 3).map((a) => (
                    <a
                      key={a.url}
                      href={a.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-[13px]"
                    >
                      {a.start ? new Date(a.start).toLocaleString() : "unscheduled"}
                      <span className="ml-2 text-[var(--ink-soft)]">
                        {a.description}
                      </span>
                      <span className="mono ml-2 text-[10px] text-[var(--ink-faint)]">
                        {a.status}
                      </span>
                    </a>
                  ))}
                </div>
              )}

              {chart.intake.length > 0 && (
                <div className="mb-5">
                  <Label>
                    Intake from the call
                    <span className="mono ml-2 font-normal text-[10px] text-[var(--ink-faint)]">
                      {chart.stated} owner stated · {chart.inferred} agent inferred
                    </span>
                  </Label>
                  <ul className="space-y-1.5">
                    {chart.intake.slice(0, 12).map((f) => (
                      <li key={f.reference} className="text-[12px] leading-tight">
                        <span
                          className={`mono mr-1.5 text-[9px] uppercase ${
                            f.source === "stated"
                              ? "origin-chart"
                              : "origin-acoustic"
                          }`}
                        >
                          {f.source}
                        </span>
                        <span className="font-medium">{f.label}</span>
                        <span className="text-[var(--ink-soft)]"> {f.value}</span>
                        {f.quote && (
                          <div className="mt-0.5 text-[11px] italic text-[var(--ink-faint)]">
                            &ldquo;{f.quote}&rdquo;
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {chart.notes.length > 0 && (
                <div className="mb-5">
                  <Label>Notes</Label>
                  {chart.notes.slice(0, 2).map((n) => (
                    <div key={n.url} className="mb-3 rounded-lg border p-3 rule">
                      <div className="mb-1 flex items-baseline gap-2">
                        <span className="text-[13px] font-medium">{n.title}</span>
                        <span className="mono rounded-sm bg-[#fdf3ea] px-1.5 py-[1px] text-[9px] uppercase text-[var(--acoustic)]">
                          {n.status}
                        </span>
                        <a
                          href={n.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mono ml-auto text-[10px] underline decoration-dotted"
                        >
                          open
                        </a>
                      </div>
                      {n.sections.map((s, i) => (
                        <div key={i} className="mt-2">
                          <div className="mono text-[10px] uppercase text-[var(--ink-faint)]">
                            {s.title}
                          </div>
                          <div
                            className="prose-sm text-[12px] text-[var(--ink-soft)] [&_p]:my-0.5"
                            dangerouslySetInnerHTML={{ __html: s.html }}
                          />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {chart.calls.length > 0 && (
                <div>
                  <Label>Call records</Label>
                  {chart.calls.slice(0, 2).map((c) => (
                    <div key={c.url} className="mb-3 rounded-lg border p-3 rule">
                      <div className="mb-1 flex items-baseline gap-2 text-[11px] text-[var(--ink-faint)]">
                        <span>
                          {c.sent ? new Date(c.sent).toLocaleString() : ""}
                        </span>
                        <span>{c.topic}</span>
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mono ml-auto underline decoration-dotted"
                        >
                          open
                        </a>
                      </div>
                      {c.utterances.map((u, i) => (
                        <p key={i} className="text-[12px] leading-snug">
                          <span className="mono mr-1.5 text-[9px] uppercase text-[var(--ink-faint)]">
                            owner
                          </span>
                          {u}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        {/* ---- The inbox ------------------------------------------------ */}
        <aside className="p-4">
          <Label>
            Review queue
            <span className="mono ml-2 font-normal text-[10px] text-[var(--ink-faint)]">
              {queue.length}
            </span>
          </Label>
          <p className="mb-3 text-[10px] leading-snug text-[var(--ink-faint)]">
            Every one of these is a FHIR Task with intent &ldquo;proposal&rdquo;.
            Nothing here became care without a clinician.
          </p>
          <ul className="space-y-2">
            {queue.map((t) => (
              <li key={t.id} className="rounded-md border p-2 rule">
                <div className="text-[12px] leading-tight">{t.description}</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <button
                    onClick={() => t.patientId && setSelected(t.patientId)}
                    className="text-[11px] underline decoration-dotted"
                  >
                    {t.patientName}
                  </button>
                  <span className="mono rounded-sm bg-[#fdf3ea] px-1 text-[9px] uppercase text-[var(--acoustic)]">
                    {t.intent}
                  </span>
                  <a
                    href={t.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mono ml-auto text-[10px] underline decoration-dotted"
                  >
                    open
                  </a>
                </div>
              </li>
            ))}
            {queue.length === 0 && (
              <li className="text-[12px] text-[var(--ink-faint)]">
                Nothing awaiting review.
              </li>
            )}
          </ul>
        </aside>
      </div>
    </main>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-faint)]">
      {children}
    </div>
  );
}
