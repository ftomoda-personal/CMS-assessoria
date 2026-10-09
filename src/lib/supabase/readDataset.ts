import type { SupabaseClient } from "@supabase/supabase-js";

/** Injection is for isolated tests; production resolves the existing shared client. */
export type ReadClient = Pick<SupabaseClient, "from"> & {
  readonly auth: Pick<SupabaseClient["auth"], "getSession">;
};
export interface ReadOptions { readonly signal?: AbortSignal }
export type ReadErrorKind = "authorization" | "query" | "mapping" | "incomplete" | "cancelled" | "stale" | "response";

export class ReadRepositoryError extends Error {
  readonly kind: ReadErrorKind;
  readonly code?: string;
  readonly httpStatus?: number;
  constructor(kind: ReadErrorKind, code?: string, httpStatus?: number) {
    super(`Supabase read failed: ${kind}`);
    this.name = "ReadRepositoryError";
    this.kind = kind;
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function checkCancellation(signal?: AbortSignal) {
  if (signal?.aborted) throw new ReadRepositoryError("cancelled");
}
function queryError(error: { code?: string }, status?: number): never {
  const code = error.code && /^(?:[A-Z0-9]{5}|PGRST\d{3})$/.test(error.code) ? error.code : undefined;
  throw new ReadRepositoryError(status === 401 || status === 403 || code === "42501" ? "authorization" : "query", code, status);
}

/** No listener/storage: compare session identity/token around every remote operation. */
export async function readDataset<T>(
  client: ReadClient,
  spec: { readonly table: "partners" | "offers"; readonly columns: string; readonly map: (row: unknown) => T | null },
  options: ReadOptions = {},
): Promise<readonly T[]> {
  const { signal } = options;
  checkCancellation(signal);
  try {
    const initial = await client.auth.getSession();
    checkCancellation(signal);
    if (initial.error || !initial.data.session) throw new ReadRepositoryError("authorization");
    const userId = initial.data.session.user.id;
    const accessToken = initial.data.session.access_token;
    const assertSession = async () => {
      checkCancellation(signal);
      const current = await client.auth.getSession();
      checkCancellation(signal);
      if (current.error || !current.data.session || current.data.session.user.id !== userId || current.data.session.access_token !== accessToken) {
        throw new ReadRepositoryError("stale");
      }
    };
    const assertAdmin = async () => {
      await assertSession();
      let query = client.from("cms_admins").select("user_id").eq("user_id", userId);
      if (signal) query = query.abortSignal(signal);
      const response = await query.maybeSingle();
      await assertSession();
      if (response.error) queryError(response.error, response.status);
      if (response.data?.user_id !== userId) throw new ReadRepositoryError("authorization");
    };
    await assertAdmin();

    const rows: T[] = [];
    let cursor: string | undefined;
    let seen = 0;
    let total: number | undefined;
    while (true) {
      await assertSession();
      let query = client.from(spec.table).select(spec.columns, { count: "exact" }).order("id", { ascending: true }).limit(500);
      if (spec.table === "offers") query = query.is("deleted_at", null);
      if (cursor) query = query.gt("id", cursor);
      if (signal) query = query.abortSignal(signal);
      const response = await query.returns<unknown[]>();
      await assertSession();
      if (response.error) queryError(response.error, response.status);
      if (!Array.isArray(response.data) || !Number.isSafeInteger(response.count) || response.count === null || response.count < 0) {
        throw new ReadRepositoryError("response");
      }
      total ??= response.count;
      if (response.count !== total - seen || response.data.length > 500 || response.data.length > response.count) {
        throw new ReadRepositoryError("incomplete");
      }
      if (response.data.length === 0 && seen !== total) throw new ReadRepositoryError("incomplete");
      for (const value of response.data) {
        const row = value as Record<string, unknown>;
        if (!row || typeof row !== "object" || typeof row.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.id)) {
          throw new ReadRepositoryError("response");
        }
        const id = row.id.toLowerCase();
        if (cursor && id <= cursor) throw new ReadRepositoryError("incomplete");
        cursor = id;
        try {
          const mapped = spec.map(row);
          if (mapped !== null) rows.push(mapped);
        } catch {
          throw new ReadRepositoryError("mapping");
        }
        seen += 1;
      }
      if (seen === total) break;
    }

    // Detect overall count drift, including inserts/deletes behind the keyset cursor.
    await assertSession();
    let finalQuery = client.from(spec.table).select("id", { count: "exact", head: true });
    if (spec.table === "offers") finalQuery = finalQuery.is("deleted_at", null);
    if (signal) finalQuery = finalQuery.abortSignal(signal);
    const final = await finalQuery;
    await assertSession();
    if (final.error) queryError(final.error, final.status);
    if (!Number.isSafeInteger(final.count) || final.count === null) throw new ReadRepositoryError("response");
    if (final.count !== total) throw new ReadRepositoryError("incomplete");
    await assertAdmin();
    return Object.freeze(rows);
  } catch (error) {
    checkCancellation(signal);
    if (error instanceof ReadRepositoryError) throw error;
    throw new ReadRepositoryError("query");
  }
}

/** Validate SQL row shape before handing data to the typed Phase 12B.1 mappers. */
export function validateRow(row: unknown, fields: Readonly<Record<string, "string" | "boolean" | "nullable-string">>): void {
  if (!row || typeof row !== "object") throw new Error("Invalid row");
  const record = row as Record<string, unknown>;
  for (const [key, kind] of Object.entries(fields)) {
    const value = record[key];
    if (kind === "nullable-string" ? value !== null && typeof value !== "string" : typeof value !== kind) throw new Error("Invalid row field");
  }
}
