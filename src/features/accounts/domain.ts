/** Account domain contracts. Helpers express future account eligibility only.
 * They do not authenticate callers or establish trusted administrative admission.
 * Callers must supply current server records, never Auth user_metadata.
 */
export type AccountRole = 'student' | 'administrator';
export type AccountStatus = 'pending_invitation' | 'active' | 'disabled';

/** Identifies the requesting actor only; this value carries no authority. */
export interface AccountManagementActor {
  readonly actorUserId: AccountRow['user_id'];
}

export interface AccountManagementTarget {
  readonly targetUserId: AccountRow['user_id'];
}

/** Intent only. Target role/status are requested values, never actor evidence.
 * Actor and target may be the same user; equality does not establish authority.
 */
export interface AccountManagementInput {
  readonly actor: AccountManagementActor;
  readonly target: AccountManagementTarget;
  readonly requestedRole: AccountRole;
  readonly requestedStatus: AccountStatus;
}

export type ProvisioningStatus = 'pending' | 'confirmed' | 'rejected' | 'failed' | 'uncertain';

/** Correlation reference, not an authorization identifier. Email is delivery
 * intent only; any eventual Auth identity must be independently established.
 */
export type ProvisioningTarget =
  | { readonly kind: 'user'; readonly userId: AccountRow['user_id'] }
  | { readonly kind: 'email'; readonly email: string };

/** Future private operation record, not a table/RPC or a dispatch instruction.
 * Confirmed requires authoritative persisted reconciliation of Auth and DB
 * outcomes; a response or account row alone cannot prove distributed success.
 */
export interface AccountProvisioningOperation {
  readonly operationId: string;
  readonly actor: AccountManagementActor;
  readonly target: ProvisioningTarget;
  readonly targetRole: AccountRole;
  readonly authUserId: AccountRow['user_id'] | null;
  readonly status: ProvisioningStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Classifies a recorded observation only; does not verify its provenance,
 * activate an account, grant membership or permit retries after uncertainty.
 */
export function isProvisioningConfirmed(operation: AccountProvisioningOperation): boolean {
  return operation.status === 'confirmed';
}

/** No authorized variant/constructor until a qualified server boundary can bind
 * current ALS admission to this actor and request. VerifiedLiveContext or a
 * PrivateAdmissionCheck alone must not be promoted to business authorization.
 */
export type AccountManagementAuthorizationDecision =
  | { readonly kind: 'denied'; readonly reason: 'missing-actor' }
  | { readonly kind: 'unavailable'; readonly reason: 'trusted-admission-required' };

/** Deliberately unavailable even for an active administrator. No operation is
 * enabled; client role/status, target identity and membership cannot authorize.
 */
export function accountManagementAuthorization(
  input: AccountManagementInput,
): AccountManagementAuthorizationDecision {
  return input.actor.actorUserId
    ? { kind: 'unavailable', reason: 'trusted-admission-required' }
    : { kind: 'denied', reason: 'missing-actor' };
}

export interface AccountRow {
  readonly user_id: string;
  readonly role: AccountRole;
  readonly status: AccountStatus;
  readonly display_name: string;
  readonly created_at: string;
  readonly updated_at: string;
}

/** Future account eligibility, not proof of current ALS admission or authority to
 * manage accounts. Membership is a separately fetched trusted cms_admins record.
 * Does not replace the existing membership-only SQL administrative predicate.
 */
export function hasAdministrativeAccess(
  userId: string | null,
  account: Pick<AccountRow, 'user_id' | 'role' | 'status'> | null,
  membership: { readonly user_id: string } | null,
): boolean {
  return !!userId && account?.user_id === userId
    && membership?.user_id === userId
    && account.role === 'administrator' && account.status === 'active';
}

export function hasStudentAccess(userId: string | null, account: Pick<AccountRow, 'user_id' | 'role' | 'status'> | null): boolean {
  return !!userId && account?.user_id === userId
    && account.role === 'student' && account.status === 'active';
}

/** Domain eligibility only. A future trusted server caller must provide its
 * verified current user ID, current account record and server-computed effective
 * status. These arguments are not proof of verification. SQL remains authoritative
 * for offer_effective_status; no offer fields, queries or date rules live here.
 */
export function isStudentOfferEligible(
  verifiedUserId: string | null,
  account: AccountRow | null,
  effectiveStatus: string | null,
): boolean {
  return hasStudentAccess(verifiedUserId, account) && effectiveStatus === 'active';
}

export interface AccountRpcContracts {
  readonly create_account: {
    readonly args: {
      readonly p_user_id: string;
      readonly p_role: AccountRole;
      readonly p_display_name: string;
    };
    readonly returns: AccountRow;
  };
  readonly update_account: {
    readonly args: {
      readonly p_user_id: string;
      readonly p_role: AccountRole;
      readonly p_status: AccountStatus;
      readonly p_display_name: string;
    };
    readonly returns: AccountRow;
  };
}
