/** Stable HTTP errors; no credentials or raw dependency diagnostics. */
export type CmsInfrastructureError =
  | "unauthenticated"
  | "forbidden"
  | "backend_unavailable"
  | "not_found"
  | "method_not_allowed"
  | "invalid_request";

export interface CmsInfrastructureResponse {
  readonly error: CmsInfrastructureError;
}
