import { MATERIALS, type SimulationParams, type TestVerdict } from './thermoCore';

export type ToastKind = 'verdict-pass' | 'verdict-fail' | 'system';

export const SYSTEM_TOAST_DURATION_MS = 3500;
export const VERDICT_TOAST_DURATION_MS = 6500;
export const MAX_VISIBLE_TOASTS = 3;

export interface ToastItem {
  id: string;
  kind: ToastKind;
  title: string;
  metadata: string;
  summary: string;
  durationMs: number;
  remainingMs: number;
  verdict?: TestVerdict;
}

export interface EnqueueToastInput {
  id?: string;
  kind: ToastKind;
  title: string;
  metadata: string;
  summary: string;
  durationMs?: number;
  verdict?: TestVerdict;
}

export interface StackTransformSpec {
  translateYPx: number;
  scale: number;
  opacity: number;
  zIndex: number;
}

/**
 * Returns the 3D depth-stack transform metrics for index 0, 1, 2 when collapsed vs hovered.
 */
export function getToastStackTransform(index: number, isHovered: boolean): StackTransformSpec {
  if (isHovered) {
    return {
      translateYPx: 0,
      scale: 1.0,
      opacity: 1.0,
      zIndex: 30 - index * 10,
    };
  }
  if (index === 0) {
    return { translateYPx: 0, scale: 1.0, opacity: 1.0, zIndex: 30 };
  }
  if (index === 1) {
    return { translateYPx: 8, scale: 0.95, opacity: 0.7, zIndex: 20 };
  }
  return { translateYPx: 16, scale: 0.9, opacity: 0.4, zIndex: 10 };
}

/**
 * Prepends a new toast to the front of the queue (`index 0`).
 */
export function enqueueToast(
  queue: ToastItem[],
  input: EnqueueToastInput,
  nowIdSuffix: string = String(Date.now()),
): ToastItem[] {
  const defaultDur =
    input.kind === 'system' ? SYSTEM_TOAST_DURATION_MS : VERDICT_TOAST_DURATION_MS;
  const durationMs = input.durationMs ?? defaultDur;
  const nextItem: ToastItem = {
    id: input.id ?? `toast-${nowIdSuffix}-${queue.length + 1}`,
    kind: input.kind,
    title: input.title,
    metadata: input.metadata,
    summary: input.summary,
    durationMs,
    remainingMs: durationMs,
    verdict: input.verdict,
  };
  return [nextItem, ...queue].slice(0, 6);
}

/**
 * Advances toast countdown timers by `dtMs` unless `isHovered` is true.
 * Automatically removes any toast whose `remainingMs <= 0`.
 */
export function stepToastTimers(
  queue: ToastItem[],
  dtMs: number,
  isHovered: boolean,
): ToastItem[] {
  if (isHovered || dtMs <= 0 || queue.length === 0) {
    return queue;
  }
  const next: ToastItem[] = [];
  for (const item of queue) {
    const rem = item.remainingMs - dtMs;
    if (rem > 0) {
      next.push({ ...item, remainingMs: rem });
    }
  }
  return next;
}

export function dismissToastById(queue: ToastItem[], id: string): ToastItem[] {
  return queue.filter((t) => t.id !== id);
}

export function formatScenarioMetadata(params: SimulationParams): string {
  const mat = MATERIALS[params.materialId];
  return `${mat.shortName} · ${params.o2Percent.toFixed(1)}% O2`;
}

export function buildVerdictToastInput(
  verdict: TestVerdict,
  params: SimulationParams,
): EnqueueToastInput {
  const isPass = verdict.outcome === 'PASS';
  const burnStr =
    verdict.burnLengthMm < 0.05 ? '0 mm' : `${verdict.burnLengthMm.toFixed(1)} mm`;
  const timeStr = `${verdict.elapsedTimeS.toFixed(1)}s`;

  const summary =
    verdict.reason === 'SELF_EXTINGUISHED'
      ? `Self-extinguished at ${burnStr} in ${timeStr}`
      : isPass
        ? `Contained propagation: ${burnStr} in ${timeStr} (<= 152 mm limit)`
        : `Sustained propagation: ${burnStr} in ${timeStr}`;

  return {
    kind: isPass ? 'verdict-pass' : 'verdict-fail',
    title: `NASA-STD-6001 · ${verdict.outcome}`,
    metadata: formatScenarioMetadata(params),
    summary,
    durationMs: VERDICT_TOAST_DURATION_MS,
    verdict,
  };
}
