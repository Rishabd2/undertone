# careVet

One veterinary case, carried across the workflow, written into a real FHIR
record. A phone call becomes shared context — with source attached — and a
clinician-owned next step.

## Context

### Problem

Most veterinary clinics use an older PIMS plus separate tools for calls and
messages. Important information ends up in different places, and the systems
are hard to connect.

### Current state

To fix this, a clinic often has to replace major parts of its workflow. That
costs money, takes time to train staff, and disrupts the tools they already
use. So most clinics keep working with disconnected systems.

### Example

An owner calls about a pet. There may already be a message from the owner, a
note from a prior call, and a clinic protocol that applies. These do not come
together automatically. Staff search for the history, ask the same questions
again, and rebuild the story at every handoff.

## Solution

careVet works with the clinic's current system. It turns a conversation into
useful context, brings in the relevant past information, and prepares the next
step for a staff member or clinician to review.

## Technologies

The demo shows how a call moves from voice, to source-linked context, to a
clinician-owned task in Medplum.

1. **Medplum** is the FHIR workflow and record layer. We store the source call
   as a `Communication`, retrieve related prior `Communication`s, and create a
   FHIR `Task` with `intent: proposal` for clinician review. The clinic keeps
   its existing system of record while careVet appends traceable context and
   work.

2. **Deepgram** powers the live voice flow and transcript. **Moss.dev**
   retrieves the relevant prior conversations and clinic protocol, so the agent
   can prepare a review packet instead of treating each call as isolated.

3. **Stedi** runs in test mode for a 270/271 eligibility workflow after a
   clinician has approved the follow-up. It demonstrates the integration rail
   without implying that coverage determines the clinical decision or that a
   real veterinary payer responded.

The phone path uses a **voice agent** that calls a signed careVet webhook for
tools (`recall_context`, `record_field`, `check_calendar`, `book_slot`,
`finish_intake`). Only the careVet backend writes to Medplum — the voice vendor
does not.

---

## Setup

```bash
cd ~/Documents/undertone
# Copy .env.example to .env.local and fill in the values
npm install
npm run verify     # one round trip per platform, with real latency
npm run seed       # the clinic and Luna into Medplum as FHIR
npm run index      # the Moss chart index, with three probes
npm run dev        # http://localhost:3000
```

`npm run verify` is the gate. Blank keys report FAIL, which is expected until
credentials are filled in.

### Keys

| Variable | Where |
|---|---|
| `MEDPLUM_CLIENT_ID` / `MEDPLUM_CLIENT_SECRET` | app.medplum.com → Project Admin → Client Applications |
| `DEEPGRAM_API_KEY` | console.deepgram.com |
| `MOSS_PROJECT_ID` / `MOSS_PROJECT_KEY` | portal.usemoss.dev |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `VAPI_API_KEY` / `VAPI_SERVER_SECRET` | Voice agent platform (assistant + signed webhook) |
| `PUBLIC_BASE_URL` | Public URL the voice agent posts tool calls to (e.g. ngrok or deploy) |
| `STEDI_API_KEY` | portal.stedi.com → Settings → API Keys (optional) |

---

## Screens

| Path | What it is |
|---|---|
| `/` | Eight-step intake console. Press **Run intake** — each step writes real Medplum resources with clickable links. |
| `/vetra-demo` | Seven-scene clinic walkthrough (intake → SOAP → pharmacy → compliance → discharge → recall). |
| `/live` | Live watch of Medplum as the phone path writes. |
| `/clinic` | Clinician-facing chart and proposal queue, read from Medplum. |

The deterministic proof path is `/` — it does not depend on the phone. The
live voice agent path writes through `/api/vapi/tools` into the same Medplum
project.

---

## The eight steps

| Step | What happens | What it writes |
|---|---|---|
| 1 INTAKE | Caller matched from the number that rang | reads `RelatedPerson` → `Patient` |
| 2 CONTEXT | Species, breed, weight, rabies status | searches by LOINC code |
| 3 STRUCTURE | Typed fields, each tied to its source | `Observation` + `Provenance` per field |
| 4 TRIAGE | Clinic rules decide; the agent does not diagnose | nothing, deliberately |
| 5 SCHEDULE | Books against the clinic calendar | `Appointment`, or refuses if no free `Slot` |
| 6 WRITE BACK | The owner's words reach the record | `Composition` (stated vs inferred) |
| 7 THE CALL | The call is itself a resource | `Communication` |
| 8 THE BOUNDARY | The agent refuses to assert a diagnosis | `AuditEvent` + `Task` (`intent: proposal`) |

Step 3 is the one to slow down on (stated vs inferred + Provenance). Step 8 is
where to stop: no `Condition` is written.

---

## Demo case

The demo uses Luna (returning patient), her owner Maria, Urbana Paws clinic,
chart history, and calendar slots. `npm run seed` loads that case into Medplum;
`npm run index` builds the Moss chart index from it.

Intake and the voice webhook write FHIR resources into Medplum on each run —
Observations with Provenance, Communication for the call, Composition for
intake, Appointment when a slot is free (or a refusal when it is not), and a
Task proposal at the boundary. Slot status and practice timezone come from the
Organization and Slot resources on the record. Deepgram, Moss, and the voice
agent run when their credentials are set.

Writes go through careVet route handlers (not a Medplum Bot). The agent refuses
`Condition` writes in application code and records an `AuditEvent`; a Medplum
`AccessPolicy` could enforce that server-side later. Stedi eligibility is test
mode with illustrative payer id / NPI — pet insurance does not run on X12 the
way human payers do.

---

## FHIR modeling notes

- **`Patient`** with the R4 `patient-animal` extension (`species`, `breed`,
  `genderStatus`).
- **`RelatedPerson`** as informant; `Provenance.agent.type` is `informant` for
  owner-stated facts and `author` for agent-inferred ones.
- **`Observation.status`** is `preliminary` until a veterinarian signs.
- **`Task.intent`** is `proposal`, not `order`.
- **No `Condition`** — a triage rule match is not a diagnosis.
- Search by code, not client-side filtering
  (`Observation?subject=...&code=http://loinc.org|29463-7&_sort=-date`).

---

## Layout

```
scripts/verify-apis.ts     one round trip per platform, with latency
scripts/seed.ts            the clinic, Luna, the chart, the calendar
scripts/build-index.ts     the Moss chart index, plus three probes

src/lib/case.ts            Luna, the clinic, the triage rules
src/lib/loop.ts            the eight steps and Medplum writes
src/lib/fhir-builders.ts   FHIR resource shapes
src/lib/medplum.ts         authenticated client, actor resolution
src/lib/deepgram.ts        token grant, keyterm priming, TTS
src/lib/moss.ts            ambient retrieval
src/lib/vapi.ts            voice-agent tools and assistant config
src/lib/stedi.ts           eligibility, test mode
src/app/page.tsx           eight-step console
src/app/api/vapi/tools     signed webhook: only write path from the phone
public/vetra-demo/         seven-scene clinic walkthrough
```
