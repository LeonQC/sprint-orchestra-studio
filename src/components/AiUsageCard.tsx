import { formatAiTime, formatModelCost, formatTokenCount } from './aiUsageUtils';
import './AiUsageCard.css';

interface AiUsageCardProps {
  title?: string;
  description: string;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  /** Of `inputTokens`, the portion served from the provider's prompt cache (billed ~10%).
   *  `inputTokens` is the *fresh* count (the server subtracts the cached part so cost isn't
   *  overstated ~10x), so the raw provider total shown in a trace is input + cached + output. */
  cachedInputTokens?: number;
  estimatedCostUsd: number;
  latencySeconds?: number;
  compact?: boolean;
  pricingStatus?: 'free_local' | 'estimated' | 'unavailable';
}

export function AiUsageCard({
  title = 'AI usage details',
  description,
  totalTokens,
  inputTokens,
  outputTokens,
  cachedInputTokens,
  estimatedCostUsd,
  latencySeconds,
  compact = false,
  pricingStatus,
}: AiUsageCardProps) {
  const cached = cachedInputTokens ?? 0;
  // The raw provider total — input + cached + output — so this number reconciles with a trace
  // (Phoenix / the provider dashboard), which never subtracts cached tokens.
  const calculatedTotal =
    totalTokens ?? (inputTokens ?? 0) + cached + (outputTokens ?? 0);

  return (
    <section
      className={`ai-usage-card${compact ? ' ai-usage-card--compact' : ''}`}
      aria-label={title}
    >
      <div className="ai-usage-card__heading">
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      <div className="ai-usage-card__metrics">
        <div>
          <span>Total tokens</span>
          <strong>{formatTokenCount(calculatedTotal)}</strong>
        </div>
        {inputTokens != null && (
          <div>
            <span>Prompt</span>
            <strong>{formatTokenCount(inputTokens + cached)}</strong>
            {cached > 0 && (
              <small className="ai-usage-card__sub">
                {formatTokenCount(cached)} cached · billed ~10%
              </small>
            )}
          </div>
        )}
        {outputTokens != null && (
          <div>
            <span>Response</span>
            <strong>{formatTokenCount(outputTokens)}</strong>
          </div>
        )}
        <div>
          <span>Estimated cost</span>
          <strong>{formatModelCost(estimatedCostUsd, pricingStatus)}</strong>
        </div>
        {latencySeconds != null && (
          <div>
            <span>AI time</span>
            <strong>{formatAiTime(latencySeconds)}</strong>
          </div>
        )}
      </div>
      <p className="ai-usage-card__note">
        {pricingStatus === 'free_local'
          ? 'Runs locally; there is no metered API charge.'
          : pricingStatus === 'unavailable'
            ? 'Token counts are available, but hosted pricing is not configured for this model.'
            : 'Token counts come from the AI provider. Cost is an estimate, not a billing charge.'}
        {cached > 0 &&
          ' Cached prompt tokens are re-used from a recent identical request and billed at ~10%.'}
      </p>
    </section>
  );
}
