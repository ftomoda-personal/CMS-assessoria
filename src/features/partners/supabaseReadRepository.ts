import type { PartnerRow } from "../../lib/supabase/database.types";
import { readDataset, validateRow } from "../../lib/supabase/readDataset.ts";
import type { ReadClient, ReadOptions } from "../../lib/supabase/readDataset";
import { mapPartnerRow } from "./mappers.ts";
import type { PersistedPartner } from "./mappers";

const columns = "id,name,website,logo_path,logo_name,ever_associated";
const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });

/** Isolated read-only API. No operational imports, cache, URL resolver or mutations. */
export function createPartnersReadRepository(client: ReadClient) {
  return {
    async readAll(options: ReadOptions = {}): Promise<readonly PersistedPartner[]> {
      const partners = await readDataset(client, { table: "partners", columns, map(row) {
        validateRow(row, { id: "string", name: "string", website: "string", logo_path: "nullable-string", logo_name: "nullable-string", ever_associated: "boolean" });
        return mapPartnerRow(row as PartnerRow);
      } }, options);
      return Object.freeze([...partners].sort((a, b) => collator.compare(a.name, b.name) || (a.id.toLowerCase() < b.id.toLowerCase() ? -1 : a.id.toLowerCase() > b.id.toLowerCase() ? 1 : 0)));
    },
  };
}

export const partnersReadRepository = {
  async readAll(options: ReadOptions = {}): Promise<readonly PersistedPartner[]> {
    const { supabase } = await import("../../lib/supabase/client.ts");
    return createPartnersReadRepository(supabase).readAll(options);
  },
};
