import { NextResponse } from "next/server";
import { runLoop } from "@/lib/loop";
import { PATIENT } from "@/lib/case";
import { patientUrl, provenanceForUrl } from "@/lib/medplum-links";
import { getMedplum, UNDERTONE_IDENTIFIER_SYSTEM } from "@/lib/medplum";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Run the whole intake loop against Medplum and return what it wrote.
 *
 * Every resource in the response is a real id in the caller's Medplum project.
 * The console renders each one as a link into the Medplum app, because the
 * claim being made is that the record is real, and a link is the cheapest way
 * to let someone check.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      utterances?: string[];
      callerPhone?: string;
    };

    const utterances = body.utterances?.length
      ? body.utterances
      : [
          "Hi, it's Maria. Luna's been limping on her back left leg since yesterday evening.",
          "She jumped off the couch and yelped. She's putting some weight on it but not much.",
          "She's still eating fine and drinking normally. No vomiting.",
        ];

    const result = await runLoop({
      callerPhone: body.callerPhone ?? PATIENT.ownerPhone,
      utterances,
    });

    // Decode the animal extension for the header, because Medplum's own patient
    // header renders Luna as a human: name, gender, birth date, and the
    // patient-animal extension as a raw blob. This is the one thing worth
    // showing outside their console.
    const medplum = await getMedplum();
    const patient = await medplum.readResource("Patient", result.patientId);
    const animal = patient.extension?.find(
      (e) => e.url === "http://hl7.org/fhir/StructureDefinition/patient-animal",
    );
    const sub = (url: string) =>
      animal?.extension?.find((e) => e.url === url)?.valueCodeableConcept;

    return NextResponse.json({
      ...result,
      patientUrl: patientUrl(result.patientId),
      provenanceUrl: provenanceForUrl(`Patient/${result.patientId}`),
      animal: {
        name: patient.name?.[0]?.text ?? PATIENT.name,
        species: sub("species")?.text ?? sub("species")?.coding?.[0]?.display,
        speciesCode: sub("species")?.coding?.[0]?.code,
        breed: sub("breed")?.text,
        genderStatus: sub("genderStatus")?.text,
        birthDate: patient.birthDate,
        owner: PATIENT.ownerName,
      },
      utterances,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
