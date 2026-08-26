import React from 'react';
import { render, screen } from '@testing-library/react';
import type { TModelSpec, TTokenConfigMap } from 'librechat-data-provider';
import { ModelBadges } from './modelBadges';

const mockUseTokenConfigQuery = jest.fn();

jest.mock('~/data-provider', () => ({
  useTokenConfigQuery: () => mockUseTokenConfigQuery(),
}));

jest.mock('./openRouterAdapter', () => ({
  useNewModelCheck: () => ({ isNew: false, createdAt: null }),
}));

jest.mock('@librechat/client', () => ({
  TooltipAnchor: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const tokenConfig: TTokenConfigMap = {
  LiteLLM: {
    'free-model': { prompt: 0, completion: 0, context: 32000 },
    'gpt-4.1': { prompt: 2, completion: 8, context: 1047576 },
  },
};

const specFor = (model: string, badges?: TModelSpec['badges']): TModelSpec =>
  ({
    name: `spec-${model}`,
    label: model,
    preset: { endpoint: 'LiteLLM', model },
    ...(badges ? { badges } : {}),
  }) as TModelSpec;

/**
 * Renders the real badge row. The hook has its own tests, but resolving
 * `isFree` correctly is worthless if the component re-derives free-ness from
 * the rates afterwards — that regression is only visible from here.
 */
describe('ModelBadges', () => {
  beforeEach(() => {
    mockUseTokenConfigQuery.mockReturnValue({ data: tokenConfig });
  });

  it('shows the free badge for a zero-rate model when the spec is silent', () => {
    render(<ModelBadges spec={specFor('free-model')} />);

    expect(screen.getByText('Currently free')).toBeInTheDocument();
    expect(screen.queryByText('$0.00/1M')).not.toBeInTheDocument();
  });

  it('honours an explicit isFree: false on a zero-rate model', () => {
    render(<ModelBadges spec={specFor('free-model', { isFree: false })} />);

    expect(screen.queryByText('Currently free')).not.toBeInTheDocument();
    expect(screen.getAllByText('$0.00/1M')).toHaveLength(2);
  });

  it('renders the overridden price instead of a free badge on a zero-rated model', () => {
    render(<ModelBadges spec={specFor('free-model', { inputPrice: 2 })} />);

    expect(screen.queryByText('Currently free')).not.toBeInTheDocument();
    expect(screen.getByText('$2.00/1M')).toBeInTheDocument();
    expect(screen.getByText('$0.00/1M')).toBeInTheDocument();
  });

  it('honours an explicit isFree: true on a priced model', () => {
    render(<ModelBadges spec={specFor('gpt-4.1', { isFree: true })} />);

    expect(screen.getByText('Currently free')).toBeInTheDocument();
    expect(screen.queryByText('$2.00/1M')).not.toBeInTheDocument();
  });

  it('renders server prices and context for a priced model', () => {
    render(<ModelBadges spec={specFor('gpt-4.1')} />);

    expect(screen.getByText('$2.00/1M')).toBeInTheDocument();
    expect(screen.getByText('$8.00/1M')).toBeInTheDocument();
    expect(screen.getByText('1.0M')).toBeInTheDocument();
    expect(screen.queryByText('Currently free')).not.toBeInTheDocument();
  });

  it('renders nothing when badges are disabled', () => {
    const { container } = render(<ModelBadges spec={specFor('gpt-4.1', { disabled: true })} />);

    expect(container).toBeEmptyDOMElement();
  });
});
