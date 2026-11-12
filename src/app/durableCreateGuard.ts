export type CreateKind = "partner-create" | "offer-create";
export interface VerifiedCreateIdentity { userId: string; sessionId: string }
interface Marker extends VerifiedCreateIdentity { operation: CreateKind; operationId: string }
export const durableCreateKey = "xpto-cms:create-uncertainty:v1";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createDurableGuard(storage: Pick<Storage, "getItem" | "setItem">) {
 function read(): Marker[] {
  const raw = storage.getItem(durableCreateKey);
  if (raw === null) return [];
  const rows: unknown = JSON.parse(raw);
  if (!Array.isArray(rows) || rows.length > 2 || rows.some(row => !row || Object.keys(row).sort().join() !== "operation,operationId,sessionId,userId" || !["partner-create", "offer-create"].includes(row.operation) || !uuid.test(row.userId) || !uuid.test(row.sessionId) || !uuid.test(row.operationId)) || new Set(rows.map(row => row.operation)).size !== rows.length) throw new Error("Durable mutation safety unavailable");
  return rows;
 }
 function write(rows: Marker[]) {
  const expected = JSON.stringify(rows); storage.setItem(durableCreateKey, expected);
  if (storage.getItem(durableCreateKey) !== expected) throw new Error("Durable mutation safety unavailable");
 }
 return {
  blocked(operation: CreateKind) { try { return read().some(row => row.operation === operation); } catch { return true; } },
  reserve(identity: VerifiedCreateIdentity, operation: CreateKind, operationId: string) {
   if (![identity.userId, identity.sessionId, operationId].every(value => uuid.test(value))) throw new Error("Invalid verified identity");
   const rows = read(); if (rows.some(row => row.operation === operation)) throw new Error("Unresolved create");
   const marker = { ...identity, operation, operationId }; write([...rows, marker]); return marker;
  },
  resolve(marker: Marker) {
   const rows = read(); const actual = rows.find(row => row.operationId === marker.operationId);
   if (!actual || JSON.stringify(actual) !== JSON.stringify(marker)) throw new Error("Marker changed");
   write(rows.filter(row => row.operationId !== marker.operationId));
  },
 };
}
