import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { useAuth } from "./useAuth";
import { createJointLoader } from "./jointData";
import type { JointState } from "./jointData";
import { partnersReadRepository } from "../features/partners/supabaseReadRepository";
import { offersReadRepository } from "../features/offers/supabaseReadRepository";
import { CmsDataContext as Context } from "./useCmsData";
import { useCmsData } from "./useCmsData";
import { supabase } from "../lib/supabase/client";
import { createSessionContinuityGuard, assertSessionContinuity, verifiedMutationIdentity, createMutationAttempt, isDefinitiveDatabaseRejection, MutationError } from "../lib/supabase/mutation";
import { partnersWriteRepository, getPartnerWriteFailureEvidence } from "../features/partners/supabaseWriteRepository";
import type { PartnerEditableContent } from "../features/partners/supabaseWriteRepository";
import { allowPartnerSubmission, createPartnerMutationController } from "../features/partners/partnerMutation";
import type { PartnerMutationState } from "../features/partners/partnerMutation";
import { navigate } from "./routes";
import { offersWriteRepository, isOfferWriteRejected } from "../features/offers/supabaseWriteRepository";
import { dispatchOfferCommand } from "../features/offers/offerCommands";
import type { OfferCommand } from "../features/offers/offerCommands";
import { createDurableGuard, durableCreateKey } from "./durableCreateGuard";
import { recoveryIsolation, subscribeRecoveryIsolation } from "../features/auth/recovery/browserIsolation";
export function CmsDataProvider({ children }: { children: ReactNode }) {
  const { session, authorization } = useAuth();
  const [loader] = useState(() => createJointLoader({ partners: signal => partnersReadRepository.readAll({ signal }), offers: signal => offersReadRepository.readAll({ signal }) }));
  const [durableVersion, setDurableVersion] = useState(0);
  void durableVersion;
  const durable = () => createDurableGuard(window.localStorage);
  const blocked = (kind: "partner-create" | "offer-create") => { try { return !navigator.locks || durable().blocked(kind); } catch { return true; } };
  const partnerCreateBlocked = blocked("partner-create");
  const offerCreateBlocked = blocked("offer-create");
  useEffect(() => {
    const changed = (event: StorageEvent) => { if (event.key === durableCreateKey || event.key === null) setDurableVersion(value => value + 1); };
    window.addEventListener("storage", changed); return () => window.removeEventListener("storage", changed);
  }, []);
  const [partnerSubmissionFeedback, setPartnerSubmissionFeedback] = useState<string | null>(null);
  const [mutationState, setMutationState] = useState<PartnerMutationState>("idle");
  const active = useRef({ session, authorization });
  active.current = { session, authorization };
  const mutationAbort = useRef<AbortController | null>(null);
  const mutation = useRef<ReturnType<typeof createPartnerMutationController> | null>(null);
  const busy = useRef(false);
  useEffect(() => subscribeRecoveryIsolation(() => {
    if (!recoveryIsolation.allows(active.current.session)) {
      mutationAbort.current?.abort(); mutation.current?.invalidate(); loader.clear();
    }
  }), [loader]);
  useEffect(() => () => { mutationAbort.current?.abort(); mutation.current?.invalidate(); }, []);
  const state = useSyncExternalStore(loader.subscribe, loader.getSnapshot);
  const [scope, setScope] = useState<typeof session>(null);
  useEffect(() => {
    mutationAbort.current?.abort(); mutation.current?.invalidate();
    if (busy.current) setMutationState("uncertain");
    setScope(session);
    void loader.load(authorization === "authorized" && Boolean(session));
    return () => loader.clear();
  }, [loader, session, authorization]);
  useEffect(() => {
    const refresh = () => { if (active.current.authorization === "authorized" && recoveryIsolation.allows(active.current.session) && !busy.current) void loader.load(true, true); };
    window.addEventListener("focus", refresh);
    window.addEventListener("popstate", refresh);
    return () => { window.removeEventListener("focus", refresh); window.removeEventListener("popstate", refresh); };
  }, [loader]);
  // Hide old data during render, before cleanup effects run, including token refresh.
  const visible: JointState = authorization !== "authorized" ? { status: "blocked", partners: [], offers: [] }
    : scope !== session ? { status: "loading", partners: [], offers: [] } : state;
  async function refreshData() {
    const origin = active.current.session;
    const latest = loader.getSnapshot();
    if (busy.current || latest.refreshing || latest.status === "loading" || active.current.authorization !== "authorized" || !origin || !recoveryIsolation.allows(origin)) return;
    await loader.load(true, true);
    if (active.current.session !== origin || active.current.authorization !== "authorized" || !recoveryIsolation.allows(origin)) return;
    const refreshed = loader.getSnapshot();
    if (refreshed.status === "ready" && !refreshed.refreshing && !refreshed.refreshFailed) {
      // Only a previously confirmed write may leave refresh-failed. Uncertainty
      // and durable markers are never resolved from current dataset contents.
      setMutationState(previous => previous === "refresh-failed" ? "confirmed" : previous);
    }
  }
  async function mutatePartner(operation: "create" | "update" | "delete", id?: string, content?: PartnerEditableContent, offerCommand?: OfferCommand) {
    {
      // Read the loader synchronously: focus can start a refresh before React rerenders.
      const latest = loader.getSnapshot();
      if (!allowPartnerSubmission({ mutationState, busy: busy.current,
        authorized: active.current.authorization === "authorized" && recoveryIsolation.allows(active.current.session),
        ready: visible.status === "ready" && latest.status === "ready",
        refreshing: Boolean(latest.refreshing), refreshFailed: Boolean(latest.refreshFailed),
        createBlocked: offerCommand ? offerCommand.kind === "save" && offerCommand.id === null && blocked("offer-create") : operation === "create" && blocked("partner-create"),
      }, setPartnerSubmissionFeedback)) return;
    }
    setPartnerSubmissionFeedback(null);
    busy.current = true;
    setMutationState("pending");
    const origin = session;
    const controller = new AbortController(); mutationAbort.current = controller;
    const current = () => active.current.session === origin && active.current.authorization === "authorized" && recoveryIsolation.allows(origin) && !controller.signal.aborted;
    try {
      const guard = await createSessionContinuityGuard(supabase, { signal: controller.signal });
      if (!current()) return;
      const identity = await verifiedMutationIdentity(supabase, controller.signal);
      await assertSessionContinuity(guard, supabase, controller.signal);
      const attempt = createMutationAttempt({ sessionGuard: guard, signal: controller.signal });
      const definitivelyRejected = (error: unknown) => offerCommand ? isOfferWriteRejected(error)
        : error instanceof MutationError && getPartnerWriteFailureEvidence(error)?.state === "database-rejected"
          && isDefinitiveDatabaseRejection(error.code, error.httpStatus);
      const coordinator = createPartnerMutationController({
        valid: async () => {
          if (!current()) return false;
          try {
            await assertSessionContinuity(guard, supabase);
            const member = await supabase.from("cms_admins").select("user_id").eq("user_id", origin!.user.id).maybeSingle();
            if (member.error || member.data?.user_id !== origin!.user.id) { if (current()) { loader.clear(); setMutationState("uncertain"); } return false; }
            return current();
          } catch { if (current()) { loader.clear(); setMutationState("uncertain"); } return false; }
        },
        refresh: async () => { await loader.load(current(), true); return current() && loader.getSnapshot().status === "ready" && !loader.getSnapshot().refreshFailed; },
        publish: setMutationState,
        rejectionFeedback: setPartnerSubmissionFeedback,
      });
      mutation.current = coordinator;
      const write = async () => {
        const options = attempt.options;
        if (offerCommand) return dispatchOfferCommand(offersWriteRepository, offerCommand, loader.getSnapshot(), options);
        if (operation === "create" && content) return partnersWriteRepository.create(content, options);
        if (operation === "update" && id && content) return partnersWriteRepository.update(id, content, options);
        if (operation === "delete" && id) {
          const partner = loader.getSnapshot().partners.find(row => row.id === id);
          if (!partner || partner.everAssociated || loader.getSnapshot().offers.some(offer => offer.partnerId === id)) throw new MutationError("domain");
          return partnersWriteRepository.remove(id, options);
        }
        throw new MutationError("domain");
      };
      const dispatch = async () => {
        try { return await write(); }
        catch (error) {
          // Once dispatch was possible, only repository-owned write rejection
          // evidence excludes commit. A generic exception never permits replay.
          if (attempt.wasDispatched() && !definitivelyRejected(error)) throw new MutationError("uncertain");
          throw error;
        }
      };
      const createKind = offerCommand?.kind === "save" && offerCommand.id === null ? "offer-create" : !offerCommand && operation === "create" ? "partner-create" : null;
      const result = await coordinator.run(async () => {
        if (!createKind) return dispatch();
        if (!navigator.locks) throw new MutationError("response");
        const marker = await navigator.locks.request(durableCreateKey, () => durable().reserve(identity, createKind, crypto.randomUUID()));
        setDurableVersion(value => value + 1);
        try {
          const outcome = await dispatch();
          if (outcome.outcome === "confirmed") {
            try { await navigator.locks.request(durableCreateKey, () => durable().resolve(marker)); } catch { /* Confirmed write stays confirmed; unresolved marker remains fail closed. */ }
          }
          return outcome;
        } catch (error) {
          if (!attempt.wasDispatched() || definitivelyRejected(error)) {
            // Resolve only this exact marker under the existing cross-tab lock.
            // A storage failure must preserve both blocking and the original error.
            try { await navigator.locks.request(durableCreateKey, () => durable().resolve(marker)); } catch { /* Keep blocked. */ }
          }
          throw error;
        } finally { setDurableVersion(value => value + 1); }
      });
      if (result && current()) navigate(offerCommand ? "/offers" : "/partners");
    } catch { if (current()) setMutationState("rejected"); }
    finally { if (!current()) setMutationState("uncertain"); busy.current = false; }
  }
  return <Context.Provider value={{ ...visible, mutationState, partnerSubmissionFeedback, partnerCreateBlocked, offerCreateBlocked, refreshData, mutatePartner, mutateOffer: command => mutatePartner("create", undefined, undefined, command) }}>{children}</Context.Provider>;
}
export function CmsReadNotice() {
  const { status } = useCmsData();
  if (status === "ready") return null;
  return <p role={status === "error" || status === "authorization" ? "alert" : "status"}>{status === "loading" ? "Carregando parceiros e ofertas…" : status === "error" ? "Não foi possível carregar os dados completos. Recarregue a página para tentar novamente." : "Acesso aos dados não autorizado."}</p>;
}
