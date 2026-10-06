/** Presentation derived from all existing Offer associations. Never persisted. */
export type PartnerStatus = "active" | "inactive";
export interface Partner {
  readonly id: string;
  readonly name: string;
  readonly website: string;
  readonly logoUrl?: string;
  /** Blob URLs belong only to this browser session; never production storage. */
  readonly logoKind?: "session-object-url";
  /** Original filename for static/session logo presentation. */
  readonly logoName?: string;
}
