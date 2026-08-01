export type SceneKey =
  | "intake"
  | "soap"
  | "fan"
  | "pharmacy"
  | "compliance"
  | "discharge"
  | "recall";

export type SceneEvent =
  | { type: "ctx"; k: string; v: string }
  | { type: "ev"; tag: string; msg: string; link?: string };

export type Scene = {
  key: SceneKey;
  label: string;
  stage: string;
  title: string;
  derive: string;
  dur: number;
  timeline: { at: number; e: SceneEvent }[];
};

export const SCENES: Scene[] = [
  {
    key: "intake",
    label: "Intake · call record",
    stage: "Intake",
    title: "A call comes in",
    derive: "from the stored Medplum Communication",
    dur: 18000,
    timeline: [
      { at: 600, e: { type: "ev", tag: "FRONTDESK", msg: "call.answer · first ring" } },
      {
        at: 2800,
        e: {
          type: "ev",
          tag: "FRONTDESK",
          msg: "identity.resolve → Luna / Maria",
          link: "patient",
        },
      },
      { at: 2900, e: { type: "ctx", k: "Owner", v: "Maria Gonzalez" } },
      { at: 3400, e: { type: "ctx", k: "Patient", v: "Luna · German Shepherd" } },
      {
        at: 5000,
        e: {
          type: "ev",
          tag: "CALL",
          msg: "transcript from Communication",
          link: "communication",
        },
      },
      { at: 5600, e: { type: "ctx", k: "Complaint", v: "Lameness (stated)" } },
      { at: 6200, e: { type: "ctx", k: "Onset", v: "Yesterday evening (stated)" } },
      { at: 8800, e: { type: "ctx", k: "Weight bearing", v: "Partial (stated)" } },
      {
        at: 11000,
        e: {
          type: "ev",
          tag: "TRIAGE",
          msg: "R2 partial → ROUTINE · agent may book",
        },
      },
      { at: 11400, e: { type: "ctx", k: "Triage", v: "ROUTINE · 30 min exam" } },
      {
        at: 15000,
        e: {
          type: "ev",
          tag: "HANDOFF",
          msg: "Task intent: proposal for Dr. Chen",
        },
      },
    ],
  },
  {
    key: "soap",
    label: "Exam · SOAP",
    stage: "Exam",
    title: "Exam becomes a structured record",
    derive: "the scribe writes the SOAP",
    dur: 15000,
    timeline: [
      { at: 400, e: { type: "ev", tag: "SCRIBE", msg: "scribe.listen → exam in progress" } },
      { at: 1200, e: { type: "ctx", k: "Vitals", v: "28.6 kg · T 101.8°F" } },
      {
        at: 4200,
        e: { type: "ev", tag: "SCRIBE", msg: "Assessment + Plan composed" },
      },
      {
        at: 6400,
        e: {
          type: "ev",
          tag: "SCRIBE",
          msg: "SOAP pending DVM sign-off",
          link: "patient",
        },
      },
    ],
  },
  {
    key: "fan",
    label: "Plan fans out",
    stage: "Orchestrate",
    title: "The plan runs the clinic",
    derive: "one plan → every downstream workflow",
    dur: 13000,
    timeline: [
      {
        at: 600,
        e: { type: "ev", tag: "SCRIBE", msg: "plan.parse → 3 actionable orders" },
      },
      {
        at: 1600,
        e: {
          type: "ev",
          tag: "SCRIBE",
          msg: "routed → pharmacy · compliance · recall",
        },
      },
      { at: 2600, e: { type: "ctx", k: "Routed", v: "3 workflows dispatched" } },
    ],
  },
  {
    key: "pharmacy",
    label: "Pharmacy · inventory",
    stage: "Pharmacy",
    title: "Pharmacy & inventory, no re-entry",
    derive: "derived from the Plan",
    dur: 14000,
    timeline: [
      {
        at: 500,
        e: {
          type: "ev",
          tag: "PHARMACY",
          msg: "dispense → carprofen 75 mg × 20",
        },
      },
      { at: 1400, e: { type: "ctx", k: "Rx dispensed", v: "Carprofen 75 mg × 20" } },
      {
        at: 4000,
        e: { type: "ev", tag: "INVENTORY", msg: "reorder → PO drafted" },
      },
    ],
  },
  {
    key: "compliance",
    label: "Vaccination compliance",
    stage: "Compliance",
    title: "Vaccination compliance closes itself",
    derive: "the overdue flag, resolved",
    dur: 14000,
    timeline: [
      {
        at: 500,
        e: { type: "ev", tag: "COMPLIANCE", msg: "rabies administered" },
      },
      { at: 1600, e: { type: "ctx", k: "Rabies", v: "COMPLIANT" } },
      {
        at: 4000,
        e: { type: "ev", tag: "COMPLIANCE", msg: "state registry filed" },
      },
    ],
  },
  {
    key: "discharge",
    label: "Discharge · billing",
    stage: "Discharge",
    title: "Discharge & billing assemble themselves",
    derive: "from everything that happened",
    dur: 15000,
    timeline: [
      {
        at: 500,
        e: { type: "ev", tag: "CLIENT CARE", msg: "discharge.draft → home care" },
      },
      {
        at: 3600,
        e: { type: "ev", tag: "BILLING", msg: "invoice $319 · 4 line items" },
      },
      { at: 4200, e: { type: "ctx", k: "Invoice", v: "$319" } },
    ],
  },
  {
    key: "recall",
    label: "Recall · close loop",
    stage: "Recall",
    title: "The loop closes on its own",
    derive: "next steps scheduled from the record",
    dur: 15000,
    timeline: [
      {
        at: 600,
        e: { type: "ev", tag: "RECALL", msg: "recheck Aug 8 · 12 days" },
      },
      {
        at: 1600,
        e: {
          type: "ctx",
          k: "Follow-up",
          v: "Recheck 12 d · rabies 12 mo",
        },
      },
      {
        at: 3600,
        e: {
          type: "ev",
          tag: "CONTEXT",
          msg: "one record · entered once · ran the clinic",
          link: "patient",
        },
      },
    ],
  },
];

