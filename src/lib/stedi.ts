import { env } from "./env";

/**
 * Stedi, scoped tightly and deliberately placed.
 *
 * One real-time eligibility check (270/271), fired only AFTER a clinician
 * approves the follow-up. Checking coverage before a clinician decides implies
 * cost is steering care. Checking after approval means the clinician decided and
 * the system is removing friction. That ordering is a product opinion.
 *
 * Test mode only. The UI labels it. Never imply a real payer responded.
 */

const ELIGIBILITY_URL =
  "https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/eligibility/v3";

export type EligibilityRequest = {
  /** Payer id. Stedi publishes test payer ids for exactly this purpose. */
  tradingPartnerServiceId: string;
  provider: { npi: string; organizationName: string };
  subscriber: {
    memberId: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string; // YYYYMMDD
  };
  /** Service type codes. "30" is health benefit plan coverage. */
  serviceTypeCodes: string[];
};

export type EligibilitySummary = {
  ok: boolean;
  testMode: true;
  planStatus?: unknown;
  /** One line for the UI. Never invented: derived from the payer response. */
  headline: string;
  copay?: string;
  raw?: unknown;
  error?: string;
  elapsedMs: number;
};

export async function checkEligibility(
  request: EligibilityRequest,
): Promise<EligibilitySummary> {
  const started = performance.now();
  try {
    const response = await fetch(ELIGIBILITY_URL, {
      method: "POST",
      headers: {
        Authorization: env.stedi.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tradingPartnerServiceId: request.tradingPartnerServiceId,
        provider: request.provider,
        subscriber: request.subscriber,
        encounter: { serviceTypeCodes: request.serviceTypeCodes },
      }),
    });

    const elapsedMs = performance.now() - started;
    const body = await response.json().catch(() => undefined);

    if (!response.ok) {
      return {
        ok: false,
        testMode: true,
        headline: `Eligibility check returned ${response.status}`,
        raw: body,
        error: typeof body === "object" ? JSON.stringify(body) : undefined,
        elapsedMs,
      };
    }

    return {
      ok: true,
      testMode: true,
      planStatus: body?.planStatus,
      headline: summarize(body),
      copay: findCopay(body),
      raw: body,
      elapsedMs,
    };
  } catch (err) {
    return {
      ok: false,
      testMode: true,
      headline: "Eligibility check failed",
      error: err instanceof Error ? err.message : String(err),
      elapsedMs: performance.now() - started,
    };
  }
}

/** Read the headline out of the payer response. Never fabricate one. */
function summarize(body: any): string {
  const status = body?.planStatus?.[0];
  if (status?.statusCode === "1" || /active/i.test(status?.status ?? "")) {
    return `Active coverage · ${status?.status ?? "active"}`;
  }
  if (status?.status) return String(status.status);
  if (Array.isArray(body?.benefitsInformation) && body.benefitsInformation[0]) {
    return String(body.benefitsInformation[0].name ?? "Benefits returned");
  }
  return "Payer responded, no plan status in payload";
}

function findCopay(body: any): string | undefined {
  const benefits: any[] = body?.benefitsInformation ?? [];
  const copay = benefits.find(
    (b) => /co-?payment/i.test(b?.name ?? "") && b?.benefitAmount,
  );
  return copay ? `$${copay.benefitAmount}` : undefined;
}
