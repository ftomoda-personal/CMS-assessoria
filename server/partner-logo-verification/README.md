# Restricted Partner logo verification (isolated, not deployed)

`handler.ts` is a framework-independent Request/Response handler. `storageInfoAdapter.ts` accepts a server-owned client exposing only Storage `info()`. No privileged client or secrets are constructed here. Browser code must never import this directory.

Authentication is an injected security boundary: its implementation must verify token signature, trusted project issuer/audience, expiry, user identity and session claims. Membership must be checked against current CMS-admin membership, before and after inspection. Neither browser flags nor decoded unverified JWT claims are sufficient. Request-scoped authentication/membership adapters now exist as isolated DI components; no real clients, project signing configuration or endpoint binding are constructed.

Admission requires a configured rate/concurrency lease and release. The concurrent fake used in tests is not a distributed production limiter. Deployment is blocked until a distributed limiter/concurrency strategy, bounded HTTP request ingestion, endpoint binding, secrets, timeouts, CORS and operational auditing are implemented and reviewed. Server dependencies must not automatically retry.

Not-found recognition defaults to disabled. A recognition predicate may be enabled only after the exact Storage error signature is verified separately in Development. Test signatures are fixtures, not deployed evidence. The adapter consumes SDK-normalized camelCase metadata. ETag and custom metadata are never exposed or interpreted as a digest. An observed object does not prove physical delivery, historical attribution or database persistence. Negative observations do not rule out an earlier in-flight upload.

The browser component accepts an injected transport to a trusted configured endpoint. It is not connected to forms, reconciliation or a live endpoint. All outcomes retain retryAuthorization=none, writes=blocked, storage=preserve, historicalAttribution=unestablished and databasePersistence=unestablished.

The current handler checks body length only after `request.text()` has buffered it. Before deployment, enforce a byte limit during ingestion, before buffering, and configure request and upstream timeouts (including authorization, limiter admission/release and Storage). Operational verified-authentication and current-membership adapters, distributed rate limiting/concurrency enforcement, server-only secrets and CORS must be reviewed. No deployment authorization is granted by this phase.

## Isolated operational adapters and HTTP utilities

`requestAuthAdapters.ts` must be instantiated once per request with its exact bearer token. It calls injected SDK-compatible `getClaims(token, {allowExpired:false})`, validates configured issuer/audience, expiry, subject/session UUIDs, then confirms the same user via `getUser(token)`. Claims verification must be cryptographic: the locally inspected SDK uses project keys or an Auth-service fallback depending on signing configuration. That configuration must still be validated in the selected Edge runtime. The membership factory must use a publishable-key client with this request's fixed JWT, no shared mutable authorization headers and no service-role elevation.

`httpSecurity.ts` is an isolated wrapper factory, not an Edge Function entrypoint. It rejects missing/disallowed origins, handles OPTIONS explicitly, permits only POST with JSON and a bearer header, and bounds bytes as the request stream is consumed. Content-Length is an additional early check. It propagates abort and suppresses late responses on deadline/cancellation; it does not guarantee termination of injected SDK calls or work already in flight. Upstream deadline/abort wiring and distributed lease recovery remain deployment requirements. CORS does not replace authentication.

All tests use local fakes. Runtime compatibility, signing mode, trusted issuer/audience, endpoint transport, HTTP timeout policy, secrets, CORS allowlist and distributed admission must be separately reviewed and validated. No real network calls, deployment or secret configuration are authorized here.
