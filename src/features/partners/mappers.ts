import type { PartnerRow, PartnerWriteFields } from "../../lib/supabase/database.types";
import type { Partner, PartnerStatus } from "./model";
import type { PersistedOffer } from "../offers/mappers";
import { countPartnerOffers, derivePartners } from "./list.ts";

export interface PartnerLogo {
  readonly bucket: "partner-logos";
  readonly objectPath: string;
  readonly originalFilename: string | null;
  /** Supplied by a future Storage resolver; never inferred from the object path. */
  readonly publicUrl?: string;
}

/** Compatible with existing UI consumers; mocks need not pretend to be persisted. */
export interface PersistedPartner extends Partner {
  readonly everAssociated: boolean;
  readonly logo?: PartnerLogo;
}

export function mapPartnerRow(row: PartnerRow, resolvedPublicUrl?: string): PersistedPartner {
  if (row.logo_path === null && row.logo_name !== null) {
    throw new Error("Invalid Partner logo metadata");
  }
  if (row.logo_path === null && resolvedPublicUrl !== undefined) {
    throw new Error("Cannot resolve a Partner logo without an object path");
  }
  return {
    id: row.id,
    name: row.name,
    website: row.website,
    everAssociated: row.ever_associated,
    logo: row.logo_path === null ? undefined : {
      bucket: "partner-logos",
      objectPath: row.logo_path,
      originalFilename: row.logo_name,
      publicUrl: resolvedPublicUrl,
    },
    logoUrl: row.logo_path === null ? undefined : resolvedPublicUrl,
    logoName: row.logo_name ?? undefined,
  };
}

/** Never serializes history, ID, UI status or a resolved/session URL. */
export function mapPartnerWrite(partner: Pick<PersistedPartner, "name" | "website" | "logo">): PartnerWriteFields {
  return {
    name: partner.name,
    website: partner.website,
    logo_path: partner.logo?.objectPath ?? null,
    logo_name: partner.logo?.originalFilename ?? null,
  };
}

export interface PersistedPartnerListItem extends PersistedPartner {
  readonly status: PartnerStatus;
  readonly totalOffers: number;
  readonly activeOffers: number;
  /** UI eligibility only; RLS/triggers/FK remain authoritative. */
  readonly canDelete: boolean;
}

/** Caller must provide a complete, current set of non-deleted persisted Offers. */
export function mapPartnerList(partners: readonly PersistedPartner[], offers: readonly PersistedOffer[]): readonly PersistedPartnerListItem[] {
  const counts = countPartnerOffers(offers);
  const derived = derivePartners(partners, offers);
  return partners.map((partner, index) => {
    const count = counts.get(partner.id);
    return {
      ...partner,
      status: derived[index].status,
      totalOffers: count?.total ?? 0,
      activeOffers: count?.active ?? 0,
      canDelete: !partner.everAssociated && (count?.total ?? 0) === 0,
    };
  });
}
