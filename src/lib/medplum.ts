import { MedplumClient } from "@medplum/core";
import { env } from "./env";

/**
 * One authenticated Medplum client per server process. Client credentials never
 * leave the server, so every FHIR read and write goes through a route handler.
 */

let clientPromise: Promise<MedplumClient> | undefined;

export function getMedplum(): Promise<MedplumClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const medplum = new MedplumClient({ baseUrl: env.medplum.baseUrl });
      await medplum.startClientLogin(
        env.medplum.clientId,
        env.medplum.clientSecret,
      );
      return medplum;
    })().catch((err) => {
      // Do not cache a failed login: the next request should retry.
      clientPromise = undefined;
      throw err;
    });
  }
  return clientPromise;
}

/** Identifier system used to find the synthetic patient across runs. */
export const UNDERTONE_IDENTIFIER_SYSTEM = "https://undertone.health/mrn";

/**
 * The agent identity recorded in Provenance and AuditEvent. Undertone is a
 * Device, not a Practitioner, because a machine authored the observation and
 * the FHIR record should say so.
 */
export const AGENT_DEVICE_IDENTIFIER = "undertone-intake-agent";

export type DemoActors = {
  patientId: string;
  practitionerId: string;
  deviceId: string;
};

let actorsPromise: Promise<DemoActors> | undefined;

/**
 * Resolve the seeded patient, clinician, and agent device by their stable
 * identifiers. Cached, because these do not change during a demo.
 */
export function resolveActors(mrn: string): Promise<DemoActors> {
  if (!actorsPromise) {
    actorsPromise = (async () => {
      const medplum = await getMedplum();
      const [patient, practitioner, device] = await Promise.all([
        medplum.searchOne("Patient", {
          identifier: `${UNDERTONE_IDENTIFIER_SYSTEM}|${mrn}`,
        }),
        medplum.searchOne("Practitioner", {
          identifier: `${UNDERTONE_IDENTIFIER_SYSTEM}|clinician-osei`,
        }),
        medplum.searchOne("Device", {
          identifier: `${UNDERTONE_IDENTIFIER_SYSTEM}|${AGENT_DEVICE_IDENTIFIER}`,
        }),
      ]);
      if (!patient?.id || !practitioner?.id || !device?.id) {
        throw new Error(
          "Seeded resources not found. Run `npm run seed` before starting a visit.",
        );
      }
      return {
        patientId: patient.id,
        practitionerId: practitioner.id,
        deviceId: device.id,
      };
    })().catch((err) => {
      actorsPromise = undefined;
      throw err;
    });
  }
  return actorsPromise;
}
