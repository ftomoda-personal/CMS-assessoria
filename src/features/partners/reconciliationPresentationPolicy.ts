import type { PartnerReconciliationResult } from "./partnerReconciliation";

export type ReconciliationPresentationState =
  | "confirmed-historical-success" | "confirmed-with-failed-refresh" | "correctable-rejection"
  | "metadata-conflict" | "database-conflict" | "database-uncertain" | "upload-uncertain"
  | "inconclusive" | "authorization-denied" | "session-interrupted" | "cancelled"
  | "service-failure" | "durable-correlation-required" | "invalid-input"
  | "current-reference-matches" | "current-reference-differs" | "current-partner-observed"
  | "rejection-needs-investigation" | "preflight-failure" | "historical-zero-row";
export type ReconciliationPresentationAction = "refresh-current-data" | "review-current-partner" | "correct-inputs-outside-policy" | "reauthenticate-and-verify" | "technical-investigation" | "keep-writes-blocked";
export interface ReconciliationPresentation {
  readonly state: ReconciliationPresentationState;
  readonly message: string;
  readonly historical: Readonly<{ state: ReconciliationPresentationState; message: string; source: "caller-supplied"; authenticatedProof: false }>;
  readonly current: Readonly<{ state: ReconciliationPresentationState; message: string; source: "reconciliation-read-report" | "unavailable" }>;
  readonly serverHistoricalEvidence: "unavailable";
  readonly actions: readonly ReconciliationPresentationAction[];
  readonly retryAuthorization: "none";
  readonly writes: "blocked";
  readonly storage: "preserve";
}
const messages: Record<ReconciliationPresentationState, string> = {
  "confirmed-historical-success": "O histórico informado registra que as alterações foram salvas. A leitura atual não autentica esse histórico.",
  "confirmed-with-failed-refresh": "O histórico informado registra uma gravação concluída, seguida de falha ao atualizar os dados. Atualize a leitura, sem repetir a gravação.",
  "correctable-rejection": "O histórico informado registra uma rejeição. Revise os dados; a correção necessária precisa ser confirmada antes de qualquer nova decisão.",
  "metadata-conflict": "O histórico informado registra um conflito no logo. Revise os dados atuais e tome uma nova decisão fora desta verificação.",
  "database-conflict": "O histórico informado registra um conflito de gravação. Isso não comprova que o logo mudou. Solicite análise antes de uma nova decisão.",
  "database-uncertain": "O resultado da gravação permanece incerto. A referência atual do logo não comprova o resultado da operação anterior.",
  "upload-uncertain": "O resultado do envio da imagem permanece incerto. Esta verificação não consulta o arquivo armazenado.",
  "historical-zero-row": "O histórico informado registra que a atualização não afetou nenhuma linha. Isso não prova ausência do Partner nem determina o resultado de outras operações. A leitura atual é apresentada separadamente.",
  "inconclusive": "A leitura não permitiu confirmar o estado do Partner. Ele pode estar ausente ou não estar visível para este acesso.",
  "authorization-denied": "Seu acesso não permitiu concluir a verificação. Confirme suas permissões antes de verificar novamente.",
  "session-interrupted": "A sessão não pôde ser mantida durante a verificação. Entre novamente e verifique os dados atuais.",
  "cancelled": "A verificação foi cancelada. Isso não determina o resultado da operação anterior.",
  "service-failure": "Não foi possível concluir a leitura. O resultado anterior permanece sem nova confirmação.",
  "durable-correlation-required": "Não há identificação suficiente para localizar o Partner desta operação. É necessária uma correlação persistida e análise técnica.",
  "invalid-input": "As informações recebidas não permitem uma verificação segura. Solicite análise técnica.",
  "current-reference-matches": "A leitura autenticada relatada observa uma referência de logo correspondente. Isso não comprova a gravação original nem o envio da imagem.",
  "current-reference-differs": "A leitura autenticada relatada observa uma referência de logo diferente. Isso não comprova que a operação anterior falhou.",
  "current-partner-observed": "A leitura autenticada relatada encontrou o Partner. Não é possível estabelecer a operação anterior nem confirmar a gravação de nome e site.",
  "rejection-needs-investigation": "O histórico informado registra uma rejeição cuja correção não foi estabelecida. Solicite análise técnica.",
  "preflight-failure": "O histórico informado registra uma falha anterior à gravação. Revise a causa fora desta verificação.",
};
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function uuid(value: unknown): value is string {
  return typeof value === "string" && value.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
function sameId(a: unknown, b: unknown): boolean { return uuid(a) && uuid(b) && a.toLowerCase() === b.toLowerCase(); }
function errorShape(value: unknown): boolean {
  const error = record(value);
  return !!error && ["authorization", "domain", "conflict", "missing", "response", "cancelled", "uncertain", "stale"].includes(error.kind as string)
    && error.retryAutomatically === false
    && (error.code === undefined || typeof error.code === "string" && /^(?:[A-Z0-9]{5}|PGRST\d{3})$/.test(error.code))
    && (error.httpStatus === undefined || typeof error.httpStatus === "number" && Number.isInteger(error.httpStatus) && error.httpStatus >= 100 && error.httpStatus <= 599);
}
function partnerShape(value: unknown): boolean {
  const partner = record(value);
  if (!partner || !uuid(partner.id) || typeof partner.name !== "string" || typeof partner.website !== "string" || typeof partner.everAssociated !== "boolean") return false;
  if (partner.logoUrl !== undefined && typeof partner.logoUrl !== "string" || partner.logoName !== undefined && typeof partner.logoName !== "string") return false;
  if (partner.logo === undefined) return partner.logoName === undefined && partner.logoUrl === undefined;
  const logo = record(partner.logo);
  return !!logo && logo.bucket === "partner-logos" && typeof logo.objectPath === "string"
    && (logo.originalFilename === null || typeof logo.originalFilename === "string")
    && (logo.publicUrl === undefined || typeof logo.publicUrl === "string")
    && (partner.logoName === undefined || partner.logoName === logo.originalFilename)
    && (partner.logoUrl === undefined || partner.logoUrl === logo.publicUrl);
}
function metadataShape(value: unknown): boolean {
  const m = record(value);
  return !!m && m.bucket === "partner-logos" && typeof m.originalFilename === "string" && typeof m.objectPath === "string"
    && /^logos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg)$/.exec(m.objectPath)?.[0] === m.objectPath;
}
function metadataEqual(a: unknown, b: unknown): boolean {
  const x = record(a); const y = record(b);
  return !!x && !!y && x.bucket === y.bucket && x.objectPath === y.objectPath && x.originalFilename === y.originalFilename;
}
function contextShape(value: unknown): boolean {
  const context = record(value); const target = record(context?.target);
  if (!context || !uuid(context.operationId) || !uuid(context.initiatingAdminId) || !target) return false;
  if (target.kind === "create") return true;
  const expected = record(target.expectedLogo);
  return target.kind === "edit" && uuid(target.id) && !!expected
    && (expected.logo_path === null || typeof expected.logo_path === "string")
    && (expected.logo_name === null || typeof expected.logo_name === "string")
    && (expected.logo_path !== null || expected.logo_name === null);
}
function descriptorShape(value: unknown): boolean {
  const d = record(value); const context = record(d?.context); const target = record(context?.target);
  if (!d || d.version !== 1 || !contextShape(context) || !target) return false;
  if (!(target.kind === "create" ? ["none", "replace"] : ["keep", "replace", "remove"]).includes(d.intent as string)) return false;
  if (d.persistedPartnerId !== undefined && (!uuid(d.persistedPartnerId) || target.kind === "edit" && !sameId(d.persistedPartnerId, target.id))) return false;
  if (d.uploaded !== undefined) {
    const uploaded = record(d.uploaded);
    if (d.intent !== "replace" || !uploaded || !["confirmed", "uncertain"].includes(uploaded.state as string) || !metadataShape(uploaded.metadata)) return false;
  }
  return true;
}
function followUp(value: unknown, partnerValue: boolean, id: unknown): boolean {
  const follow = record(value);
  if (!follow) return false;
  if (follow.state === "failed") return errorShape(follow.error);
  if (follow.state === "completed") return !partnerValue || partnerShape(follow.value) && sameId(record(follow.value)?.id, id);
  return follow.state === "not-needed" || follow.state === "pending";
}
function historyShape(h: Record<string, unknown>): boolean {
  if (h.objects !== "preserve" || !descriptorShape(h.reconciliation)) return false;
  const d = record(h.reconciliation)!; const context = record(d.context)!; const target = record(context.target)!;
  const knownId = target.kind === "edit" ? target.id : d.persistedPartnerId;
  const uploaded = record(d.uploaded);
  if (h.prepared !== undefined) {
    const prepared = record(h.prepared); const pc = record(prepared?.context); const pt = record(pc?.target);
    if (!prepared || prepared.kind !== "prepared-upload" || !contextShape(pc) || !metadataShape(prepared.metadata) || uploaded?.state !== "confirmed"
      || !metadataEqual(prepared.metadata, uploaded.metadata) || pc?.operationId !== context.operationId || !sameId(pc?.initiatingAdminId, context.initiatingAdminId)
      || pt?.kind !== target.kind || target.kind === "edit" && (!sameId(pt?.id, target.id)
        || record(pt?.expectedLogo)?.logo_path !== record(target.expectedLogo)?.logo_path || record(pt?.expectedLogo)?.logo_name !== record(target.expectedLogo)?.logo_name)) return false;
  }
  switch (h.kind) {
    case "confirmed": {
      const p = record(h.persistence);
      return !!p && p.outcome === "confirmed" && p.operation === "persist" && uuid(p.id) && (knownId === undefined || sameId(p.id, knownId))
        && followUp(p.refresh, true, p.id) && followUp(p.cleanup, false, p.id);
    }
    case "database-uncertain": {
      const m = record(h.mutation);
      return !!m && m.outcome === "uncertain" && errorShape(m.error) && (m.id === undefined || uuid(m.id) && (knownId === undefined || sameId(m.id, knownId)));
    }
    case "upload-uncertain": {
      const u = record(h.upload);
      return !!u && u.outcome === "uncertain" && errorShape(u.error) && metadataShape(u) && uploaded?.state === "uncertain" && metadataEqual(u, uploaded.metadata);
    }
    case "upload-confirmed-database-rejected": return h.prepared !== undefined && errorShape(h.error) && !["uncertain", "cancelled", "stale"].includes(record(h.error)?.kind as string);
    case "logo-conflict": return errorShape(h.error) && record(h.error)?.kind === "conflict";
    case "database-rejected": return errorShape(h.error) && !["uncertain", "cancelled", "stale"].includes(record(h.error)?.kind as string);
    case "zero-row": case "before-database-failure": return errorShape(h.error);
    case "interrupted": return ["before-upload", "after-upload-before-database"].includes(h.stage as string)
      && ["cancelled", "stale"].includes(h.reason as string) && errorShape(h.error) && record(h.error)?.kind === h.reason;
    default: return false;
  }
}
function observationConsistent(history: Record<string, unknown>, observation: Record<string, unknown>): boolean {
  if (observation.kind === "unresolved" && observation.reason === "missing-partner-id") {
    const d = record(history.reconciliation)!;
    return record(record(d.context)?.target)?.kind === "create" && d.persistedPartnerId === undefined;
  }
  if (!["uploaded-reference-matches", "uploaded-reference-differs", "partner-found-history-unestablished"].includes(observation.kind as string)) return true;
  if (!partnerShape(observation.partner)) return false;
  const d = record(history.reconciliation)!; const target = record(record(d.context)?.target)!;
  const id = target.kind === "edit" ? target.id : d.persistedPartnerId;
  if (!sameId(record(observation.partner)?.id, id)) return false;
  const upload = record(d.uploaded);
  if (observation.kind === "partner-found-history-unestablished") return !upload;
  if (!upload) return false;
  const logo = record(record(observation.partner)?.logo);
  const matches = metadataEqual(logo, upload.metadata);
  return observation.kind === "uploaded-reference-matches" ? matches : !matches;
}
function historicalState(value: Record<string, unknown>): ReconciliationPresentationState {
  switch (value.kind) {
    case "confirmed": {
      const persistence = record(value.persistence);
      const refresh = record(persistence?.refresh);
      if (persistence?.outcome !== "confirmed" || persistence.operation !== "persist" || !["completed", "failed", "not-needed", "pending"].includes(String(refresh?.state))) return "invalid-input";
      return refresh?.state === "failed" ? "confirmed-with-failed-refresh" : "confirmed-historical-success";
    }
    case "database-uncertain": return "database-uncertain";
    case "upload-uncertain": return "upload-uncertain";
    case "logo-conflict": return "metadata-conflict";
    case "zero-row": return "historical-zero-row";
    case "before-database-failure": return "preflight-failure";
    case "interrupted": return value.reason === "cancelled" ? "cancelled" : value.reason === "stale" ? "session-interrupted" : "invalid-input";
    case "database-rejected":
    case "upload-confirmed-database-rejected": {
      const error = record(value.error);
      if (error?.kind === "conflict") return "database-conflict";
      // A correction opportunity, not evidence that input correction or retry succeeds.
      if (error?.kind === "domain") return "correctable-rejection";
      return "rejection-needs-investigation";
    }
    default: return "invalid-input";
  }
}
function currentState(value: Record<string, unknown>): ReconciliationPresentationState {
  switch (value.kind) {
    case "uploaded-reference-matches": return partnerShape(value.partner) ? "current-reference-matches" : "invalid-input";
    case "uploaded-reference-differs": return partnerShape(value.partner) ? "current-reference-differs" : "invalid-input";
    case "partner-found-history-unestablished": return partnerShape(value.partner) ? "current-partner-observed" : "invalid-input";
    case "inconclusive": return value.reason === "absent-or-invisible" ? "inconclusive" : "invalid-input";
    case "authorization-denied": return "authorization-denied";
    case "session-interrupted": return "session-interrupted";
    case "cancelled": return "cancelled";
    case "failure": return ["service", "response", "mapping"].includes(String(value.reason)) ? "service-failure" : "invalid-input";
    case "unresolved":
      if (value.reason === "missing-partner-id" && value.requires === "durable-correlation") return "durable-correlation-required";
      return "invalid-input";
    default: return "invalid-input";
  }
}
/** Pure summary of reports, not an authentication boundary. Accepts unknown input
 * to fail closed. Copies only allowlisted primitives; no history, Partner, error,
 * identifiers or existing action/capability references escape into presentation.
 * A reconstructed report may describe a read but this function cannot verify it.
 */
