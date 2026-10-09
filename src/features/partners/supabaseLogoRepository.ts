import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReadClient } from "../../lib/supabase/readDataset";
import { createMutationLifecycle, MutationError, parsePersistedUuid } from "../../lib/supabase/mutation.ts";
import type { MutationOptions } from "../../lib/supabase/mutation";

type StorageBucket = ReturnType<SupabaseClient["storage"]["from"]>;
export type LogoClient = ReadClient & {
  readonly storage: { from(bucket: string): Pick<StorageBucket, "upload" | "getPublicUrl"> };
};
export interface LogoUploadMetadata {
  readonly bucket: "partner-logos";
  readonly objectPath: string;
  readonly originalFilename: string;
}
export type LogoUploadResult = LogoUploadMetadata & (
  | { readonly outcome: "confirmed"; readonly canApply: boolean }
  | { readonly outcome: "uncertain"; readonly error: MutationError }
);
const bucket = "partner-logos";
const maxBytes = 2097152;
const pathPattern = /^logos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg)$/;
function validatePath(path: string) {
  // JS $ accepts a final newline; full-match length closes that exception.
  if (typeof path !== "string" || pathPattern.exec(path)?.[0] !== path) throw new MutationError("response");
}

/** MIME + bounded signature preflight, NOT full image decoding or sanitization. */
async function validateFile(file: File, signal?: AbortSignal): Promise<"png" | "jpg"> {
  if (signal?.aborted) throw new MutationError("cancelled");
  if (file.type !== "image/png" && file.type !== "image/jpeg" || file.size <= 0 || file.size > maxBytes) throw new MutationError("domain");
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer()); }
  catch { throw new MutationError(signal?.aborted ? "cancelled" : "domain"); }
  if (signal?.aborted) throw new MutationError("cancelled");
  const png = [137, 80, 78, 71, 13, 10, 26, 10];
  const matches = file.type === "image/png" ? bytes.length === 8 && png.every((value, index) => bytes[index] === value)
    : bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!matches) throw new MutationError("domain");
  return file.type === "image/png" ? "png" : "jpg";
}

/** Isolated append-only Storage access. Never writes Partner metadata or deletes objects. */
export function createPartnerLogoRepository(client: LogoClient, dependencies: { readonly randomUUID?: () => string } = {}) {
  return {
    async upload(file: File, options: MutationOptions = {}): Promise<LogoUploadResult> {
      const extension = await validateFile(file, options.signal);
      const life = await createMutationLifecycle(client, options);
      const uuid = parsePersistedUuid((dependencies.randomUUID ?? (() => crypto.randomUUID()))()).toLowerCase();
      const metadata: LogoUploadMetadata = { bucket, objectPath: `logos/${uuid}.${extension}`, originalFilename: file.name };
      validatePath(metadata.objectPath);
      const storage = client.storage.from(bucket);
      await life.prepareDispatch();
      await life.verifyBeforeDispatch();
      life.markDispatched();
      let response;
      // SDK upload has no AbortSignal parameter. After dispatch, abort cannot prove rollback.
      try { response = await storage.upload(metadata.objectPath, file, { upsert: false, contentType: file.type }); }
      catch { return { ...metadata, outcome: "uncertain", error: life.interruption() }; }
      if (response.error) {
        const status = response.error.status;
        if (!status || status >= 500) return { ...metadata, outcome: "uncertain", error: life.interruption() };
        const kind = status === 401 || status === 403 ? "authorization" : status === 409 ? "conflict"
          : status === 400 || status === 413 || status === 415 || status === 422 ? "domain" : "response";
        throw new MutationError(kind, undefined, status);
      }
      if (!response.data || response.data.path !== metadata.objectPath || response.data.fullPath !== `${bucket}/${metadata.objectPath}`) {
        return { ...metadata, outcome: "uncertain", error: new MutationError("response") };
      }
      // A stale/cancelled acknowledgment stays confirmed, but must not be attached in the UI.
      return { ...metadata, outcome: "confirmed", canApply: await life.canApplyResult() };
    },
    resolvePublicUrl(path: string): string {
      validatePath(path);
      // Resolution is local URL construction, not an existence check or metadata read.
      return client.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    },
  };
}

export const partnerLogoRepository = {
  async upload(file: File, options: MutationOptions = {}): Promise<LogoUploadResult> {
    const { supabase } = await import("../../lib/supabase/client.ts");
    return createPartnerLogoRepository(supabase).upload(file, options);
  },
  async resolvePublicUrl(path: string): Promise<string> {
    const { supabase } = await import("../../lib/supabase/client.ts");
    return createPartnerLogoRepository(supabase).resolvePublicUrl(path);
  },
};
