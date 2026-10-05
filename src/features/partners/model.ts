/** Administrative state, independent of the partner's offers. */
export type PartnerStatus = "active" | "inactive";
export interface Partner {
  readonly id: string;
  readonly name: string;
  readonly website: string;
  readonly logoUrl?: string;
  /** Blob URLs belong only to this browser session; never production storage. */
  readonly logoKind?: "session-object-url";
  readonly status: PartnerStatus;
}
