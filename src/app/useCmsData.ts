import { createContext, useContext } from "react";
import type { JointState } from "./jointData";
import type { PartnerMutationState } from "../features/partners/partnerMutation";
import type { PartnerEditableContent } from "../features/partners/supabaseWriteRepository";
import type { OfferCommand } from "../features/offers/offerCommands";
export type CmsData = JointState & { mutationState: PartnerMutationState; partnerSubmissionFeedback: string | null; partnerCreateBlocked: boolean; offerCreateBlocked: boolean; refreshData(): Promise<void>; mutateOffer(command: OfferCommand): Promise<void>; mutatePartner(operation: "create" | "update" | "delete", id?: string, content?: PartnerEditableContent): Promise<void> };
export const CmsDataContext = createContext<CmsData | null>(null);
export function useCmsData() { const value = useContext(CmsDataContext); if (!value) throw new Error("CmsDataProvider required"); return value; }