export function presentPartnerReconciliation(input: PartnerReconciliationResult): ReconciliationPresentation;
export function presentPartnerReconciliation(input: unknown): ReconciliationPresentation;
export function presentPartnerReconciliation(input: unknown): ReconciliationPresentation {
  let historical: ReconciliationPresentationState = "invalid-input";
  let current: ReconciliationPresentationState = "invalid-input";
  try {
    const result = record(input);
    const history = record(result?.historical);
    const observation = record(result?.observation);
    if (history && observation && result?.retryAuthorization === "none" && result.objects === "preserve") {
      if (historyShape(history)) {
        historical = historicalState(history);
        current = observationConsistent(history, observation) ? currentState(observation) : "invalid-input";
      }
    }
  } catch { historical = "invalid-input"; current = "invalid-input"; }
  const observed = ["current-reference-matches", "current-reference-differs", "current-partner-observed"].includes(current);
  // Current access/error states take precedence; history remains a separate report.
  const state = historical === "invalid-input" ? "invalid-input" : observed ? historical : current;
  const actions: ReconciliationPresentationAction[] = ["keep-writes-blocked"];
  if (state === "invalid-input") actions.push("technical-investigation");
  else if (observed) {
    actions.push("refresh-current-data", "review-current-partner");
    if (historical === "correctable-rejection" || historical === "preflight-failure") actions.push("correct-inputs-outside-policy");
    if (historical === "database-conflict" || historical === "rejection-needs-investigation") actions.push("technical-investigation");
  } else if (current === "session-interrupted" || current === "authorization-denied") actions.push("reauthenticate-and-verify");
  else if (current === "cancelled") actions.push("refresh-current-data");
  else actions.push("technical-investigation");
  return Object.freeze({ state, message: messages[state],
    historical: Object.freeze({ state: historical, message: messages[historical], source: "caller-supplied" as const, authenticatedProof: false as const }),
    current: Object.freeze({ state: current, message: messages[current], source: observed ? "reconciliation-read-report" as const : "unavailable" as const }),
    serverHistoricalEvidence: "unavailable" as const, actions: Object.freeze(actions), retryAuthorization: "none" as const, writes: "blocked" as const, storage: "preserve" as const,
  });
}
