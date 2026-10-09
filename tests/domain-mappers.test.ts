import assert from "node:assert/strict";
import { test } from "node:test";
import type { OfferReadRow, PartnerRow } from "../src/lib/supabase/database.types.ts";
import { mapPartnerList, mapPartnerRow, mapPartnerWrite } from "../src/features/partners/mappers.ts";
import { mapOfferRow, mapOfferSave } from "../src/features/offers/mappers.ts";

const partnerId = "f518e9d0-71d7-4a47-bc7f-d6e12de44104";
const partner: PartnerRow = Object.freeze({ id: partnerId, name: "Árvore", website: "marca.example", logo_path: null, logo_name: null, ever_associated: false });
const offer: OfferReadRow = Object.freeze({
  id: "668db553-cf97-4502-9bca-38372c57f718", partner_id: partnerId,
  title: "Oferta", subtitle: null, description: "Descrição", publication_mode: "now",
  has_coupon: false, coupon: null, has_expiration: false, starts_on: null,
  expires_on: null, published_at: null, enabled: true, deleted_at: null, effective_status: "draft",
});

test("Partner without logo preserves identity/text and maps nullable metadata", () => {
  const mapped = mapPartnerRow(partner);
  assert.equal(mapped.id, partnerId);
  assert.equal(mapped.name, "Árvore");
  assert.equal(mapped.website, partner.website);
  assert.equal(mapped.everAssociated, false);
  assert.equal(mapped.logo, undefined);
  assert.equal(mapped.logoUrl, undefined);
  assert.equal(mapped.logoName, undefined);
  assert.equal(mapped.logoKind, undefined);
});

test("Partner path remains separate from explicitly resolved public URL", () => {
  const row = { ...partner, logo_path: "logos/object.png", logo_name: "Marca original.png", ever_associated: true };
  const mapped = mapPartnerRow(row, "https://assets.example/logo.png");
  assert.equal(mapped.everAssociated, true);
  assert.deepEqual(mapped.logo, { bucket: "partner-logos", objectPath: row.logo_path, originalFilename: row.logo_name, publicUrl: mapped.logoUrl });
  assert.equal(mapped.logoUrl, "https://assets.example/logo.png");
  assert.equal(mapped.logoName, row.logo_name);
  assert.equal(mapPartnerRow(row).logoUrl, undefined);
});

test("Logo path can exist without a filename; impossible pair is rejected", () => {
  assert.equal(mapPartnerRow({ ...partner, logo_path: "logos/object.svg" }).logo?.originalFilename, null);
  assert.throws(() => mapPartnerRow({ ...partner, logo_name: "orphan.png" }), /metadata/);
  assert.throws(() => mapPartnerRow(partner, "https://assets.example/orphan.png"), /object path/);
});

test("Partner write contains only editable fields, preserving logo path and omitting history/URL", () => {
  const mapped = mapPartnerRow({ ...partner, logo_path: "logos/a.jpg", logo_name: "a.jpg", ever_associated: true }, "https://assets.example/a.jpg");
  assert.deepEqual(mapPartnerWrite(mapped), { name: partner.name, website: partner.website, logo_path: "logos/a.jpg", logo_name: "a.jpg" });
  assert.deepEqual(mapPartnerWrite(mapPartnerRow(partner)), { name: partner.name, website: partner.website, logo_path: null, logo_name: null });
});

for (const status of ["draft", "active", "inactive", "scheduled", "expired"] as const) {
  test(`Offer consumes server status ${status} without recalculating from dates/flags`, () => {
    const mapped = mapOfferRow({ ...offer, effective_status: status });
    assert.equal(mapped?.status, status);
    assert.equal(mapped?.id, offer.id);
    assert.equal(mapped?.partnerId, partnerId);
  });
}

test("Nullable Offer fields map explicitly; empty strings are not treated as null", () => {
  const mapped = mapOfferRow({ ...offer, partner_id: null });
  assert.ok(mapped);
  for (const field of ["partnerId", "subtitle", "coupon", "startsOn", "expiresOn", "publishedAt"] as const) assert.equal(mapped[field], undefined);
  assert.equal(mapped.hasCoupon, false);
  assert.equal(mapped.hasExpiration, false);
  assert.equal(mapped.enabled, true);
  const empty = mapOfferRow({ ...offer, subtitle: "", coupon: "" });
  assert.equal(empty?.subtitle, "");
  assert.equal(empty?.coupon, "");
});

for (const status of ["unknown", "Active", "", null, undefined]) {
  test(`Invalid live status ${String(status)} is rejected`, () => {
    // Exercise missing projection at runtime, despite its required transport type.
    assert.throws(() => mapOfferRow({ ...offer, effective_status: status } as OfferReadRow), /effective Offer status/);
  });
}

test("Soft-deleted Offer is excluded; contradictory status is rejected", () => {
  assert.equal(mapOfferRow({ ...offer, deleted_at: "2026-10-08T14:00:00Z", effective_status: null }), null);
  assert.throws(() => mapOfferRow({ ...offer, deleted_at: "2026-10-08T14:00:00Z" }), /deleted Offer status/);
});

