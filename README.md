# Undertone

A pre-visit voice intake agent. It hears what the patient says and measures how
they say it, retrieves the chart mid-sentence to choose the next question, and
hands the clinician a source-separated brief where nothing becomes care without
approval.

Built for the Medplum x YC Agentic Healthcare Hackathon, YC SF, 1 August 2026.

---

## Read this first, in the morning

The substrate is built and every platform is wired. What is left is keys, seed,
and the demo polish.

```bash
cd ~/Documents/undertone
# .env.local already exists, fill in the values
npm run verify                 # one round trip per platform, with latency
npm run seed                   # FHIR graph into Medplum
npm run index                  # Moss chart index, with three probes
npm run dev                    # http://localhost:3000
```

`npm run verify` is the gate. Do not write UI until all five print PASS. It
already runs and reports cleanly; right now every line is FAIL because the keys
are blank, which is the correct behaviour.

### Keys needed

| Variable | Where |
|---|---|
| `MEDPLUM_CLIENT_ID` / `MEDPLUM_CLIENT_SECRET` | app.medplum.com, Project Admin, Client Applications |
| `DEEPGRAM_API_KEY` | console.deepgram.com. Claim the $200 event credit |
| `MOSS_PROJECT_ID` / `MOSS_PROJECT_KEY` | portal.usemoss.dev |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `STEDI_API_KEY` | portal.stedi.com, Settings, API Keys |

`STEDI_TEST_PAYER_ID` and `STEDI_TEST_NPI` are optional overrides. The defaults
in `src/app/api/eligibility/route.ts` are a guess and should be confirmed against
the Stedi portal before the demo.

---

## What is real and what is seeded

Being precise about this is the point, so it is stated first.

**Real, computed or fetched live at demo time**

- Deepgram `nova-3-medical` streaming recognition of your actual voice
- Keyterms passed to the recognizer, derived from the seeded chart before the
  socket opens
- Moss retrieval across two indexes. The latency shown in the UI is the number
  the Moss SDK reports, not an estimate
- Prosodic features. Every value is computed by `src/lib/prosody.ts` from the
  same audio samples Deepgram transcribed. F0 by autocorrelation, jitter and
  shimmer by the standard local definitions, pause ratio against an adaptive
  per-window threshold
- sha256 of each audio window, computed in the browser
- The FHIR resources written on approval, created in Medplum at that moment
- The Stedi eligibility response, in test mode

**Seeded ahead of time**

- The patient and her chart. Dana Whitfield is synthetic. The banner says so on
  every screen
- The Moss chart index, built from the same chart

**Not built**

- Amplifier Health. Only `local-prosody` is implemented, and it is not a mock,
  it is real DSP
- Replay mode
- A Medplum Bot for the write-back. Writes currently happen server-side from a
  route handler, which is honest to say out loud

---

## Architecture

```
browser mic ──┬── 16 kHz linear16 ──► Deepgram nova-3-medical (keyterms primed)
              │                              │ transcript.final / UtteranceEnd
              └── 10s float windows          ▼
                     │              POST /api/agent/turn
                     │                 1. session index write   (Moss)
                     ▼                 2. ambient retrieval     (Moss, 2 indexes)
             local-prosody DSP         3. next question         (Claude)
                     │                        │
                     └────────────────────────┤
                                              ▼
                                     clinician gate  approve / reject
                                              │ approved only
                                              ▼
                    Medplum: Observation(preliminary) + Provenance
                             + Task(intent order) + AuditEvent + Composition
                                              │
                                              ▼
                                     Stedi 270/271, test mode
```

### Why each platform is used the way it is

**Deepgram.** The chart is read before the socket opens, so the recognizer is
primed with this patient's medications, problems and allergies. A different
patient primes a different vocabulary. Deepgram's own endpointing and
`utterance_end_ms` decide when the patient finished; there is no timer on our
side. See `src/lib/deepgram.ts` and `src/lib/client/useVisit.ts`.

**Moss.** Two indexes queried in parallel on every finalized utterance, fused
into one global top-K: the cloud chart index, and a live `SessionIndex` holding
the conversation so far. Retrieval fires before the model call, not after, so it
sits on the critical path. Hybrid `alpha` is tuned by query type: symptom
language is semantic at 0.9, drug and lab names are lexical at 0.3. See
`src/lib/moss.ts`.

One note on honesty: the SDK at v1.4.1 queries one index per call, so "two
indexes" means two parallel queries fused, and the UI says exactly that. It does
not claim a single-call multi-index API, because there is not one.

**Medplum.** The graph is modeled properly. `Observation` carries
`status: "preliminary"` because a machine measured it and no human has signed it.
`Provenance` names the `Device` as author and the audio window as source entity.
`Task` uses `intent` to express the approval gate rather than a status column of
our own invention. `AuditEvent` is written on rejection as well as approval,
because a rejection is a clinical decision. A `Condition` is never created from a
voice signal. See `src/lib/writeback.ts` and `scripts/seed.ts`.

**Stedi.** One eligibility check, fired only after the clinician approves.
Checking coverage before a clinician decides implies cost is steering care.
Checking after means the clinician decided and the system is removing friction.
The UI enforces the ordering: the button does not exist until approval lands.
See `src/lib/stedi.ts`.

---

## Non-negotiable rules, enforced in code

1. Never display a value the system did not compute or receive. Prosody omits
   features it cannot measure rather than estimating them.
2. Never convert an acoustic signal into a diagnosis. The agent system prompt
   forbids it, and the write-back labels every acoustic Observation
   "descriptive, not diagnostic".
3. Never create a FHIR `Condition` from a voice signal.
4. No `Task` without a recorded human approval carrying identity and timestamp.
5. Transcript, chart, and acoustic evidence stay separated visually and
   structurally, including in the `Composition`.
6. Synthetic patient only, labeled on screen.
7. Secrets only in `.env.local`. `.env.example` carries names, never values.

---

## Layout

```
scripts/verify-apis.ts     one round trip per platform, with latency
scripts/seed.ts            the FHIR graph
scripts/build-index.ts     the Moss chart index, plus three probes

src/lib/case.ts            the synthetic case. Swap this to change the domain
src/lib/deepgram.ts        token grant, keyterm priming, Aura TTS
src/lib/moss.ts            two-index ambient retrieval
src/lib/medplum.ts         authenticated client, actor resolution
src/lib/agent.ts           the intake agent and its safety prompt
src/lib/writeback.ts       Observation, Provenance, Task, AuditEvent, Composition
src/lib/prosody.ts         real acoustic DSP
src/lib/stedi.ts           post-approval eligibility
src/lib/client/useVisit.ts the client state machine
src/app/page.tsx           the three-column console
public/pcm-worklet.js      mic capture, teed to Deepgram and to the DSP
```

`src/lib/case.ts` is the only file that knows what kind of patient this is.
Changing the domain is a swap there, not a rewrite.

---

## Related plans

- `~/Documents/claudia/.hermes/plans/2026-08-01_013926-oneshot-undertone-build-and-prompt.md`
  is the plan this implements, including the judge panel and the tier gates.
- `~/Documents/claudia/vetra/MEDPLUM-HACKATHON-DEMO-PROMPT.md` is an alternative
  veterinary framing of the same substrate. Not built. Kept because the argument
  in it is reusable.
