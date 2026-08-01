/**
 * Build the Moss cloud chart index from the same chart that was seeded into
 * Medplum, then verify it answers.
 *
 *   npm run index
 *
 * Every document carries metadata pointing back at the FHIR resource it came
 * from, so a retrieved line in the UI can be traced to a resource id.
 */

import "./load-env";
import { getMoss } from "../src/lib/moss";
import { PATIENT, chartDocuments, chartIndexName } from "../src/lib/case";

async function main() {
  const moss = await getMoss();
  const indexName = chartIndexName(PATIENT.id);
  const docs = chartDocuments();

  console.log(`\nBuilding Moss index "${indexName}" from ${docs.length} chart documents\n`);

  await moss.createIndex(indexName, docs, {
    modelId: "moss-minilm",
    onProgress: (p) => console.log("  ", JSON.stringify(p)),
  });

  console.log("\nLoading index into memory for local querying");
  await moss.loadIndex(indexName);

  // Three probes that must work, because the demo depends on each of them.
  const probes = [
    "patient is drinking more water than usual and waking up at night",
    "thyroid medication dose",
    "family history of heart problems",
  ];

  console.log("\nProbes\n");
  for (const probe of probes) {
    const started = performance.now();
    const result = await moss.query(indexName, probe, { topK: 2, alpha: 0.9 });
    const wall = performance.now() - started;
    console.log(`  "${probe}"`);
    console.log(
      `    sdk ${result.timeTakenInMs?.toFixed(2) ?? "n/a"}ms · wall ${wall.toFixed(1)}ms`,
    );
    for (const doc of result.docs) {
      console.log(
        `    ${doc.score.toFixed(3)}  ${doc.metadata?.label ?? doc.id}  (${doc.metadata?.resourceType ?? "?"})`,
      );
    }
    console.log("");
  }

  console.log("Chart index ready.\n");
}

main().catch((err) => {
  console.error("\nIndex build failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
