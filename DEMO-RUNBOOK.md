# Undertone / Vetra demo runbook

## The one-sentence product

Vetra answers a veterinary intake call, writes each fact into a real Medplum FHIR record with its source attached, books only against the clinic's actual calendar, and hands clinical judgment to the veterinarian as a proposal rather than pretending the agent made a diagnosis.

## The product story

```text
Owner calls Haley
  -> Haley reads Luna's existing chart
  -> owner statements become preliminary Observations
  -> every field gets Provenance: owner stated or agent inferred
  -> Haley checks real Slots and books an Appointment
  -> the call becomes a Communication
  -> the summary becomes a Composition
  -> diagnosis is deliberately not written
  -> a Task with intent=proposal appears for Dr. Chen
  -> the clinic dashboard reads the same Medplum record
```

The important claim is not "we made a voice bot." The claim is:

> The conversation becomes governed clinical workflow without losing who said what, and the machine stops where clinical authority begins.

## What has been coded

### 1. Primary product path: real phone call to clinician dashboard

This is the current demo.

- Vapi runs the phone conversation as Haley.
- Deepgram `nova-3` transcribes it with vocabulary derived from Luna's chart.
- Five constrained Vapi tools call the authenticated `/api/vapi/tools` webhook:
  - `recall_context`
  - `record_field`
  - `check_calendar`
  - `book_appointment`
  - `finish_intake`
- The webhook—not Vapi—writes into Medplum.
- `/live` polls Medplum every 1.5 seconds and shows fields as they reach the record.
- `/clinic` is the veterinarian-facing chart and proposal queue, also read directly from Medplum.

Key files:

- `src/lib/vapi.ts`
- `src/app/api/vapi/tools/route.ts`
- `src/app/live/page.tsx`
- `src/app/api/live/route.ts`
- `src/app/clinic/page.tsx`
- `src/app/api/clinic/route.ts`
- `src/app/api/clinic/patient/route.ts`

### 2. Deterministic proof path: eight-step Medplum loop

`/` is a fallback and technical proof. Pressing **Run intake** runs a fixed three-utterance case through eight steps and writes real resources into Medplum.

It proves:

1. Caller-to-patient matching
2. Existing chart retrieval
3. Per-field Provenance
4. Rule-based triage without diagnosis
5. Slot refusal and booking
6. Structured write-back
7. The call as a FHIR Communication
8. Refusal to create a Condition and handoff as a Task proposal

Use this if the room is noisy, the phone call fails, or a technical reviewer wants to inspect resource IDs.

Key files:

- `src/app/page.tsx`
- `src/app/api/loop/route.ts`
- `src/lib/loop.ts`

### 3. Legacy experiment: browser-mic Undertone flow

`/voice` is an older prototype and should not be shown in the main demo.

It combines browser microphone capture, Deepgram, Moss retrieval, local prosody, an Anthropic agent turn, a clinician approval UI, and Stedi test eligibility. It also retains inconsistent human-health naming such as Undertone and Dr. Osei.

It is not currently a reliable demo path:

- `ANTHROPIC_API_KEY` is not configured.
- `STEDI_API_KEY` is not configured.
- The client POSTs approval decisions to `/api/decision`, but that route does not exist.
- Stedi X12 eligibility is not a veterinary insurance rail.

Do not show `/voice`, the prosody experiment, or Stedi unless explicitly discussing the earlier research branch.

## What to show

### Main live demo: 2–3 minutes

Prepare two tabs:

1. `/clinic`
2. `/live`

Do not begin on the eight-step console.

#### Beat 1 — Establish the record

Open `/clinic`.

Say:

> This is Luna's real FHIR chart in Medplum, rendered for the veterinarian. Her existing weight and overdue rabies status were present before the call.

Point to:

- Luna and Maria
- weight history
- overdue rabies status
- the review queue
- "reading Medplum live"

Do not explain every FHIR resource yet.

#### Beat 2 — Make the call

Call the demo number displayed on `/live` and speak as Maria.

Suggested owner script:

> Hi, this is Maria. Luna has been limping on her back left leg since yesterday evening. She jumped off the couch and yelped. She is putting some weight on it, but not much. She is eating and drinking normally and has not vomited. Do you have anything tomorrow morning?

