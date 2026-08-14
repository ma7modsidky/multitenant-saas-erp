/**
 * Pure decision helpers for the platform-admin org-detail page (PLT-8).
 * Extracted from the page component so the tricky logic — especially the
 * extend-trial end-date rule that must mirror the backend — is unit-testable.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The backend's extend rule (AdjustEntitlementUseCase.extendTrial):
 * - a RUNNING trial (`trialing`) is extended from the LATER of its current
 *   end date or now, so a short extension never shortens it;
 * - a trial that already ended (`expired` — lapsed naturally or admin-stopped)
 *   is extended from NOW, because the stored end date is stale history.
 *
 * The dialog preview must mirror the backend exactly. `state` is the
 * entitlement state; without it the preview for a manually stopped trial
 * would show the old end + days ("stop a 14-day trial, extend by 2 ⇒ 16 days")
 * while the backend grants 2.
 */
export function extendedTrialEnd(state: string, currentEndIso: string | null, days: number): Date {
  const currentEnd = currentEndIso ? new Date(currentEndIso).getTime() : 0;
  const running = state === 'trialing' && !Number.isNaN(currentEnd) && currentEnd > Date.now();
  const base = running ? currentEnd : Date.now();
  return new Date(base + days * DAY_MS);
}

export type ModuleAction = 'enable' | 'extend-trial' | 'stop-trial' | 'suspend' | 'activate' | 'disable' | 'block';

/**
 * Actions available for an entitlement state (PLT-8). A used trial can never
 * be started again (BILL-2), so `trialUsed` hides the enable-with-trial path,
 * and `trialAvailable` (catalog trialDays > 0) hides it for trial-less
 * modules. Suspend is the PAID-module hold (BILL-6) — never offered on an
 * admin full-access grant with no Stripe item.
 */
export function actionsFor(
  state: string,
  trialUsed: boolean,
  trialAvailable: boolean,
  isPaid: boolean,
): ModuleAction[] {
  switch (state) {
    case 'available':
      return ['enable'];
    case 'trialing':
      // Blocking mid-trial stops the trial AND gates the module (PLT-8).
      return ['extend-trial', 'stop-trial', 'block', 'disable'];
    case 'active':
      return isPaid ? ['suspend', 'disable'] : ['disable'];
    case 'past_due':
      return ['activate'];
    case 'expired':
      // The Enable dialog hides trial grants when the trial was used (BILL-2).
      return ['enable', 'extend-trial', 'disable'];
    case 'suspended':
      return ['activate'];
    case 'blocked':
      return ['enable', 'disable'];
    case 'disabled':
      return ['enable'];
    default:
      return ['disable'];
  }
}

export type EnableMode = 'trial' | 'full' | 'block';

/** Modes offered in the Enable dialog for this state. Trial grants require
    the trial to be unused (BILL-2); an already-blocked module has no need of
    the block mode again. */
export function enableModesFor(state: string, trialUsed: boolean): EnableMode[] {
  const modes: EnableMode[] = [];
  if (!trialUsed) modes.push('trial');
  modes.push('full');
  if (state !== 'blocked') modes.push('block');
  return modes;
}
