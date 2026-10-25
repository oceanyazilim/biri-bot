import { severityRank, type ExemptionReason, type GuardModuleSettings, type ProtectionMode, type Severity } from '../../../types/guard';

export type PolicyAction = 'LOG' | 'ALERT' | 'ENFORCE';

export type PolicyReason =
  | 'UNVERIFIED'
  | 'EXEMPT'
  | 'BELOW_THRESHOLD'
  | 'MONITOR_MODE'
  | 'ALERT_MODE'
  | 'AUTO_STRIP_DISABLED'
  | 'THRESHOLD_REACHED';

export interface PolicyInput {
  mode: ProtectionMode;
  module: Pick<GuardModuleSettings, 'autoStrip'>;
  severity: Severity;
  thresholdReached: boolean;
  executorVerified: boolean;
  exemption: ExemptionReason | null;
}

export interface PolicyDecision {
  action: PolicyAction;
  reason: PolicyReason;
  /** Whether administrators should be notified (guard log + mentions). */
  notify: boolean;
  /** Whether a SecurityIncident should be opened for the executor. */
  openIncident: boolean;
}

/**
 * Decides what Biri does with an evaluated event. Automatic sanctions require
 * all of: verified attribution, no exemption, a reached threshold, ACTIVE mode
 * and a module that explicitly allows role stripping.
 */
export function decideProtection(input: PolicyInput): PolicyDecision {
  const notifiable = input.mode !== 'MONITOR' && severityRank(input.severity) >= severityRank('HIGH');

  if (!input.executorVerified) {
    return { action: notifiable ? 'ALERT' : 'LOG', reason: 'UNVERIFIED', notify: notifiable, openIncident: false };
  }
  if (input.exemption) {
    const alert = input.thresholdReached && input.mode !== 'MONITOR';
    return { action: alert ? 'ALERT' : 'LOG', reason: 'EXEMPT', notify: alert, openIncident: false };
  }
  if (!input.thresholdReached) {
    return { action: notifiable ? 'ALERT' : 'LOG', reason: 'BELOW_THRESHOLD', notify: notifiable, openIncident: false };
  }
  switch (input.mode) {
    case 'MONITOR':
      return { action: 'LOG', reason: 'MONITOR_MODE', notify: false, openIncident: true };
    case 'ALERT':
      return { action: 'ALERT', reason: 'ALERT_MODE', notify: true, openIncident: true };
    case 'ACTIVE':
      return input.module.autoStrip
        ? { action: 'ENFORCE', reason: 'THRESHOLD_REACHED', notify: true, openIncident: true }
        : { action: 'ALERT', reason: 'AUTO_STRIP_DISABLED', notify: true, openIncident: true };
  }
}
