import React from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon } from '@hugeicons/core-free-icons';
import {
  getToastStackTransform,
  MAX_VISIBLE_TOASTS,
  type ToastItem,
} from '../engine/toastQueue';

interface ToastStackProps {
  toasts: ToastItem[];
  isHovered: boolean;
  isFullscreen: boolean;
  onHoverChange: (hovered: boolean) => void;
  onDismiss: (id: string) => void;
  onResetSpecimen: (toastId: string) => void;
  onAnalyzeRun: (toast: ToastItem) => void;
}

function getDotColor(kind: ToastItem['kind']): string {
  if (kind === 'verdict-pass') return '#67E8F9';
  if (kind === 'verdict-fail') return '#FDA4AF';
  return '#A1A1AA';
}

export const ToastStack: React.FC<ToastStackProps> = ({
  toasts,
  isHovered,
  isFullscreen,
  onHoverChange,
  onDismiss,
  onResetSpecimen,
  onAnalyzeRun,
}) => {
  const visible = toasts.slice(0, MAX_VISIBLE_TOASTS);
  if (visible.length === 0) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label="Simulation Notifications"
      aria-live="polite"
      data-testid="toast-stack-container"
      data-hovered={isHovered}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      className={`${
        isFullscreen ? 'fixed' : 'absolute'
      } top-14 right-4 z-50 w-[340px] max-w-[90vw] pointer-events-auto select-none`}
    >
      <div className={isHovered ? 'flex flex-col gap-2' : 'relative'}>
        {visible.map((toast, idx) => {
          const tf = getToastStackTransform(idx, isHovered);
          const isVerdict =
            toast.kind === 'verdict-pass' || toast.kind === 'verdict-fail';
          const dotColor = getDotColor(toast.kind);
          const progressPct = Math.max(
            0,
            Math.min(100, (toast.remainingMs / Math.max(1, toast.durationMs)) * 100),
          );

          const positionClasses = isHovered
            ? 'relative z-30 opacity-100 pointer-events-auto'
            : idx === 0
              ? 'relative z-30 opacity-100 pointer-events-auto'
              : idx === 1
                ? 'absolute inset-x-0 top-0 z-20 opacity-70 pointer-events-none'
                : 'absolute inset-x-0 top-0 z-10 opacity-40 pointer-events-none';

          return (
            <div
              key={toast.id}
              data-testid={isVerdict ? 'test-verdict-toast' : `toast-item-${idx}`}
              data-toast-index={idx}
              data-toast-kind={toast.kind}
              style={{
                transform: `translateY(${tf.translateYPx}px) scale(${tf.scale})`,
                transformOrigin: 'top center',
              }}
              className={`${positionClasses} overflow-hidden rounded-xl border border-[#27272A] bg-[#111114]/95 p-3 backdrop-blur-xl shadow-2xl transition-all duration-200`}
            >
              {/* Top Row: 6px Status Dot + Monospace Title + Scenario Metadata + Dismiss x */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    aria-hidden="true"
                    style={{ backgroundColor: dotColor }}
                    className="h-1.5 w-1.5 rounded-full shrink-0"
                  />
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#F4F4F5] whitespace-nowrap">
                    {toast.title}
                  </span>
                  <span className="text-[#52525B] shrink-0">·</span>
                  <span className="font-mono text-[10.5px] tabular-nums text-[#71717A] truncate">
                    {toast.metadata}
                  </span>
                </div>

                <button
                  type="button"
                  data-testid={`dismiss-toast-${idx}`}
                  onClick={() => onDismiss(toast.id)}
                  aria-label="Dismiss notification"
                  className="inline-flex h-5 w-5 items-center justify-center rounded-md text-[#71717A] transition-colors hover:bg-[#18181C] hover:text-[#F4F4F5] shrink-0 cursor-pointer"
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.5} />
                </button>
              </div>

              {/* Body: Concise 1-2 line summary */}
              <p className="mt-1 font-mono text-[11px] tabular-nums leading-snug text-[#A1A1AA] line-clamp-2">
                {toast.summary}
              </p>

              {/* Verdict Action Row */}
              {isVerdict && (
                <div className="mt-2.5 flex items-center justify-end gap-2 border-t border-[#1F1F24] pt-2">
                  <button
                    type="button"
                    data-testid="verdict-reset-btn"
                    onClick={() => onResetSpecimen(toast.id)}
                    className="border-0 bg-transparent px-2 py-1 text-[11px] font-medium text-[#A1A1AA] transition-colors hover:text-[#F4F4F5] cursor-pointer"
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    data-testid="verdict-analyze-btn"
                    onClick={() => onAnalyzeRun(toast)}
                    className="rounded-md bg-[#F4F4F5] px-2.5 py-1 text-[11px] font-medium text-[#09090B] transition-colors hover:bg-white cursor-pointer"
                  >
                    Analyze Run
                  </button>
                </div>
              )}

              {/* Bottom 1.5px Shrinking Progress Hairline */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[1.5px] bg-[#1F1F24]">
                <div
                  data-testid={`toast-progress-${idx}`}
                  style={{
                    width: `${progressPct.toFixed(1)}%`,
                    backgroundColor: dotColor,
                  }}
                  className="h-full transition-[width] duration-75"
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
