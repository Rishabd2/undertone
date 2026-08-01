"use client";

import { useCallback, useRef, useState } from "react";
import type { UndertoneEvent } from "@/lib/events";
import { analyzeWindow, speechRate, type ProsodicFeature } from "@/lib/prosody";
import type { Evidence } from "@/lib/moss";
import type { AgentTurn } from "@/lib/agent";

/**
 * The visit state machine, client side.
 *
 * Flow, once per patient utterance:
 *   Deepgram sends is_final           -> render as ink, add to transcript
 *   Deepgram sends UtteranceEnd       -> the patient is done, take the turn
 *   POST /api/agent/turn              -> session index write, ambient retrieval,
 *                                        then the model, in that order
 *   POST /api/speak                   -> the agent's spoken reply
 *
 * Deepgram's own endpointing decides when the patient finished. We never run a
 * timer for that.
 */

export type TranscriptLine = {
  id: string;
  speaker: "patient" | "agent";
  text: string;
  final: boolean;
};

export type VisitState = {
  status: "idle" | "connecting" | "live" | "ended" | "error";
  visitId?: string;
  patient?: {
    name: string;
    age: number;
    pronouns: string;
    mrn: string;
    banner: string;
  };
  visit?: { reasonForVisit: string; scheduledFor: string; clinician: string };
  chart: { id: string; label: string; date: string; category: string }[];
  keyterms: string[];
  model?: string;
  lines: TranscriptLine[];
  partial: string;
  events: UndertoneEvent[];
  evidence: Evidence[];
  retrievalTiming?: {
    sdk: { chart?: number; session?: number };
    totalMs: number;
    indexes: number;
  };
  acoustic: ProsodicFeature[];
  proposal?: AgentTurn["proposal"];
  decision?: { decision: string; resources: string[] };
  eligibility?: { headline: string; testMode: boolean; elapsedMs: number };
  error?: string;
};

const initial: VisitState = {
  status: "idle",
  chart: [],
  keyterms: [],
  lines: [],
  partial: "",
  events: [],
  evidence: [],
  acoustic: [],
};

