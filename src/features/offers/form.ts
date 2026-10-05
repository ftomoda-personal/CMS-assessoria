import type { CalendarDate } from "./model";
import type { PublicationMode } from "./creation";

/** Restore a stored calendar day in local time, never parse it as UTC. */
export function dateSelection(value?: CalendarDate): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function publicationComplete(fields: {
  partnerId: string; title: string; description: string; hasCoupon: boolean;
  coupon: string; publicationMode: PublicationMode; startsOn: Date | null;
  hasExpiration: boolean; expiresOn: Date | null;
}): boolean {
  return Boolean(fields.partnerId && fields.title.trim() && fields.description.trim()
    && (!fields.hasCoupon || fields.coupon.trim())
    && (fields.publicationMode === "now" || fields.startsOn)
    && (!fields.hasExpiration || fields.expiresOn));
}
