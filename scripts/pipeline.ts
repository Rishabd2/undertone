/**
 * The integration pipeline, in dependency order.
 *
 *   npm run pipeline
 *
 * Each stage is a gate. A failure stops the run and tells you the one thing to
 * fix, rather than letting a broken stage cascade into three confusing ones.
 *
 *   1 validate   FHIR shapes against R4 StructureDefinitions   no creds needed
 *   2 verify     one round trip per platform                    needs keys
 *   3 seed       the clinic and Luna into Medplum               needs Medplum
 *   4 index      the Moss chart index                           needs Moss
 *   5 smoke      the whole eight-step loop, end to end          needs all
 *
 * Stage 1 runs with no credentials at all, which is why it is first: it is the
 * only gate that can catch a structural error before you have keys.
 */

import "./load-env";
import { spawn } from "node:child_process";
import { configuredPlatforms } from "../src/lib/env";

type Stage = {
  name: string;
  script: string;
  /** Which platforms must be configured for this stage to be attempted. */
  needs: string[];
  why: string;
};

const STAGES: Stage[] = [
  {
    name: "validate",
    script: "scripts/validate-fhir.ts",
    needs: [],
    why: "every resource shape is valid R4 before a single write goes out",
  },
  {
    name: "verify",
    script: "scripts/verify-apis.ts",
    needs: ["medplum", "deepgram", "moss", "anthropic"],
    why: "every platform answers, with real latency",
  },
  {
    name: "seed",
    script: "scripts/seed.ts",
    needs: ["medplum"],
    why: "the clinic, Luna, the chart and the calendar exist in Medplum",
  },
  {
    name: "index",
    script: "scripts/build-index.ts",
    needs: ["moss"],
    why: "the chart is retrievable in single-digit milliseconds",
  },
  {
    name: "smoke",
    script: "scripts/smoke-loop.ts",
    needs: ["medplum"],
    why: "the eight-step loop runs and writes what it claims to write",
  },
];

function run(script: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["tsx", script], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function main() {
  const configured = configuredPlatforms();
  const only = process.argv[2];

  console.log("\nUndertone integration pipeline\n");
  console.log(
    "configured:",
    Object.entries(configured)
      .map(([k, v]) => `${v ? "+" : "-"}${k}`)
      .join("  "),
  );

  for (const stage of STAGES) {
    if (only && stage.name !== only) continue;

    const missing = stage.needs.filter((need) => !configured[need]);
    console.log(`\n${"=".repeat(64)}`);
    if (missing.length > 0) {
      console.log(`SKIP  ${stage.name}  needs ${missing.join(", ")}`);
      console.log(`      ${stage.why}`);
      continue;
    }

    console.log(`RUN   ${stage.name}  ${stage.why}`);
    console.log("=".repeat(64));
    const code = await run(stage.script);
    if (code !== 0) {
      console.log(`\nPipeline stopped at "${stage.name}". Fix that, then rerun.\n`);
      process.exitCode = 1;
      return;
    }
  }

  const blocked = STAGES.filter((s) =>
    s.needs.some((need) => !configured[need]),
  );
  console.log(`\n${"=".repeat(64)}`);
  if (blocked.length === 0) {
    console.log("\nPipeline green end to end. The demo is live.\n");
  } else {
    console.log(
      `\n${STAGES.length - blocked.length} of ${STAGES.length} stages ran. Still waiting on keys for: ${blocked
        .map((s) => s.name)
        .join(", ")}\n`,
    );
  }
}

main();
