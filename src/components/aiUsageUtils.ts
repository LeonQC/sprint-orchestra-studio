export function formatTokenCount(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString();
}

export function formatEstimatedCost(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return 'Free / local';
  if (value < 0.000001) return '<$0.000001';
  return `$${value.toFixed(6)}`;
}

export function formatModelCost(
  value: number,
  pricingStatus?: 'free_local' | 'estimated' | 'unavailable',
): string {
  if (pricingStatus === 'free_local') return 'No API charge';
  if (pricingStatus === 'unavailable') return 'Price unavailable';
  if (pricingStatus === 'estimated' && (!Number.isFinite(value) || value <= 0)) return '$0.000000';
  return formatEstimatedCost(value);
}

export function formatAiTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '—';
  return `${value.toFixed(2)}s`;
}