export function useVisit() {
  const [state, setState] = useState<VisitState>(initial);

  const socketRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const transcriptRef = useRef<{ speaker: "patient" | "agent"; text: string }[]>([]);
  const pendingRef = useRef<string>("");
  const acousticRef = useRef<ProsodicFeature[]>([]);
  const visitIdRef = useRef<string>("");
  const busyRef = useRef(false);
  const windowRef = useRef<
    { id: string; sha256: string; seconds: number } | undefined
  >(undefined);

  const push = useCallback((event: UndertoneEvent) => {
    setState((s) => ({ ...s, events: [...s.events, event] }));
  }, []);

  /** Take one agent turn on a finalized patient utterance. */
  const takeTurn = useCallback(
    async (text: string) => {
      if (busyRef.current || !text.trim()) return;
      busyRef.current = true;
      try {
        const utteranceId = `utt-${Date.now()}`;
        const response = await fetch("/api/agent/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            visitId: visitIdRef.current,
            utterance: { id: utteranceId, text },
            transcript: transcriptRef.current,
            acoustic: acousticRef.current,
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "turn failed");

        const turn: AgentTurn = data.turn;
        const at = new Date().toISOString();

        push({
          type: "retrieval.completed",
          query: text,
          indexes: data.retrieval.indexesQueried,
          sdkMs: data.retrieval.timings,
          totalMs: data.retrieval.totalMs,
          hits: data.retrieval.evidence.length,
          at,
        });

        setState((s) => ({
          ...s,
          evidence: data.retrieval.evidence,
          retrievalTiming: {
            sdk: data.retrieval.timings,
            totalMs: data.retrieval.totalMs,
            indexes: data.retrieval.indexesQueried,
          },
        }));

        if (turn.question) {
          transcriptRef.current.push({ speaker: "agent", text: turn.question });
          setState((s) => ({
            ...s,
            lines: [
              ...s.lines,
              {
                id: `agent-${Date.now()}`,
                speaker: "agent",
                text: turn.question,
                final: true,
              },
            ],
          }));
          push({ type: "agent.question.spoken", text: turn.question, at });
          void playSpeech(turn.question);
        }

        if (turn.proposal) {
          setState((s) => ({ ...s, proposal: turn.proposal }));
          push({
            type: "followup.review_required",
            proposalId: turn.proposal.id,
            summary: turn.proposal.summary,
            at,
          });
        }
      } catch (err) {
        push({
          type: "error",
          where: "agent.turn",
          message: err instanceof Error ? err.message : String(err),
          at: new Date().toISOString(),
        });
      } finally {
        busyRef.current = false;
      }
    },
    [push],
  );

  const start = useCallback(async () => {
    setState({ ...initial, status: "connecting" });
    try {
      const response = await fetch("/api/session/start", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "could not start visit");

      visitIdRef.current = data.visitId;
      transcriptRef.current = [];
      acousticRef.current = [];

      setState((s) => ({
        ...s,
        status: "connecting",
        visitId: data.visitId,
        patient: data.patient,
        visit: data.visit,
        chart: data.chart,
        keyterms: data.listen.keyterms,
        model: data.listen.model,
      }));

      push({
        type: "visit.started",
        visitId: data.visitId,
        keytermCount: data.listen.keyterms.length,
        at: new Date().toISOString(),
      });

      // Mic first, so a permission denial fails before the socket opens.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: false, // keep the acoustic channel honest
          autoGainControl: false,
        },
      });
      streamRef.current = stream;

      // Token rides Sec-WebSocket-Protocol: browsers cannot set headers on a
      // WebSocket handshake, and the API key never leaves the server anyway.
      const socket = new WebSocket(
        `wss://api.deepgram.com/v1/listen?${data.listen.query}`,
        ["bearer", data.token],
      );
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;

      socket.onopen = async () => {
        setState((s) => ({ ...s, status: "live" }));
        const context = new AudioContext();
        audioContextRef.current = context;
        await context.audioWorklet.addModule("/pcm-worklet.js");
        const source = context.createMediaStreamSource(stream);
        const worklet = new AudioWorkletNode(context, "pcm-worklet", {
          processorOptions: { targetSampleRate: 16000, windowSeconds: 10 },
        });

        worklet.port.onmessage = async (message) => {
          const payload = message.data;
          if (payload.type === "pcm") {
            if (socket.readyState === WebSocket.OPEN) socket.send(payload.buffer);
            return;
          }
          if (payload.type === "window") {
            const samples = new Float32Array(payload.buffer);
            const sha256 = await hash(samples);
            const windowId = `win-${Date.now()}`;
            windowRef.current = {
              id: windowId,
              sha256,
              seconds: payload.seconds,
            };
            push({
              type: "acoustic.window.sealed",
              windowId,
              seconds: Number(payload.seconds.toFixed(1)),
              sha256,
              at: new Date().toISOString(),
            });

            const features = analyzeWindow({
              samples,
              sampleRate: payload.sampleRate,
            });
            const spoken = transcriptRef.current
              .filter((t) => t.speaker === "patient")
              .map((t) => t.text)
              .join(" ");
            const voiced = features.find((f) => f.label === "Voiced duration");
            const rate = voiced ? speechRate(spoken, voiced.value) : undefined;
            const all = rate ? [...features, rate] : features;
            if (all.length > 0) {
              acousticRef.current = all;
              setState((s) => ({ ...s, acoustic: all }));
              push({
                type: "acoustic.signal.detected",
                provider: "local-prosody",
                features: all.map((f) => ({
                  label: f.label,
                  value: f.value,
                  unit: f.unit,
                })),
                at: new Date().toISOString(),
              });
            }
          }
        };

        source.connect(worklet);
        // Keep the node alive without routing mic audio back to the speakers.
        const silent = context.createGain();
        silent.gain.value = 0;
        worklet.connect(silent).connect(context.destination);
      };

      socket.onmessage = (message) => {
        let payload: any;
        try {
          payload = JSON.parse(message.data);
        } catch {
          return;
        }

        if (payload.type === "Results") {
          const alternative = payload.channel?.alternatives?.[0];
          const text: string = alternative?.transcript ?? "";
          if (!text) return;
          const at = new Date().toISOString();

          if (payload.is_final) {
            pendingRef.current = `${pendingRef.current} ${text}`.trim();
            const id = `final-${Date.now()}`;
            setState((s) => ({
              ...s,
              partial: "",
              lines: [
                ...s.lines,
                { id, speaker: "patient", text, final: true },
              ],
            }));
            push({ type: "transcript.final", id, text, speaker: "patient", at });
          } else {
            setState((s) => ({ ...s, partial: text }));
          }
        }

        // Deepgram decides the patient finished, not a timer on our side.
        if (payload.type === "UtteranceEnd") {
          const utterance = pendingRef.current.trim();
          pendingRef.current = "";
          if (utterance) {
            transcriptRef.current.push({ speaker: "patient", text: utterance });
            void takeTurn(utterance);
          }
        }
      };

      socket.onerror = () => {
        push({
          type: "error",
          where: "deepgram.socket",
          message: "WebSocket error",
          at: new Date().toISOString(),
        });
      };

      socket.onclose = () => {
        setState((s) => (s.status === "live" ? { ...s, status: "ended" } : s));
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((s) => ({ ...s, status: "error", error: message }));
      push({
        type: "error",
        where: "visit.start",
        message,
        at: new Date().toISOString(),
      });
    }
  }, [push, takeTurn]);

  const end = useCallback(async () => {
    socketRef.current?.close();
    audioContextRef.current?.close().catch(() => undefined);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    let pushed = false;
    try {
      const response = await fetch("/api/visit/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitId: visitIdRef.current }),
      });
      pushed = (await response.json()).pushed ?? false;
    } catch {
      pushed = false;
    }
    setState((s) => ({ ...s, status: "ended" }));
    push({
      type: "visit.ended",
      visitId: visitIdRef.current,
      sessionPushed: pushed,
      at: new Date().toISOString(),
    });
  }, [push]);

  const decide = useCallback(
    async (decision: "approved" | "rejected") => {
      const proposal = state.proposal;
      if (!proposal) return;
      try {
        const response = await fetch("/api/decision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision,
            proposal,
            acoustic: acousticRef.current,
            audioWindow: windowRef.current,
            transcript: transcriptRef.current,
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "decision failed");
        setState((s) => ({ ...s, decision: data }));
        push(
          decision === "approved"
            ? {
                type: "followup.approved",
                proposalId: proposal.id,
                by: "Dr. Amara Osei",
                resources: data.resources,
                at: data.at,
              }
            : {
                type: "followup.rejected",
                proposalId: proposal.id,
                by: "Dr. Amara Osei",
                at: data.at,
              },
        );
      } catch (err) {
        push({
          type: "error",
          where: "decision",
          message: err instanceof Error ? err.message : String(err),
          at: new Date().toISOString(),
        });
      }
    },
    [state.proposal, push],
  );

  const checkCoverage = useCallback(async () => {
    try {
      const response = await fetch("/api/eligibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceTypeCodes: ["30"] }),
      });
      const data = await response.json();
      setState((s) => ({ ...s, eligibility: data }));
      push({
        type: "eligibility.checked",
        headline: data.headline,
        testMode: true,
        ms: Math.round(data.elapsedMs ?? 0),
        at: new Date().toISOString(),
      });
    } catch (err) {
      push({
        type: "error",
        where: "eligibility",
        message: err instanceof Error ? err.message : String(err),
        at: new Date().toISOString(),
      });
    }
  }, [push]);

  return { state, start, end, decide, checkCoverage };
}

/** Play one Deepgram Aura turn. */
async function playSpeech(text: string) {
  try {
    const response = await fetch("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) return;
    const raw = await response.arrayBuffer();
    const pcm = new Int16Array(raw);
    const context = new AudioContext();
    const buffer = context.createBuffer(1, pcm.length, 24000);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 0x8000;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start();
    source.onended = () => void context.close();
  } catch {
    // A failed TTS turn should never take the call down.
  }
}

/** sha256 of the audio window, so Provenance can point at exactly these samples. */
async function hash(samples: Float32Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", samples.buffer as ArrayBuffer);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
