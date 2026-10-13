# Restricted Partner logo verification (isolated, not deployed)

`handler.ts` is a framework-independent Request/Response handler. `storageInfoAdapter.ts` accepts a server-owned client exposing only Storage `info()`. No privileged client or secrets are constructed here. Browser code must never import this directory.

Authentication is an injected security boundary: its implementation must verify token signature, trusted project issuer/audience, expiry, user identity and session claims. Membership must be checked against current CMS-admin membership, before and after inspection. Neither browser flags nor decoded unverified JWT claims are sufficient. There is no operational authentication implementation in this phase.

Admission requires a configured rate/concurrency lease and release. The concurrent fake used in tests is not a distributed production limiter. Deployment is blocked until a distributed limiter/concurrency strategy, bounded HTTP request ingestion, endpoint binding, secrets, timeouts, CORS and operational auditing are implemented and reviewed. Server dependencies must not automatically retry.

Not-found recognition defaults to disabled. A recognition predicate may be enabled only after the exact Storage error signature is verified separately in Development. Test signatures are fixtures, not deployed evidence. The adapter consumes SDK-normalized camelCase metadata. ETag and custom metadata are never exposed or interpreted as a digest. An observed object does not prove physical delivery, historical attribution or database persistence. Negative observations do not rule out an earlier in-flight upload.

The browser component accepts an injected transport to a trusted configured endpoint. It is not connected to forms, reconciliation or a live endpoint. All outcomes retain retryAuthorization=none, writes=blocked, storage=preserve, historicalAttribution=unestablished and databasePersistence=unestablished.

The current handler checks body length only after `request.text()` has buffered it. Before deployment, enforce a byte limit during ingestion, before buffering, and configure request and upstream timeouts (including authorization, limiter admission/release and Storage). Operational verified-authentication and current-membership adapters, distributed rate limiting/concurrency enforcement, server-only secrets and CORS must be reviewed. No deployment authorization is granted by this phase.
