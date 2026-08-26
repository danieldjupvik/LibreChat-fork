import { useMemo } from 'react';
import { Providers, EModelEndpoint } from 'librechat-data-provider';
import type { TModelSpec, TModelTokenomics } from 'librechat-data-provider';
import { useTokenConfigQuery } from '~/data-provider';

/** Model pricing and capability information rendered by the fork's model badges. */
export interface ModelPricingInfo {
  /** USD per 1M prompt tokens */
  inputPrice: number | null;
  /** USD per 1M completion tokens */
  outputPrice: number | null;
  showPricing: boolean;
  isFree: boolean;
  maxTokens: number | null;
  disabled: boolean;
}

const emptyPricingInfo: ModelPricingInfo = {
  inputPrice: null,
  outputPrice: null,
  showPricing: true,
  isFree: false,
  maxTokens: null,
  disabled: false,
};

const TOKEN_CONFIG_REFRESH_MS = 5 * 60 * 1000;

/** Gemini tokenomics are advertised under the `google` endpoint (mirrors `useTokenLimits`). */
const normalizeTokenConfigKey = (endpoint: string): string =>
  endpoint === Providers.VERTEXAI ? EModelEndpoint.google : endpoint;

const toPrice = (value?: number): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

const toContext = (value?: number): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

export const useTokenConfigRefresh = (enabled: boolean): void => {
  useTokenConfigQuery({
    enabled,
    staleTime: TOKEN_CONFIG_REFRESH_MS,
    refetchInterval: TOKEN_CONFIG_REFRESH_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: true,
  });
};

/**
 * Badge pricing for a model spec, resolved from the server's native token
 * config (`GET /api/endpoints/token-config`) — the same rates the context
 * gauge and server-side cost calculation use. Explicit `spec.badges` values
 * stay authoritative; the query only fills what the spec leaves unset, so
 * badges render immediately and refine once the query resolves.
 */
export const useModelPricingInfo = (spec?: TModelSpec): ModelPricingInfo => {
  const { data: tokenConfig } = useTokenConfigQuery();

  const endpoint = spec?.preset?.endpoint ?? '';
  const model = spec?.preset?.model ?? '';

  return useMemo(() => {
    if (!spec?.name) {
      return emptyPricingInfo;
    }

    const badges = spec.badges;
    const disabled = badges?.disabled ?? false;
    /** A disabled spec renders nothing, so server rates are never consulted. */
    const rates: TModelTokenomics | undefined =
      disabled || !model ? undefined : tokenConfig?.[normalizeTokenConfigKey(endpoint)]?.[model];

    /** Every field falls back the same way: an explicit badge value wins, the
     *  server fills the rest. `isFree` included — an explicit `false` is as
     *  authoritative as an explicit `true`. */
    const inputPrice = badges?.inputPrice ?? toPrice(rates?.prompt);
    const outputPrice = badges?.outputPrice ?? toPrice(rates?.completion);

    return {
      inputPrice,
      outputPrice,
      showPricing: badges?.showPricing ?? true,
      /** Derived from the RESOLVED prices, not the raw server rates: a spec that
       *  overrides a price on a zero-rated model is not free, and those are the
       *  prices the badges actually render. */
      isFree: badges?.isFree ?? (inputPrice === 0 && outputPrice === 0),
      maxTokens: badges?.maxContextToken ?? toContext(rates?.context),
      disabled,
    };
  }, [spec, endpoint, model, tokenConfig]);
};
