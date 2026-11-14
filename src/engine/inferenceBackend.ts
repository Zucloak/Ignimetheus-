export type InferenceBackendId = 'verified' | 'webgpu';

export type WebGpuRuntimePhase =
  | 'idle'
  | 'probing'
  | 'loading'
  | 'ready'
  | 'unavailable'
  | 'error';

export const WEBGPU_IFRAME_DISABLED_NOTE =
  'WebGPU disabled in preview iframe — open in Chrome/Edge desktop for local GPU inference; using Verified Telemetry Engine meanwhile';

export function getSelectedEngineLabel(selectedBackend: InferenceBackendId): string {
  return selectedBackend === 'webgpu'
    ? 'Qwen2.5-1.5B Local WebGPU'
    : 'Verified Telemetry Engine';
}

export function formatComposerBackendStatus(
  selectedBackend: InferenceBackendId,
  phase: WebGpuRuntimePhase,
  progressPct: number,
): { label: string; dotColor: 'cyan' | 'amber' | 'zinc' } {
  if (selectedBackend === 'verified') {
    return { label: 'Telemetry Grounded', dotColor: 'zinc' };
  }

  if (phase === 'ready') {
    return { label: 'WebGPU Ready', dotColor: 'cyan' };
  }

  if (phase === 'probing' || phase === 'loading') {
    const clamped = Math.max(0, Math.min(100, Math.round(progressPct)));
    return { label: `Loading Qwen2.5-1.5B · ${clamped}%`, dotColor: 'amber' };
  }

  if (phase === 'unavailable' || phase === 'error') {
    return { label: 'Telemetry Grounded', dotColor: 'amber' };
  }

  return { label: 'Telemetry Grounded', dotColor: 'zinc' };
}

export function isWorkerSandboxError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === 'object' && 'name' in err) {
    const name = String((err as { name?: unknown }).name ?? '');
    if (name === 'SecurityError') return true;
  }
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : typeof err === 'object' && 'message' in err
          ? String((err as { message?: unknown }).message ?? '')
          : '';
  return /securityerror|sandbox|worker|cross-origin|origin|blocked|script.*failed/i.test(message);
}
