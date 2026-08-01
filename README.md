# Vetra on Medplum

One veterinary case, carried across the workflow, written into a real FHIR
record. The phone call becomes a chart, and every field carries a `Provenance`
saying whether the owner stated it or the agent inferred it.

Built for the Medplum x YC Agentic Healthcare Hackathon, YC SF, 1 August 2026.

## The argument

An earlier version of this demo ran against OpenVPM, a self-hosted open-source
veterinary PIMS, over its `/api/v1` integrator surface. Two findings from that
build are the reason this exists:

1. **Provenance is required in transport and lost in the record.** OpenVPM makes
   `source` mandatory on a SOAP write, echoes it back, and emits it on the
   webhook. `soap_notes` has no column for it. Tomorrow you cannot tell an
   agent-written note from a clinician's.
2. **The integrator API cannot read the practice timezone.** Appointments demand
   an absolute timestamp but `practices` is not exposed on `/api/v1`. The clinic
   is `America/New_York`; a laptop in California silently books three hours off.

Both are the same argument: connection is not meaning. FHIR has had `Provenance`
as a first-class resource the entire time, and Medplum gives it a search index.
So the record moved.

| The old PIMS | Medplum |
|---|---|
| `source` mandatory on write, no column to store it | `Provenance` per field, author is the owner or the agent |
| The call logged out of band | `Communication`, owner as sender, every utterance a payload |
| Slots owned by our code | `Slot`, so a double booking is refused by the record |
| Practice timezone not exposed | an extension on `Organization` |
| Animals modeled as a bespoke table | `Patient` with the R4 `patient-animal` extension |

Nothing on screen is a simulation of a record. Every resource id the console
prints is a link into the Medplum app, and a judge can click any of them.

---

## Read this first, in the morning

```bash
cd ~/Documents/undertone
# .env.local already exists, fill in the values
npm run verify     # one round trip per platform, with real latency
npm run seed       # the clinic and Luna into Medplum as FHIR
npm run index      # the Moss chart index, with three probes
npm run dev        # http://localhost:3000
```

`npm run verify` is the gate. It already runs and reports cleanly; every line is
FAIL right now because the keys are blank, which is correct behaviour.

### Keys needed

| Variable | Where |
|---|---|
| `MEDPLUM_CLIENT_ID` / `MEDPLUM_CLIENT_SECRET` | app.medplum.com, Project Admin, Client Applications |
| `DEEPGRAM_API_KEY` | console.deepgram.com. Claim the $200 event credit |
| `MOSS_PROJECT_ID` / `MOSS_PROJECT_KEY` | portal.usemoss.dev |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `STEDI_API_KEY` | portal.stedi.com, Settings, API Keys. Optional |

---

## The two screens

**`/` is the demo.** Press Run intake. Eight steps execute against Medplum and
each one prints the resources it wrote, as links. This is the screen to show.

**`/voice` is the live version.** Deepgram `nova-3-medical` on the browser mic,
Moss retrieval steering the next question, Aura speaking the agent's turn. Use it
if the room is quiet and the wifi holds. The eight-step run does not depend on it.

## The eight steps

Same workflow as the OpenVPM build, because the workflow did not change. What
changed is what the record can hold.

| Step | What happens | What it writes |
|---|---|---|
| 1 INTAKE | Caller matched from the number that rang | reads `RelatedPerson` to `Patient` |
| 2 CONTEXT | Species, breed, weight, rabies status | searches by LOINC code, not client-side filtering |
| 3 STRUCTURE | Typed fields, each tied to its source | `Observation` + `Provenance` per field |
| 4 TRIAGE | Clinic rules decide, the agent does not diagnose | nothing, deliberately |
| 5 SCHEDULE | Books against the clinic calendar | `Appointment`, flips `Slot` to busy |
| 6 WRITE BACK | The owner's words reach the record | `Composition`, stated and inferred in separate sections |
| 7 THE CALL | The call is itself a resource | `Communication` |
| 8 THE BOUNDARY | The agent refuses to assert a diagnosis | `AuditEvent` + `Task` with `intent: proposal` |

