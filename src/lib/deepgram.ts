import { DeepgramClient } from "@deepgram/sdk";
import { env } from "./env";

/**
 * Deepgram, used past the quickstart in three ways:
 *
 *  1. nova-3-medical, which is the domain-correct recognizer.
 *  2. Chart-seeded keyterm prompting. The FHIR read happens before the socket
 *     opens, so the recognizer is primed with this patient's medications,
 *     problems, and allergies. A different patient primes a different vocabulary.
 *  3. Deepgram endpointing and utterance_end_ms drive turn-taking, rather than a
 *     timer on our side deciding when the patient stopped talking.
 *
 * The API key stays on the server. The browser gets a short-lived JWT.
 */

export const LISTEN_MODEL = "nova-3-medical";
export const SPEAK_MODEL = "aura-2-thalia-en";

let client: DeepgramClient | undefined;

function getDeepgram(): DeepgramClient {
  if (!client) {
    client = new DeepgramClient({ apiKey: env.deepgram.apiKey });
  }
  return client;
}

/**
 * Mint a short-lived token for the browser. The key never reaches the client;
 * the token only has to survive the WebSocket handshake, after which the socket
 * stays open on its own.
 */
export async function grantToken(ttlSeconds = 60) {
  const deepgram = getDeepgram();
  const response = await deepgram.auth.v1.tokens.grant({
    ttl_seconds: ttlSeconds,
  });
  return {
    accessToken: response.access_token,
    expiresIn: response.expires_in ?? ttlSeconds,
  };
}

export type ListenParams = {
  model: string;
  keyterms: string[];
  /** Query string the browser appends to the listen socket URL. */
  query: string;
  url: string;
};

/**
 * Build the streaming parameters, including the chart-derived keyterms.
 * Returned to the browser alongside the token so the UI can display
 * "N chart terms primed" from the same source that configured the recognizer.
 */
export function buildListenParams(keyterms: string[]): ListenParams {
  const params = new URLSearchParams({
    model: LISTEN_MODEL,
    language: "en-US",
    smart_format: "true",
    punctuate: "true",
    interim_results: "true",
    // Deepgram decides when the patient finished, not a timer on our side.
    endpointing: "300",
    utterance_end_ms: "1000",
    vad_events: "true",
    encoding: "linear16",
    sample_rate: "16000",
    channels: "1",
  });
  // keyterm repeats once per term. This is the chart priming the recognizer.
  for (const term of keyterms) {
    params.append("keyterm", term);
  }
  return {
    model: LISTEN_MODEL,
    keyterms,
    query: params.toString(),
    url: `wss://api.deepgram.com/v1/listen?${params.toString()}`,
  };
}

/** Speak one agent turn. Returns audio bytes for the browser to play. */
export async function speak(text: string): Promise<ArrayBuffer> {
  const response = await fetch(
    `https://api.deepgram.com/v1/speak?model=${SPEAK_MODEL}&encoding=linear16&sample_rate=24000`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${env.deepgram.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Deepgram speak failed: ${response.status} ${await response.text()}`,
    );
  }
  return response.arrayBuffer();
}
