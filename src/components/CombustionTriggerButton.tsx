import React from 'react';
import {
  IGNITION_PULSE_DURATION_S,
  type ChamberCombustionState,
} from '../engine/thermoCore';

interface CombustionTriggerButtonProps {
  chamberState: ChamberCombustionState;
  stateElapsedS: number;
  variant: 'ghost' | 'dock';
  testId?: string;
  onClick: () => void;
}

export const CombustionTriggerButton: React.FC<CombustionTriggerButtonProps> = ({
  chamberState,
  stateElapsedS,
  variant,
  testId,
  onClick,
}) => {
  const ignRem = Math.max(0, IGNITION_PULSE_DURATION_S - stateElapsedS).toFixed(1);

  const isIgniting = chamberState === 'IGNITING';
  const isBurning = chamberState === 'SUSTAINED_BURN';

  const label = isIgniting
    ? `Extinguish · ${ignRem}s`
    : isBurning
      ? 'Extinguish'
      : 'Ignite';

  const tooltip = isIgniting
    ? `Abort 80W ignition pulse (${ignRem}s remaining)`
    : isBurning
      ? 'Extinguish chamber flame smoothly'
      : 'Ignite: 3.5s 80W hot-wire ignition pulse';

  const isExtinguishMode = isIgniting || isBurning;
  const dotColor = isIgniting ? '#FCD34D' : '#FDA4AF';

  if (variant === 'ghost') {
    return (
      <button
        type="button"
        data-testid={testId}
        onClick={onClick}
        title={tooltip}
        aria-label={label}
        className={`relative inline-flex items-center gap-1.5 bg-transparent border-0 px-2.5 py-1.5 text-xs font-medium font-mono tabular-nums transition-all whitespace-nowrap shrink-0 cursor-pointer ${
          isExtinguishMode
            ? 'text-[#F4F4F5]'
            : 'text-[#A1A1AA] hover:text-[#F4F4F5]'
        }`}
      >
        {isExtinguishMode && (
          <span
            aria-hidden="true"
            style={{ backgroundColor: dotColor }}
            className="h-1.5 w-1.5 rounded-full shrink-0"
          />
        )}
        <span>{label}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      title={tooltip}
      aria-label={label}
      className={`relative inline-flex items-center gap-1.5 bg-transparent border-0 px-2.5 py-1.5 text-xs font-medium font-mono tabular-nums transition-all whitespace-nowrap shrink-0 cursor-pointer ${
        isExtinguishMode
          ? 'text-[#F4F4F5]'
          : 'text-[#A1A1AA] hover:text-[#F4F4F5]'
      }`}
    >
      {isExtinguishMode && (
        <span
          aria-hidden="true"
          style={{ backgroundColor: dotColor }}
          className="h-1.5 w-1.5 rounded-full shrink-0"
        />
      )}
      <span>{label}</span>
    </button>
  );
};