test("Dates/timestamps and optional content are copied without timezone reinterpretation", () => {
  const row = { ...offer, publication_mode: "scheduled", has_coupon: true, coupon: "CUPOM", has_expiration: true, subtitle: "Subtítulo", starts_on: "2026-10-08", expires_on: "2026-12-31", published_at: "2026-10-08T23:30:00.123456-03:00", enabled: false, effective_status: "inactive" };
  const mapped = mapOfferRow(row);
  assert.equal(mapped?.startsOn, row.starts_on);
  assert.equal(mapped?.expiresOn, row.expires_on);
  assert.equal(mapped?.publishedAt, row.published_at);
  assert.equal(mapped?.publicationMode, "scheduled");
  assert.equal(mapped?.hasCoupon, true);
  assert.equal(mapped?.coupon, "CUPOM");
  assert.equal(mapped?.hasExpiration, true);
  assert.equal(mapped?.subtitle, "Subtítulo");
  assert.equal(mapped?.enabled, false);
});

test("Unexpected publication mode/date representation is rejected", () => {
  assert.throws(() => mapOfferRow({ ...offer, publication_mode: "later" }), /publication mode/);
  assert.throws(() => mapOfferRow({ ...offer, starts_on: "2026-10-08T00:00:00Z" }), /date representation/);
});

test("Save mapping uses explicit intent and excludes status/timestamps/server flags", () => {
  const mapped = mapOfferRow(offer);
  assert.ok(mapped);
  assert.deepEqual(mapOfferSave(mapped, { id: null, publish: false }), {
    p_id: null, p_partner_id: partnerId, p_title: offer.title, p_subtitle: null,
    p_description: offer.description, p_publication_mode: "now", p_has_coupon: false,
    p_coupon: null, p_has_expiration: false, p_starts_on: null, p_expires_on: null, p_publish: false,
  });
  const command = mapOfferSave(mapped, { id: offer.id, publish: true });
  assert.equal(command.p_id, offer.id);
  assert.equal(command.p_publish, true);
  assert.equal(mapOfferSave({ ...mapped, partnerId: undefined }, { id: null, publish: false }).p_partner_id, null);
});

test("Partner status uses every non-deleted Offer status, not association history", () => {
  for (const status of ["draft", "active", "inactive", "scheduled", "expired"] as const) {
    const mapped = mapOfferRow({ ...offer, effective_status: status });
    assert.ok(mapped);
    const [listed] = mapPartnerList([mapPartnerRow({ ...partner, ever_associated: true })], [mapped]);
    assert.equal(listed.status, "active");
    assert.equal(listed.totalOffers, 1);
    assert.equal(listed.activeOffers, status === "active" ? 1 : 0);
    assert.equal(listed.canDelete, false);
  }
});

test("Inactive Partner with historical association remains undeletable", () => {
  const [historical] = mapPartnerList([mapPartnerRow({ ...partner, ever_associated: true })], []);
  assert.equal(historical.status, "inactive");
  assert.equal(historical.totalOffers, 0);
  assert.equal(historical.canDelete, false);
  const [newPartner] = mapPartnerList([mapPartnerRow(partner)], []);
  assert.equal(newPartner.status, "inactive");
  assert.equal(newPartner.canDelete, true);
});

test("Partner projections count only matching stable IDs and do not mutate inputs", () => {
  const mapped = mapOfferRow(offer);
  assert.ok(mapped);
  const persisted = Object.freeze(mapPartnerRow(partner));
  const rows = Object.freeze([persisted]);
  const [listed] = mapPartnerList(rows, [Object.freeze({ ...mapped, partnerId: "other-id" })]);
  assert.equal(listed.totalOffers, 0);
  assert.equal(listed.id, partnerId);
  assert.equal("status" in persisted, false);
});

test("Write mapping preserves dates and never infers publication intent from status", () => {
  const mapped = mapOfferRow({ ...offer, starts_on: "2026-10-08", expires_on: "2026-12-31", effective_status: "active", published_at: "2026-10-08T23:30:00-03:00" });
  assert.ok(mapped);
  const command = mapOfferSave(mapped, { id: mapped.id, publish: false });
  assert.equal(command.p_publish, false);
  assert.equal(command.p_starts_on, "2026-10-08");
  assert.equal(command.p_expires_on, "2026-12-31");
  assert.equal("published_at" in command, false);
  assert.equal("enabled" in command, false);
});

// Compile-time checks; never executed and never mutate fixtures.
const compileTimeChecks = () => {
  // @ts-expect-error Association history is read-only at the row boundary.
  partner.ever_associated = true;
  const persisted = mapPartnerRow(partner);
  // @ts-expect-error Association history remains read-only in the persisted domain.
  persisted.everAssociated = true;
  // @ts-expect-error Raw RPC rows lack the required server status projection.
  mapOfferRow({ ...offer, effective_status: undefined });
};
void compileTimeChecks;