Let Haley ask follow-up questions. Answer briefly. Choose one of the actual times Haley offers.

#### Beat 3 — Show the record changing

While the call runs, show `/live`.

Say:

> This page is not connected to the phone process. It polls Medplum. What you are seeing is the medical record changing.

Point to:

- fields arriving during the call;
- `stated` versus `inferred`;
- the owner's supporting quote;
- Observation and Provenance links;
- the Appointment appearing only after a real Slot was selected.

The Provenance distinction is the hero moment. Slow down here.

#### Beat 4 — Show the clinician handoff

After Haley closes the call, return to `/clinic`.

Point to:

- the booked appointment;
- intake fields and their sources;
- the preliminary Composition;
- the Communication containing the call;
- the Task in the review queue with `intent: proposal`.

Say:

> The agent did not write a diagnosis. It wrote what the owner said, kept its own inferences separate, and handed the case to Dr. Chen as a proposal.

#### Beat 5 — Prove it is real

Open exactly one linked Observation or Provenance resource in Medplum.

Say:

> This is not a reconstructed UI state. This resource was written into Medplum during the call.

Do not spend time navigating the Medplum admin interface. One proof link is enough.

#### Closing line

> The phone call is the input surface. The product is the governed record and workflow it creates.

## Fallback demo

If the phone, room, or webhook is unreliable:

1. Open `/`.
2. Press **Run intake**.
3. Slow down at Step 3, Provenance.
4. Show the busy-slot refusal at Step 5.
5. Stop at Step 8, the clinical boundary.
6. Open one generated resource in Medplum.

Explain that the utterances are fixed but every displayed resource is written into Medplum during that run.

## Do not show

- `/voice`
- Stedi eligibility
- local prosody/acoustic analysis
- the full Moss implementation or latency feed unless asked
- all four application surfaces in sequence
- a long tour of Medplum's developer console
- the older workflow-animation website as if it were this implementation

These are separate experiments or proof surfaces, not parts of one viewer-facing narrative.

## Current verified state

Verified locally on 1 August 2026:

- Production build passes.
- TypeScript typecheck passes.
- Medplum authentication passes.
- Deepgram token minting passes with `nova-3-medical` and 11 chart-derived keyterms.
- Vapi authentication passes.
- Moss authentication passes.
- Anthropic and Stedi are not configured and are optional for the primary phone path.

Known issues:

1. Lint currently fails with six errors.
2. `/voice` cannot initialize against the current seed: `resolveActors()` still searches for the legacy `clinician-osei` and `undertone-intake-agent` identifiers, while the veterinary seed creates `clinician-chen` and `vetra-intake-agent`.
3. `/voice` calls a missing `/api/decision` endpoint after clinician review.
4. There is no demo-data reset command.
5. `npm run seed` only upserts the baseline clinic and calendar; it does not delete generated Observations, Provenances, Appointments, Communications, Compositions, Tasks, or AuditEvents.
6. The current Medplum project contains residue from repeated runs. At inspection time, the last four hours contained 50 intake fields and 20 outcomes, and the review queue contained seven Tasks.
7. The patient roster caps its task lookup at five, so it can say "5 awaiting review" while the full queue shows seven.
8. Running the deterministic loop repeatedly writes additional resources and consumes available Slots.

## Before presenting again

The highest-priority engineering task is a safe synthetic-demo reset script that:

- deletes only resources associated with the synthetic Luna case;
- preserves the baseline Patient, owner, clinic, practitioner, device, chart, and schedule;
- clears generated intake and outcome resources;
- restores the planned Slot states;
- verifies the final expected counts;
- refuses to run against an unrecognized project or non-synthetic patient.

After reset, the desired initial state is:

- one synthetic patient: Luna;
- no generated intake fields;
- no generated call records;
- no generated appointments;
- no review Tasks;
- 10:00 busy by seed design;
- 10:30, 11:00, 11:30, and 14:00 free.

Until that reset exists, avoid rerunning `npm run smoke`, pressing **Run intake** repeatedly, or making rehearsal calls against the shared Medplum project.