Step 3 is the one to slow down on. Step 5 refuses the 10:00 slot because the seed
marks it busy, so the agent is told no by the record and moves to 10:30. Step 8
is where to stop.

---

## What is real and what is seeded

**Real, at demo time**

- Every FHIR resource the loop writes, created in Medplum at that moment
- The slot refusal. `Slot.status` is read from the record, not from our code
- Timezone resolution through the extension on `Organization`
- On `/voice`: Deepgram recognition of your actual voice, keyterms derived from
  the chart before the socket opens, Moss retrieval with the SDK's own reported
  latency, and prosodic features computed from the same audio samples

**Seeded ahead of time**

- Luna, her owner, the clinic, the chart, the calendar. Synthetic, and the banner
  says so on every screen
- The Moss chart index, built from the same chart

**Not built**

- A Medplum Bot for the write-back. Writes happen server-side from a route
  handler, which is honest to say out loud
- A Medplum `AccessPolicy` denying `Condition` writes to the agent's
  ClientApplication. Step 8 currently refuses in application code and records the
  refusal; the AccessPolicy would enforce it server-side
- Replay mode

**One caveat to check before the pitch.** The Stedi payer id and NPI in
`src/app/api/eligibility/route.ts` are a guess. Pet insurance does not run on
X12 and there is no veterinary payer on that network, so the eligibility call is
a demonstration of a rail animals do not have, in test mode, with the owner as
subscriber. Say that plainly or leave it out.

---

## FHIR modeling notes

The things a Medplum reviewer will check.

- **`Patient` with the R4 `patient-animal` extension**, carrying `species`,
  `breed`, and `genderStatus`. R4 shipped this and almost nobody uses it. Species
  uses a SNOMED code; breed is deliberately left as text because the breed code
  was not verified and a wrong code is worse than an honest string.
- **`RelatedPerson` as the informant.** The patient cannot self-report, so the
  owner is the instrument, and `Provenance.agent.type` is `informant` for
  anything she stated versus `author` for anything the agent derived.
- **`Observation.status` is `preliminary`** on everything the call produced. A
  machine wrote it and no veterinarian has signed it.
- **`Task.intent` is `proposal`**, not `order`. The approval gate is expressed in
  FHIR rather than in a status column of our own invention.
- **No `Condition` is ever created.** A triage rule match is not a diagnosis.
- **Search parameters, not client-side filtering.**
  `Observation?subject=...&code=http://loinc.org|29463-7&_sort=-date&_count=3`.

---

## Layout

```
scripts/verify-apis.ts     one round trip per platform, with latency
scripts/seed.ts            the clinic, Luna, the chart, the calendar
scripts/build-index.ts     the Moss chart index, plus three probes

src/lib/case.ts            Luna, the clinic, the triage rules. The only file
                           that knows what species this is
src/lib/loop.ts            the eight steps, and every Medplum write
src/lib/medplum-links.ts   deep links into the Medplum app
src/lib/medplum.ts         authenticated client, actor resolution
src/lib/deepgram.ts        token grant, keyterm priming, Aura TTS
src/lib/moss.ts            two-index ambient retrieval
src/lib/agent.ts           the intake agent and its safety prompt
src/lib/prosody.ts         real acoustic DSP
src/lib/stedi.ts           eligibility, test mode
src/app/page.tsx           the eight-step console
src/app/voice/page.tsx     the live voice console
public/pcm-worklet.js      mic capture, teed to Deepgram and to the DSP
```

---

## Related

- `~/Documents/vetra-openvpm-demo/RUNBOOK.md` is the OpenVPM build this replaces,
  including the two findings above.
- `~/Documents/claudia/.hermes/plans/2026-08-01_013926-oneshot-undertone-build-and-prompt.md`
  is the human-medicine framing, with the judge panel and the tier gates. The
  platform playbook in section 2 still applies.
