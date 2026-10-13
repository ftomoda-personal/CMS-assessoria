# Phase 12B.3.5D.2 — Retry policy limitation

The isolated Partner logo coordinator permits controlled manual reuse of a confirmed upload after a dispatched database write receives an eligible definitive rejection. The current constraint allowlist is `23514`, `23502` and `23503`.

These codes establish a constraint rejection; they do not independently establish that repeating the same operation will succeed, that the submitted content is correctable, or that the violated constraint concerns editable Partner content. An unchanged retry may receive the same rejection.

For the upcoming reconciliation and UI policy phase, define what correction or new evidence is required before offering a retry, and how to explain persistent constraint failures. Retry authorization means permission for one controlled attempt, not a prediction of success. Preserve the original in-memory session guard, destination and expected logo metadata checks. A proven logo metadata conflict requires a fresh user decision; uncertainty requires reconciliation. Serialized descriptors and reloads do not authorize retry. No automatic retry or Storage deletion is supported.

No retry behavior is changed by this note.
