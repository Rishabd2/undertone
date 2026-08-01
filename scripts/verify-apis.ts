/**
 * One round trip per platform, with real elapsed milliseconds.
 *
 *   npm run verify
 *
 * Run this before writing any UI. If a platform is red here it will be red at
 * 4:45pm, and it is far cheaper to find out now.
 */

import "./load-env";
import { configuredPlatforms } from "../src/lib/env";

type Check = {
  name: string;
  run: () => Promise<string>;
};

const results: {
  name: string;
  ok: boolean;
  ms: number;
  detail: string;
}[] = [];

async function run(check: Check) {
  const started = performance.now();
  try {
    const detail = await check.run();
    results.push({
      name: check.name,
      ok: true,
      ms: performance.now() - started,
      detail,
    });
  } catch (err) {
    results.push({
      name: check.name,
      ok: false,
      ms: performance.now() - started,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

const checks: Check[] = [
  {
    name: "Medplum",
    run: async () => {
      const { getMedplum } = await import("../src/lib/medplum");
      const medplum = await getMedplum();
      const profile = medplum.getProfile();
      const patients = await medplum.searchResources("Patient", { _count: 1 });
      return `authenticated as ${profile?.resourceType ?? "client"} · ${patients.length} patient(s) visible`;
    },
  },
  {
    name: "Deepgram",
    run: async () => {
      const { grantToken, LISTEN_MODEL } = await import("../src/lib/deepgram");
      const { accessToken, expiresIn } = await grantToken(30);
      if (!accessToken) throw new Error("no access_token returned");
      return `token minted, ${expiresIn}s ttl · model ${LISTEN_MODEL}`;
    },
  },
  {
    name: "Moss",
    run: async () => {
      const { getMoss } = await import("../src/lib/moss");
      const moss = await getMoss();
      const token = await moss.getAuthToken();
      return `project authenticated${token ? "" : " (no token payload)"}`;
    },
  },
  {
    name: "Anthropic",
    run: async () => {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const message = await client.messages.create({
        model: "claude-sonnet-5",
        max_tokens: 16,
        messages: [{ role: "user", content: "Reply with the word: ready" }],
      });
      const text = message.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("")
        .trim();
      return `claude-sonnet-5 replied "${text}"`;
    },
  },
  {
    name: "Stedi",
    run: async () => {
      const { checkEligibility } = await import("../src/lib/stedi");
      // Stedi's documented test payer. Confirm the current id in the portal.
      const result = await checkEligibility({
        tradingPartnerServiceId: "00007",
        provider: { npi: "1999999984", organizationName: "Undertone Health" },
        subscriber: {
          memberId: "0000000000",
          firstName: "Jane",
          lastName: "Doe",
          dateOfBirth: "19800101",
        },
        serviceTypeCodes: ["30"],
      });
      if (!result.ok) throw new Error(result.headline + " " + (result.error ?? ""));
      return `${result.headline} · TEST MODE`;
    },
  },
];

async function main() {
  const configured = configuredPlatforms();
  console.log("\nUndertone platform check\n");
  console.log(
    "configured:",
    Object.entries(configured)
      .map(([k, v]) => `${v ? "+" : "-"}${k}`)
      .join("  "),
  );
  console.log("");

  for (const check of checks) {
    await run(check);
    const r = results[results.length - 1];
    const mark = r.ok ? "PASS" : "FAIL";
    console.log(
      `${mark.padEnd(5)} ${r.name.padEnd(10)} ${r.ms.toFixed(0).padStart(6)}ms  ${r.detail}`,
    );
  }

  const failed = results.filter((r) => !r.ok);
  console.log("");
  if (failed.length === 0) {
    console.log(`All ${results.length} platforms answered. Substrate is live.\n`);
  } else {
    console.log(
      `${failed.length} of ${results.length} failed: ${failed.map((f) => f.name).join(", ")}\n`,
    );
    process.exitCode = 1;
  }
}

main();
