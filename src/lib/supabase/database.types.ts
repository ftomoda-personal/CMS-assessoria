/**
 * Manually maintained transport contracts checked against
 * 20261006000000_initial_cms_foundation.sql; not generated Database types.
 * SQL text/date/timestamptz values remain strings at the transport boundary.
 * These types describe payloads, not permission to write every column.
 */
export interface PartnerRow {
  readonly id: string;
  readonly name: string;
  readonly website: string;
  readonly logo_path: string | null;
  readonly logo_name: string | null;
  readonly ever_associated: boolean;
}

export interface OfferRow {
  readonly id: string;
  readonly partner_id: string | null;
  readonly title: string;
  readonly subtitle: string | null;
  readonly description: string;
  readonly publication_mode: string;
  readonly has_coupon: boolean;
  readonly coupon: string | null;
  readonly has_expiration: boolean;
  readonly starts_on: string | null;
  readonly expires_on: string | null;
  readonly published_at: string | null;
  readonly enabled: boolean;
  readonly deleted_at: string | null;
}

/** Explicit SELECT projection; absent from raw table rows and write RPC returns. */
export interface OfferReadRow extends OfferRow {
  readonly effective_status: string | null;
}

/** Only editable Partner columns; ID and historical association are database-owned. */
export interface PartnerWriteFields {
  readonly name: string;
  readonly website: string;
  readonly logo_path: string | null;
  readonly logo_name: string | null;
}

/** Full-content save command; intentionally requires explicit publication intent. */
export interface SaveOfferArgs {
  readonly p_id: string | null;
  readonly p_partner_id: string | null;
  readonly p_title: string;
  readonly p_subtitle: string | null;
  readonly p_description: string;
  readonly p_publication_mode: "now" | "scheduled";
  readonly p_has_coupon: boolean;
  readonly p_coupon: string | null;
  readonly p_has_expiration: boolean;
  readonly p_starts_on: string | null;
  readonly p_expires_on: string | null;
  readonly p_publish: boolean;
}

/** Contracts of the existing public functions, with no new RPCs or client calls. */
export interface OfferRpcContracts {
  readonly offer_effective_status: {
    readonly args: { readonly p_offer: OfferRow };
    readonly returns: string | null;
  };
  readonly save_offer: { readonly args: SaveOfferArgs; readonly returns: OfferRow };
  readonly set_offer_enabled: {
    readonly args: { readonly p_id: string; readonly p_enabled: boolean };
    readonly returns: OfferRow;
  };
  readonly activate_scheduled_offer: {
    readonly args: { readonly p_id: string };
    readonly returns: OfferRow;
  };
  readonly soft_delete_offer: {
    readonly args: { readonly p_id: string };
    readonly returns: void;
  };
}
