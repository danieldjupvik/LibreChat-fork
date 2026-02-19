import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { VisuallyHidden } from '@ariakit/react';
import type { TModelSpec } from 'librechat-data-provider';
import { CustomMenuItem as MenuItem } from '../CustomMenu';
import { useModelSelectorContext } from '../ModelSelectorContext';
import { useLocalize } from '~/hooks';
import SpecIcon from './SpecIcon';
import { cn } from '~/utils';
import { ModelBadges, CapabilityIcons } from '~/forked-code-custom';

interface ModelSpecItemProps {
  spec: TModelSpec;
  isSelected: boolean;
}

export function ModelSpecItem({ spec, isSelected }: ModelSpecItemProps) {
  const localize = useLocalize();
  const { handleSelectSpec, endpointsConfig } = useModelSelectorContext();
  const { showIconInMenu = true } = spec;

  return (
    <MenuItem
      key={spec.name}
      onClick={() => handleSelectSpec(spec)}
      aria-selected={isSelected || undefined}
      className={cn(
        'flex w-full cursor-pointer items-center justify-between rounded-lg px-2 text-sm',
      )}
    >
      <div
        className={cn(
          'flex w-full min-w-0 gap-2 px-1 py-1',
          spec.description ? 'items-start' : 'items-center',
        )}
      >
        {showIconInMenu && (
          <div className="flex-shrink-0">
            <SpecIcon currentSpec={spec} endpointsConfig={endpointsConfig} />
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-left">{spec.label}</span>
          {spec.description && (
            <span className="break-words text-xs font-normal">{spec.description}</span>
          )}
          <ModelBadges spec={spec} />
        </div>
      </div>

      {/* Wrapper for capability icons and selected checkmark, aligned to top */}
      <div
        className="flex flex-shrink-0 gap-2 py-1"
        style={{ alignSelf: 'flex-start', marginRight: isSelected ? '0' : '24px' }}
      >
        <CapabilityIcons capabilities={spec.iconCapabilities} />
      </div>

      {isSelected && (
        <>
          <CheckCircle2
            className="size-4 shrink-0 self-center text-text-primary"
            aria-hidden="true"
          />
          <VisuallyHidden>{localize('com_a11y_selected')}</VisuallyHidden>
        </>
      )}
    </MenuItem>
  );
}

export function renderModelSpecs(specs: TModelSpec[], selectedSpec: string) {
  if (!specs || specs.length === 0) {
    return null;
  }

  return specs.map((spec) => (
    <ModelSpecItem key={spec.name} spec={spec} isSelected={selectedSpec === spec.name} />
  ));
}