/** HTML bodies for scenes 2–7 (Scene 1 is React + Medplum components). */
export const STAGE: Record<Exclude<SceneKey, "intake">, () => string> = {
  soap: () =>
    `<div class="soap">
      <div class="soap-block s"><div class="lab">Subjective</div><p>6 yr FS German Shepherd, acute left hind lameness since yesterday evening after jumping from the couch. Partial weight bearing. Appetite and water normal, no vomiting.</p></div>
      <div class="soap-block o"><div class="lab">Objective</div><p>BW 28.6 kg · T 101.8°F · Grade 2/4 lameness left hind. Mild effusion left stifle. BCS 5/9.</p></div>
      <div class="soap-block a"><div class="lab">Assessment</div><p>Acute left hind lameness following trauma. Rule out partial CCL tear vs soft-tissue strain. Rabies lapsed.</p></div>
      <div class="soap-block p"><div class="lab">Plan</div><ul class="plan-list"><li>Radiograph left stifle, 2 views</li><li>Carprofen 75 mg PO q12h × 10 days</li><li>Strict rest, leash only</li><li>Administer rabies (1 yr) today</li><li>Recheck in 12 days</li></ul></div>
    </div>`,
  fan: () =>
    `<div class="fanwrap">
      <div class="plan-src"><div class="lab">SOAP · Plan</div><p>Radiograph · Carprofen · Administer rabies · Recheck 12 d</p></div>
      <div class="fan-arrow">▼ dispatched automatically ▼</div>
      <div class="chips">
        <div class="chip"><div class="t">Pharmacy</div><div class="d">Carprofen 75 mg × 20</div></div>
        <div class="chip"><div class="t">Compliance</div><div class="d">Rabies, 1 yr</div></div>
        <div class="chip"><div class="t">Recall</div><div class="d">Recheck 12 days</div></div>
      </div>
    </div>`,
  pharmacy: () =>
    `<div class="duo">
      <div class="rescard"><div class="rh">Pharmacy · dispense</div>
        <div class="kv"><span>Drug</span><span>Carprofen 75 mg</span></div>
        <div class="kv"><span>Quantity</span><span>20 tablets</span></div>
        <div class="kv"><span>Status</span><span class="ok">DISPENSED</span></div>
      </div>
      <div class="rescard"><div class="rh">Inventory · auto</div>
        <div class="kv"><span>On hand</span><span>36 → 16</span></div>
        <div class="kv"><span>Reorder</span><span class="flag">triggered</span></div>
      </div>
    </div>`,
  compliance: () =>
    `<div class="duo">
      <div class="rescard"><div class="rh">Rabies · administered</div>
        <div class="compliance-flip"><span class="flip-old">OVERDUE</span><span>→</span><span class="flip-new">COMPLIANT</span></div>
        <div class="kv"><span>Lot</span><span>RB-4471</span></div>
        <div class="kv"><span>Certificate</span><span>RV-2026-0847</span></div>
      </div>
      <div class="rescard"><div class="rh">Reporting</div>
        <div class="kv"><span>State registry</span><span class="ok">filed</span></div>
        <div class="kv"><span>Owner copy</span><span class="ok">sent</span></div>
      </div>
    </div>`,
  discharge: () =>
    `<div class="duo">
      <div class="rescard"><div class="rh">Discharge · drafted</div>
        <h4>Home care</h4><ul><li>Carprofen every 12 hours with food</li><li>Strict rest, leash only</li><li>Ice stifle 10 min, 2×/day</li></ul>
      </div>
      <div class="rescard invoice"><div class="rh">Invoice</div>
        <div class="line-item"><span>Exam · lameness</span><span>$68</span></div>
        <div class="line-item"><span>Radiograph, 2 views</span><span>$185</span></div>
        <div class="line-item"><span>Carprofen × 20</span><span>$38</span></div>
        <div class="line-item"><span>Rabies vaccine</span><span>$28</span></div>
        <div class="total"><span>Total</span><span>$319</span></div>
      </div>
    </div>`,
  recall: () =>
    `<div class="recall-grid">
      <div class="rc-row"><div class="t">Recheck exam</div><div class="when">Aug 8</div></div>
      <div class="rc-row"><div class="t">Rabies reminder</div><div class="when">Jul 2027</div></div>
      <div class="rc-row"><div class="t">Course ends</div><div class="when">in 8 days</div></div>
      <div class="closeline">One record, entered once, ran the whole clinic.</div>
    </div>`,
};
