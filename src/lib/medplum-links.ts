/**
 * Deep links into the Medplum app.
 *
 * The point of the demo is that the record is real and inspectable, so every
 * resource the system writes renders as a link a judge can click straight into
 * Medplum's own console. Nothing here is a screenshot of a record; it is the
 * record.
 */

const APP_BASE = process.env.NEXT_PUBLIC_MEDPLUM_APP_URL || "https://app.medplum.com";

export type WrittenResource = {
  reference: string; // "Observation/abc-123"
  resourceType: string;
  id: string;
  /** One line explaining why this resource exists, shown next to the link. */
  why: string;
  url: string;
};

export function written(reference: string, why: string): WrittenResource {
  const [resourceType, id] = reference.split("/");
  return {
    reference,
    resourceType,
    id,
    why,
    url: `${APP_BASE}/${resourceType}/${id}`,
  };
}

export const patientUrl = (id: string) => `${APP_BASE}/Patient/${id}`;

/**
 * Provenance is searchable by target, which is the whole argument against the
 * PIMS this replaced: there, source was mandatory on the write and had nowhere
 * to live in the record. Here it is a resource with an index on it.
 */
export const provenanceForUrl = (reference: string) =>
  `${APP_BASE}/Provenance?target=${encodeURIComponent(reference)}`;
