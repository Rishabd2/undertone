
/**
 * Server-side environment access. Every platform key is read here and nowhere
 * else, so a stray import into a client component fails the build rather than
 * shipping a secret to the browser.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

export const env = {
  medplum: {
    get baseUrl() {
      return process.env.MEDPLUM_BASE_URL || "https://api.medplum.com/";
    },
    get clientId() {
      return required("MEDPLUM_CLIENT_ID");
    },
    get clientSecret() {
      return required("MEDPLUM_CLIENT_SECRET");
    },
  },
  deepgram: {
    get apiKey() {
      return required("DEEPGRAM_API_KEY");
    },
  },
  vapi: {
    get apiKey() {
      return required("VAPI_API_KEY");
    },
    get assistantId() {
      return optional("VAPI_ASSISTANT_ID");
    },
    get phoneNumberId() {
      return optional("VAPI_PHONE_NUMBER_ID");
    },
    /** Public base URL Vapi posts tool calls to. Must be reachable from the internet. */
    get serverUrl() {
      return optional("PUBLIC_BASE_URL");
    },
    /** Shared secret Vapi sends back on every tool call. */
    get serverSecret() {
      return required("VAPI_SERVER_SECRET");
    },
  },
  moss: {
    get projectId() {
      return required("MOSS_PROJECT_ID");
    },
    get projectKey() {
      return required("MOSS_PROJECT_KEY");
    },
  },
  anthropic: {
    get apiKey() {
      return required("ANTHROPIC_API_KEY");
    },
  },
  stedi: {
    get apiKey() {
      return required("STEDI_API_KEY");
    },
  },
  acoustic: {
    get provider(): "local-prosody" | "amplifier-health" {
      return process.env.ACOUSTIC_PROVIDER === "amplifier-health"
        ? "amplifier-health"
        : "local-prosody";
    },
    get amplifierKey() {
      return optional("AMPLIFIER_API_KEY");
    },
  },
} as const;

/** Which platforms are configured. Used by the verify script and the UI badge. */
export function configuredPlatforms(): Record<string, boolean> {
  return {
    medplum: Boolean(
      process.env.MEDPLUM_CLIENT_ID && process.env.MEDPLUM_CLIENT_SECRET,
    ),
    deepgram: Boolean(process.env.DEEPGRAM_API_KEY),
    vapi: Boolean(process.env.VAPI_API_KEY),
    moss: Boolean(process.env.MOSS_PROJECT_ID && process.env.MOSS_PROJECT_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    stedi: Boolean(process.env.STEDI_API_KEY),
    amplifier: Boolean(process.env.AMPLIFIER_API_KEY),
  };
}
