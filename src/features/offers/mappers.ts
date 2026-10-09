import type { OfferReadRow, SaveOfferArgs } from "../../lib/supabase/database.types";
import type { CalendarDate, Offer, OfferStatus } from "./model";

export interface PersistedOffer extends Offer {
  readonly publicationMode: "now" | "scheduled";
  readonly hasCoupon: boolean;
  readonly hasExpiration: boolean;
  readonly publishedAt?: string;
  readonly enabled: boolean;
}

function mapEffectiveStatus(value: unknown): OfferStatus {
  switch (value) {
    case "active":
    case "inactive":
    case "scheduled":
    case "expired":
    case "draft":
      return value;
    default:
      throw new Error("Unexpected effective Offer status");
  }
}

function mapPublicationMode(value: string): "now" | "scheduled" {
  if (value !== "now" && value !== "scheduled") throw new Error("Unexpected Offer publication mode");
  return value;
}

function mapCalendarDate(value: string | null): CalendarDate | undefined {
  if (value === null) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Unexpected Offer date representation");
  // Transport format validation only: no Date construction, timezone conversion or status derivation.
  return value as CalendarDate;
}

/** Deleted rows are excluded. Live rows require an explicit server status projection. */
export function mapOfferRow(row: OfferReadRow): PersistedOffer | null {
  if (row.deleted_at !== null) {
    if (row.effective_status !== null) throw new Error("Inconsistent deleted Offer status");
    return null;
  }
  return {
    id: row.id,
    partnerId: row.partner_id ?? undefined,
    title: row.title,
    subtitle: row.subtitle ?? undefined,
    description: row.description,
    publicationMode: mapPublicationMode(row.publication_mode),
    hasCoupon: row.has_coupon,
    coupon: row.coupon ?? undefined,
    hasExpiration: row.has_expiration,
    startsOn: mapCalendarDate(row.starts_on),
    expiresOn: mapCalendarDate(row.expires_on),
    publishedAt: row.published_at ?? undefined,
    enabled: row.enabled,
    status: mapEffectiveStatus(row.effective_status),
  };
}

export type OfferSaveContent = Pick<PersistedOffer,
  "partnerId" | "title" | "subtitle" | "description" | "publicationMode" |
  "hasCoupon" | "coupon" | "hasExpiration" | "startsOn" | "expiresOn">;

/** Full-content command mapping; identity and publication intent are explicit inputs. */
export function mapOfferSave(content: OfferSaveContent, intent: { readonly id: string | null; readonly publish: boolean }): SaveOfferArgs {
  return {
    p_id: intent.id,
    p_partner_id: content.partnerId ?? null,
    p_title: content.title,
    p_subtitle: content.subtitle ?? null,
    p_description: content.description,
    p_publication_mode: mapPublicationMode(content.publicationMode),
    p_has_coupon: content.hasCoupon,
    p_coupon: content.coupon ?? null,
    p_has_expiration: content.hasExpiration,
    p_starts_on: content.startsOn ?? null,
    p_expires_on: content.expiresOn ?? null,
    p_publish: intent.publish,
  };
}
