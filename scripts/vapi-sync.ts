/**
 * Push the assistant config to Vapi.
 *
 *   npm run vapi:sync
 *
 * Creates the assistant the first time, patches it afterwards. Prints the
 * assistant id to put in .env.local as VAPI_ASSISTANT_ID.
 *
 * The keyterms in the config come off the chart, so this has to be re-run after
 * changing the case or the seed. That is the point: the recognizer's vocabulary
 * is derived from the record, not hand-maintained.
 */

import "./load-env";
import {
  buildAssistant,
  createAssistant,
  listAssistants,
  updateAssistant,
} from "../src/lib/vapi";
import { chartKeyterms } from "../src/lib/case";

async function main() {
  const serverUrl = process.env.PUBLIC_BASE_URL;
  if (!serverUrl) {
    console.error(
      "\nPUBLIC_BASE_URL is not set. Vapi posts tool calls over the internet, so\n" +
        "localhost will not work. Either deploy to Vercel and use that URL, or run\n" +
        "a tunnel:\n\n" +
        "    npx untun@latest tunnel http://localhost:3000\n\n" +
        "Then set PUBLIC_BASE_URL to the public origin, with no trailing slash.\n",
    );
    process.exitCode = 1;
    return;
  }

  const toolUrl = `${serverUrl.replace(/\/$/, "")}/api/vapi/tools`;
  const keyterms = chartKeyterms();

  console.log(`\nSyncing assistant to Vapi`);
  console.log(`  tool webhook   ${toolUrl}`);
  console.log(`  transcriber    deepgram nova-3`);
  console.log(`  keyterms       ${keyterms.length} from the chart`);
  console.log(`                 ${keyterms.join(", ")}`);

  const existingId = process.env.VAPI_ASSISTANT_ID;
  let assistant: Record<string, unknown>;

  if (existingId) {
    assistant = await updateAssistant(existingId, toolUrl);
    console.log(`\nUpdated assistant ${existingId}`);
  } else {
    const all = (await listAssistants()) as unknown as Array<{
      id: string;
      name?: string;
    }>;
    const match = Array.isArray(all)
      ? all.find((a) => a.name === buildAssistant(toolUrl).name)
      : undefined;
    if (match) {
      assistant = await updateAssistant(match.id, toolUrl);
      console.log(`\nUpdated existing assistant ${match.id}`);
    } else {
      assistant = await createAssistant(toolUrl);
      console.log(`\nCreated assistant ${assistant.id}`);
    }
  }

  console.log(`\nPut this in .env.local:`);
  console.log(`  VAPI_ASSISTANT_ID=${assistant.id}\n`);

  if (process.env.VAPI_PHONE_NUMBER_ID) {
    console.log(
      "Attach the assistant to your number in the Vapi dashboard, then call it.\n",
    );
  } else {
    console.log(
      "No VAPI_PHONE_NUMBER_ID set. Buy or import a number in the Vapi dashboard\n" +
        "to take real calls, or use the dashboard's web call button to test.\n",
    );
  }
}

main().catch((err) => {
  console.error("\nSync failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
