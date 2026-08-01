import { NextResponse } from "next/server";
import { checkEligibility } from "@/lib/stedi";
import { PATIENT } from "@/lib/case";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Coverage, checked only after a clinician approved the follow-up.
 *
 * Checking before approval would mean cost is steering care. Checking after
 * means the clinician decided and the system is removing friction. The UI
 * enforces the same ordering: this button does not exist until approval lands.
 *
 * Stedi test mode. Labeled everywhere it is displayed.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      serviceTypeCodes?: string[];
    };

    const result = await checkEligibility({
      // Stedi publishes test payer ids. Confirm the current one in the portal.
      tradingPartnerServiceId: process.env.STEDI_TEST_PAYER_ID || "00007",
      provider: {
        npi: process.env.STEDI_TEST_NPI || "1999999984",
        organizationName: "Undertone Health",
      },
      subscriber: {
        memberId: "UT0000000001",
        firstName: PATIENT.givenName,
        lastName: PATIENT.familyName,
        dateOfBirth: PATIENT.birthDate.replace(/-/g, ""),
      },
      serviceTypeCodes: body.serviceTypeCodes ?? ["30"],
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
