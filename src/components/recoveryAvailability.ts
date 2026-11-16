import type { ActiveRecoveryLookupDto, RecoveryStatusDto } from '../api';

export type ActiveRecoveryLookupWire = ActiveRecoveryLookupDto | RecoveryStatusDto | null;

/**
 * Keeps the modal usable during a rolling/local restart where the browser has the new bundle but
 * ai-service still serves the previous `/by-sprint` contract (`null` or a bare recovery status).
 */
export function normalizeRecoveryLookup(value: ActiveRecoveryLookupWire): ActiveRecoveryLookupDto {
  if (value == null) return { availability: 'none', recovery: null };
  if ('availability' in value) return value;
  return { availability: 'resumable', recovery: value };
}
