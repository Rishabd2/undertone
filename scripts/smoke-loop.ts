/**
 * Run the eight-step loop end to end, headless, and check that what it says it
 * wrote is actually readable back out of Medplum.
 *
 *   npm run smoke
 *
 * The last stage of the pipeline, and the one that would have caught a bad
 * write. It does not trust the loop's own report: it reads every resource back.
 */

import "./load-env";
import { getMedplum } from "../src/lib/medplum";
import { runLoop } from "../src/lib/loop";
import { PATIENT } from "../src/lib/case";

const UTTERANCES = [
  "Hi, it's Maria. Luna's been limping on her back left leg since yesterday evening.",
  "She jumped off the couch and yelped. She's putting some weight on it but not much.",
  "She's still eating fine and drinking normally. No vomiting.",
];

async function main() {
  console.log("\nRunning the intake loop against Medplum\n");
  const started = performance.now();
  const result = await runLoop({
    callerPhone: PATIENT.ownerPhone,
    utterances: UTTERANCES,
  });
  const elapsed = performance.now() - started;

  for (const step of result.steps) {
    console.log(
      `  ${String(step.n).padStart(2)}  ${step.title.padEnd(12)} ${step.status.padEnd(8)} ${step.ms.toFixed(0).padStart(5)}ms  ${step.resources.length} resource(s)`,
    );
    console.log(`      ${step.line}`);
  }

  console.log(
    `\n  ${result.steps.length} steps, ${result.allResources.length} resources, ${elapsed.toFixed(0)}ms total\n`,
  );

  // Do not trust the loop's own report. Read every resource back.
  console.log("Reading every written resource back out of Medplum\n");
  const medplum = await getMedplum();
  let missing = 0;
  for (const resource of result.allResources) {
    try {
      const read = await medplum.readReference({ reference: resource.reference });
      if (!read?.id) throw new Error("no id on read");
      console.log(`  OK    ${resource.reference}`);
    } catch (err) {
      missing++;
      console.log(
        `  GONE  ${resource.reference}  ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // The provenance claim is the whole pitch, so check it holds.
  const provenances = result.allResources.filter(
    (r) => r.resourceType === "Provenance",
  );
  const stated = provenances.filter((r) => r.why.startsWith("stated")).length;
  const inferred = provenances.filter((r) => r.why.startsWith("inferred")).length;

  console.log("");
  console.log(
    `Provenance: ${provenances.length} written, ${stated} authored by the owner, ${inferred} by the agent.`,
  );
  if (stated === 0 || inferred === 0) {
    console.log(
      "The demo needs both kinds on screen. Check `structure()` in src/lib/loop.ts.",
    );
    process.exitCode = 1;
  }

  console.log("");
  if (missing === 0) {
    console.log(
      `All ${result.allResources.length} resources read back. Open https://app.medplum.com/Patient/${result.patientId}\n`,
    );
  } else {
    console.log(`${missing} resources could not be read back.\n`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("\nSmoke failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
