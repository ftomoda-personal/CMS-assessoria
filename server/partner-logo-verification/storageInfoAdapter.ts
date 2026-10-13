import { canonicalLogoPath, objectRecord, validTimestamp } from "../../src/features/partners/logoVerificationContracts.ts";
import type { ObservedLogoMetadata, RemoteLogoObservation } from "../../src/features/partners/logoVerificationContracts";
/** Server-only DI. No credential construction or operational deployment. */
export interface StorageInfoClient { storage: { from(bucket: "partner-logos"): { info(path: string): Promise<unknown> } } }
export function createStorageInfoAdapter(client: StorageInfoClient, options: { recognizeNotFound?: (error: Readonly<{ status: number; code?: string }>) => boolean } = {}) {
  return {
    async inspect(objectPath: string): Promise<RemoteLogoObservation> {
      if (!canonicalLogoPath(objectPath)) return { kind: "invalid-request" };
      try {
        const response = objectRecord(await client.storage.from("partner-logos").info(objectPath));
        if (!response) return { kind: "invalid-response" };
        if (response.error !== null) {
          const error = objectRecord(response.error); if (!error || response.data != null) return { kind: "invalid-response" };
          const status = error.status;
          if (status === 401 || status === 403) return { kind: "service-failure", reason: "verification-access" };
          if (typeof status !== "number" || !Number.isInteger(status) || status <= 0 || status >= 500) return { kind: "service-failure", reason: "unavailable" };
          const code = typeof error.code === "string" ? error.code : undefined;
          // Default rejects all signatures. Configure only after Development validation.
          if (status === 404 && options.recognizeNotFound?.(Object.freeze({ status, code })) === true) return { kind: "object-not-observed", reason: "storage-reported-not-found", earlierUploadMayStillBeInFlight: true };
          return { kind: "inconclusive", reason: "unclassified-storage-response" };
        }
        const data = objectRecord(response.data); if (!data) return { kind: "invalid-response" };
        if (Object.hasOwn(data, "bucketId") && data.bucketId !== "partner-logos" || Object.hasOwn(data, "name") && data.name !== objectPath) return { kind: "invalid-response" };
        const metadata: { sizeBytes?: number; contentType?: "image/png" | "image/jpeg"; createdAt?: string; lastModifiedAt?: string } = {};
        if (Object.hasOwn(data, "size")) {
          if (typeof data.size !== "number" || !Number.isSafeInteger(data.size) || data.size < 0) return { kind: "invalid-response" };
          metadata.sizeBytes = data.size;
        }
        if (Object.hasOwn(data, "contentType")) {
          if (data.contentType !== "image/png" && data.contentType !== "image/jpeg") return { kind: "invalid-response" };
          metadata.contentType = data.contentType;
        }
        for (const [key, field] of [["createdAt", "createdAt"], ["lastModified", "lastModifiedAt"]] as const) {
          if (Object.hasOwn(data, key)) { if (!validTimestamp(data[key])) return { kind: "invalid-response" }; metadata[field] = data[key]; }
        }
        return { kind: "object-observed", metadata: Object.freeze(metadata) as ObservedLogoMetadata };
      } catch { return { kind: "service-failure", reason: "unavailable" }; }
    },
  };
}
