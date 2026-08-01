"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Communication, Patient } from "@medplum/fhirtypes";
import {
  PatientHeader,
  PatientSummary,
  PatientTimeline,
  ResourceAvatar,
  ResourceBadge,
  ResourceName,
  useResource,
} from "@medplum/react";
import { Paper, ScrollArea, Text, Title } from "@mantine/core";
import { SCENES, STAGE, type SceneKey } from "./scenes";
import "./carevet.css";

export type DemoSession = {
  baseUrl: string;
  accessToken: string;
  patientId: string;
  patientReference: string;
  communicationId: string | null;
  communicationReference: string | null;
  appUrl: string;
};

type LiveField = {
  label: string;
  value: string;
  source: "stated" | "inferred";
  observation: { reference: string; url: string };
};

export function CareVetDemo({ session }: { session: DemoSession }) {
  const patientRef = useMemo(
    () => ({ reference: session.patientReference }),
    [session.patientReference],
  );
  const patient = useResource(patientRef) as Patient | undefined;
  const communication = useResource(
    session.communicationReference
      ? { reference: session.communicationReference }
      : undefined,
  ) as Communication | undefined;

  const [btsOpen, setBtsOpen] = useState(false);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [ctx, setCtx] = useState<{ k: string; v: string }[]>([]);
  const [events, setEvents] = useState<
    { tag: string; msg: string; href?: string }[]
  >([]);
  const [liveFields, setLiveFields] = useState<LiveField[]>([]);
  const firedRef = useRef(0);
  const flatRef = useRef<{ t: number; run: () => void }[]>([]);

  const scene = SCENES[sceneIndex];
  const total = useMemo(
    () => SCENES.reduce((sum, s) => sum + s.dur, 0),
    [],
  );
  const starts = useMemo(() => {
    const out: number[] = [];
    let t = 0;
    for (const s of SCENES) {
      out.push(t);
      t += s.dur;
    }
    return out;
  }, []);

  const utterances = useMemo(() => {
    return (
      communication?.payload
        ?.map((p) => p.contentString)
        .filter((t): t is string => Boolean(t)) ?? []
    );
  }, [communication]);

  const pushCtx = useCallback((k: string, v: string) => {
    setCtx((prev) => {
      const i = prev.findIndex((x) => x.k === k);
      if (i >= 0) {
        const next = [...prev];
        next[i] = { k, v };
        return next;
      }
      return [...prev, { k, v }];
    });
  }, []);

  const pushEv = useCallback((tag: string, msg: string, href?: string) => {
    setEvents((prev) => [...prev.slice(-40), { tag, msg, href }]);
  }, []);

  // Build flat timeline once session is known
  useEffect(() => {
    const flat: { t: number; run: () => void }[] = [];
    SCENES.forEach((sc, i) => {
      const base = starts[i];
      for (const item of sc.timeline) {
        flat.push({
          t: base + item.at,
          run: () => {
            if (item.e.type === "ctx") pushCtx(item.e.k, item.e.v);
            else {
              let href: string | undefined;
              if (item.e.link === "patient") {
                href = `${session.appUrl}/Patient/${session.patientId}`;
              } else if (
                item.e.link === "communication" &&
                session.communicationId
              ) {
                href = `${session.appUrl}/Communication/${session.communicationId}`;
              }
              pushEv(item.e.tag, item.e.msg, href);
            }
          },
        });
      }
    });
    flat.sort((a, b) => a.t - b.t);
    flatRef.current = flat;
    firedRef.current = 0;
  }, [starts, pushCtx, pushEv, session]);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      setElapsed((t) => (t >= total ? t : t + 100));
    }, 100);
    return () => window.clearInterval(id);
  }, [paused, total]);

  useEffect(() => {
    let idx = 0;
    for (let i = starts.length - 1; i >= 0; i--) {
      if (elapsed >= starts[i]) {
        idx = i;
        break;
      }
    }
    setSceneIndex(idx);

    const flat = flatRef.current;
    while (
      firedRef.current < flat.length &&
      flat[firedRef.current].t <= elapsed
    ) {
      flat[firedRef.current].run();
      firedRef.current += 1;
    }
  }, [elapsed, starts]);

  useEffect(() => {
    const seen = new Set<string>();
    let primed = false;
    async function tick() {
      try {
        const r = await fetch("/api/live?minutes=60", { cache: "no-store" });
        const data = await r.json();
        if (data.error) return;
        const fields = (data.fields ?? []) as LiveField[];
        if (!primed) {
          for (const f of fields) seen.add(f.observation.reference);
          primed = true;
          return;
        }
        const fresh = fields.filter((f) => !seen.has(f.observation.reference));
        for (const f of fresh) {
          seen.add(f.observation.reference);
          pushCtx(f.label, `${f.value} (${f.source})`);
          pushEv("LIVE", `${f.label} = ${f.value}`, f.observation.url);
        }
        if (fresh.length) setLiveFields((prev) => [...prev, ...fresh]);
      } catch {
        /* retry */
      }
    }
    tick();
    const id = window.setInterval(tick, 1500);
    return () => window.clearInterval(id);
  }, [pushCtx, pushEv]);

  function seek(i: number) {
    setPaused(true);
    setCtx([]);
    setEvents([]);
    firedRef.current = 0;
    setSceneIndex(i);
    setElapsed(starts[i]);
  }

  function restart() {
    setCtx([]);
    setEvents([]);
    firedRef.current = 0;
    setElapsed(0);
    setSceneIndex(0);
    setPaused(false);
  }

  const progress = Math.min(100, (elapsed / total) * 100);
  const stageKey = scene.key as SceneKey;
  const stageHtml =
    stageKey === "intake" ? null : STAGE[stageKey as Exclude<SceneKey, "intake">]();

  return (
    <div className="cv-app">
      <header className="cv-top">
        <div className="cv-brand">
          <span className="cv-mark">C</span>
          careVet
          <span className="cv-sub">· clinic operating layer</span>
        </div>
        <div className="cv-pill">
          <span className="cv-stg">{scene.stage}</span>
          <b>Luna</b>
          <span>· Medplum</span>
        </div>
        <button
          type="button"
          className={`cv-bts-toggle ${btsOpen ? "on" : ""}`}
          onClick={() => setBtsOpen((v) => !v)}
          aria-pressed={btsOpen}
        >
          {btsOpen ? "Hide behind the scenes" : "Behind the scenes"}
        </button>
      </header>

      <div className="cv-ctrl">
        <div className="cv-dots">
          {SCENES.map((s, i) => (
            <button
              key={s.key}
              type="button"
              title={s.label}
              className={`cv-dot ${i < sceneIndex ? "done" : ""} ${i === sceneIndex ? "on" : ""}`}
              onClick={() => seek(i)}
            />
          ))}
        </div>
        <div className="cv-scene-label">
          <b>Scene {sceneIndex + 1}</b> · {scene.label}
        </div>
        <div className="cv-progress">
          <i style={{ width: `${progress}%` }} />
        </div>
        <button
          type="button"
          className="cv-btn"
          onClick={() => {
            if (elapsed >= total) restart();
            else setPaused((p) => !p);
          }}
        >
          {elapsed >= total ? "↻ Replay" : paused ? "▶ Play" : "⏸ Pause"}
        </button>
        <button type="button" className="cv-btn primary" onClick={restart}>
          ↻ Restart
        </button>
      </div>

      <div className={`cv-cols ${btsOpen ? "with-bts" : "no-bts"}`}>
        <aside className="cv-rail">
          <div className="cv-rail-h">Shared context</div>
          <div className="cv-rail-sub">
            One record. Entered once. Read by every agent.
          </div>
          <div className="cv-ctx">
            {patient && (
              <div className="cv-patient-head">
                <PatientHeader patient={patient} />
              </div>
            )}
            <div className="cv-ctx-fields">
              {ctx.map((f) => (
                <div key={f.k} className="cv-ctx-field">
                  <span className="k">{f.k}</span>
                  <span className="v">{f.v}</span>
                </div>
              ))}
              {ctx.length === 0 && (
                <Text size="xs" c="dimmed">
                  Context fills as the walkthrough runs.
                </Text>
              )}
            </div>
            {liveFields.length > 0 && (
              <div className="cv-live-block">
                <Text size="xs" fw={700} tt="uppercase" c="blue">
                  Live writes
                </Text>
                {liveFields.slice(-6).map((f) => (
                  <a
                    key={f.observation.reference}
                    href={f.observation.url}
                    target="_blank"
                    rel="noreferrer"
                    className="cv-live-row"
                  >
                    {f.label}: {f.value}
                  </a>
                ))}
              </div>
            )}
          </div>
        </aside>

        <section className="cv-stage">
          <div className="cv-stage-head">
            <span className="k">Scene {sceneIndex + 1}</span>
            <h2>{scene.title}</h2>
            <div className="derive">{scene.derive}</div>
          </div>

          {scene.key === "intake" ? (
            <div className="cv-callgrid">
              <div className="cv-transcript">
                <div className="cv-tr-head">
                  <span>Call transcript</span>
                  {session.communicationId && (
                    <a
                      href={`${session.appUrl}/Communication/${session.communicationId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {session.communicationReference}
                    </a>
                  )}
                </div>
                <div className="cv-tr-body">
                  {communication && (
                    <div className="cv-comm-meta">
                      <ResourceAvatar value={communication} size="sm" />
                      <ResourceName value={communication} />
                      <ResourceBadge value={communication} />
                    </div>
                  )}
                  {utterances.length === 0 && (
                    <Text size="sm" c="dimmed">
                      No Communication utterances yet. Run an intake call or the
                      eight-step loop.
                    </Text>
                  )}
                  {utterances.map((line, i) => (
                    <div key={i} className="cv-line">
                      <span className="who">Owner · Maria</span>
                      {line}
                    </div>
                  ))}
                </div>
              </div>
              <div className="cv-summary">
                {patient ? (
                  <ScrollArea h="100%">
                    <PatientSummary
                      patient={patient}
                      onClickResource={(resource) => {
                        if (resource.id && resource.resourceType) {
                          window.open(
                            `${session.appUrl}/${resource.resourceType}/${resource.id}`,
                            "_blank",
                          );
                        }
                      }}
                    />
                  </ScrollArea>
                ) : (
                  <Text size="sm" c="dimmed">
                    Loading patient…
                  </Text>
                )}
              </div>
            </div>
          ) : (
            <div
              className="cv-stage-body"
              dangerouslySetInnerHTML={{ __html: stageHtml ?? "" }}
            />
          )}
        </section>

        {btsOpen && (
          <aside className="cv-bts">
            <div className="cv-bts-head">
              <div>
                <Title order={5} c="white">
                  Behind the scenes
                </Title>
                <Text size="xs" c="dimmed">
                  Medplum PatientTimeline · toggle anytime
                </Text>
              </div>
              <button
                type="button"
                className="cv-bts-close"
                onClick={() => setBtsOpen(false)}
                aria-label="Close behind the scenes"
              >
                ✕
              </button>
            </div>

            <div className="cv-bts-events">
              {events
                .slice()
                .reverse()
                .slice(0, 12)
                .map((e, i) => (
                  <div key={`${e.tag}-${i}`} className="cv-ev">
                    <span className="tag">{e.tag}</span>
                    {e.href ? (
                      <a href={e.href} target="_blank" rel="noreferrer">
                        {e.msg}
                      </a>
                    ) : (
                      <span>{e.msg}</span>
                    )}
                  </div>
                ))}
              {events.length === 0 && (
                <Text size="xs" c="dimmed">
                  Agent events appear as scenes play.
                </Text>
              )}
            </div>

            <Paper className="cv-timeline" radius="md" p="sm" withBorder>
              {patient ? (
                <ScrollArea h={420}>
                  <PatientTimeline patient={patient} />
                </ScrollArea>
              ) : (
                <Text size="sm">Loading timeline…</Text>
              )}
            </Paper>
          </aside>
        )}
      </div>

      {!btsOpen && (
        <button
          type="button"
          className="cv-edge-tab"
          onClick={() => setBtsOpen(true)}
        >
          Behind the scenes
        </button>
      )}
    </div>
  );
}
