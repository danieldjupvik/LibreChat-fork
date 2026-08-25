import { renderHook } from '@testing-library/react';
import type { TModelSpec, TTokenConfigMap } from 'librechat-data-provider';
import { useModelPricingInfo, useTokenConfigRefresh } from './modelPricing';

const mockUseTokenConfigQuery = jest.fn();

jest.mock('~/data-provider', () => ({
  useTokenConfigQuery: (config?: unknown) => mockUseTokenConfigQuery(config),
}));

const tokenConfig: TTokenConfigMap = {
  LiteLLM: {
    'gpt-4.1': { prompt: 2, completion: 8, context: 1047576 },
    'free-model': { prompt: 0, completion: 0, context: 32000 },
  },
};

const specFor = (model: string, badges?: TModelSpec['badges']): TModelSpec =>
  ({
    name: `spec-${model}`,
    label: model,
    preset: { endpoint: 'LiteLLM', model },
    ...(badges ? { badges } : {}),
  }) as TModelSpec;

describe('useModelPricingInfo', () => {
  beforeEach(() => {
    mockUseTokenConfigQuery.mockClear();
    mockUseTokenConfigQuery.mockReturnValue({ data: tokenConfig });
  });

  const renderFor = (spec?: TModelSpec) =>
    renderHook(() => useModelPricingInfo(spec)).result.current;

  it('resolves prices and context from the native token config', () => {
    expect(renderFor(specFor('gpt-4.1'))).toEqual({
      inputPrice: 2,
      outputPrice: 8,
      maxTokens: 1047576,
      showPricing: true,
      isFree: false,
      disabled: false,
    });
  });

  it('keeps explicit spec badge overrides authoritative', () => {
    const info = renderFor(specFor('gpt-4.1', { inputPrice: 99, maxContextToken: 8000 }));

    expect(info.inputPrice).toBe(99);
    expect(info.maxTokens).toBe(8000);
    expect(info.outputPrice).toBe(8);
  });

  it('marks a zero-rate model as free', () => {
    expect(renderFor(specFor('free-model')).isFree).toBe(true);
  });

  it('is not free when a spec overrides one price on a zero-rated model', () => {
    const info = renderFor(specFor('free-model', { inputPrice: 2 }));

    expect(info.isFree).toBe(false);
    expect(info.inputPrice).toBe(2);
    expect(info.outputPrice).toBe(0);
  });

  it('is free when a spec override is itself zero on a zero-rated model', () => {
    expect(renderFor(specFor('free-model', { inputPrice: 0 })).isFree).toBe(true);
  });

  it('respects an explicit isFree: false against zero server rates', () => {
    expect(renderFor(specFor('free-model', { isFree: false })).isFree).toBe(false);
  });

  it('respects an explicit isFree: true against priced server rates', () => {
    expect(renderFor(specFor('gpt-4.1', { isFree: true })).isFree).toBe(true);
  });

  it('honours disabled badges without consulting rates', () => {
    const info = renderFor(specFor('gpt-4.1', { disabled: true }));

    expect(info.disabled).toBe(true);
    expect(info.inputPrice).toBeNull();
  });

  it('falls back to badge-only values while the query is loading', () => {
    mockUseTokenConfigQuery.mockReturnValue({ data: undefined });

    const info = renderFor(specFor('gpt-4.1', { outputPrice: 12 }));

    expect(info).toEqual({
      inputPrice: null,
      outputPrice: 12,
      maxTokens: null,
      showPricing: true,
      isFree: false,
      disabled: false,
    });
  });

  it('falls back to badge-only values for a model the server does not price', () => {
    expect(renderFor(specFor('unknown-model')).inputPrice).toBeNull();
  });

  it('returns empty info for a missing spec', () => {
    expect(renderFor(undefined)).toEqual({
      inputPrice: null,
      outputPrice: null,
      maxTokens: null,
      showPricing: true,
      isFree: false,
      disabled: false,
    });
  });
});

describe('useTokenConfigRefresh', () => {
  it('refreshes token config while the authenticated route is mounted', () => {
    mockUseTokenConfigQuery.mockClear();
    renderHook(() => useTokenConfigRefresh(true));

    expect(mockUseTokenConfigQuery).toHaveBeenCalledTimes(1);
    expect(mockUseTokenConfigQuery).toHaveBeenCalledWith({
      enabled: true,
      staleTime: 300_000,
      refetchInterval: 300_000,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchOnMount: true,
    });
  });
});
