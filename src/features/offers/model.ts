/** UI statuses; manual activation is explicit, with no clock-driven transitions. */
export type OfferStatus = "active" | "scheduled" | "draft" | "expired" | "inactive";

/** Calendar-day strings preserve dates without time-zone conversion. */
export type CalendarDate = `${number}-${number}-${number}`;

/** Relationship view of the canonical Partner domain. */
export type PartnerReference = Pick<import("../partners/model").Partner, "id" | "name" | "logoUrl">;

export interface Offer {
  readonly id: string;
  readonly partnerId?: PartnerReference["id"];
  readonly publicationMode?: "now" | "scheduled";
  readonly hasCoupon?: boolean;
  readonly hasExpiration?: boolean;
  readonly title: string;
  readonly subtitle?: string;
  readonly description: string;
  readonly coupon?: string;
  readonly startsOn?: CalendarDate;
  readonly expiresOn?: CalendarDate;
  readonly status: OfferStatus;
}
