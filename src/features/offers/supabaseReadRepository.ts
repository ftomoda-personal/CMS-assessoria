import type { OfferReadRow } from "../../lib/supabase/database.types";
import { readDataset, validateRow } from "../../lib/supabase/readDataset.ts";
import type { ReadClient, ReadOptions } from "../../lib/supabase/readDataset";
import { mapOfferRow } from "./mappers.ts";
import type { PersistedOffer } from "./mappers";

const columns = "id,partner_id,title,subtitle,description,publication_mode,has_coupon,coupon,has_expiration,starts_on,expires_on,published_at,enabled,deleted_at,effective_status:offer_effective_status";

/** Uses the accepted server projection; actual persisted status values remain unverified. */
export function createOffersReadRepository(client: ReadClient) {
  return {
    readAll(options: ReadOptions = {}): Promise<readonly PersistedOffer[]> {
      return readDataset(client, { table: "offers", columns, map(row) {
        validateRow(row, {
          id: "string", partner_id: "nullable-string", title: "string", subtitle: "nullable-string",
          description: "string", publication_mode: "string", has_coupon: "boolean", coupon: "nullable-string",
          has_expiration: "boolean", starts_on: "nullable-string", expires_on: "nullable-string",
          published_at: "nullable-string", enabled: "boolean", deleted_at: "nullable-string", effective_status: "nullable-string",
        });
        return mapOfferRow(row as OfferReadRow);
      } }, options);
    },
  };
}

export const offersReadRepository = {
  async readAll(options: ReadOptions = {}): Promise<readonly PersistedOffer[]> {
    const { supabase } = await import("../../lib/supabase/client.ts");
    return createOffersReadRepository(supabase).readAll(options);
  },
};
