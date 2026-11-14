import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InitProgressReport, MLCEngineInterface } from '@mlc-ai/web-llm';
import {
  isWorkerSandboxError,
  WEBGPU_IFRAME_DISABLED_NOTE,
  type InferenceBackendId,
  type WebGpuRuntimePhase,
} from '../engine/inferenceBackend';
import {
  auditLlmNumbers,
  buildGroundedChatAnswer,
  buildSafetyReasoningSteps,
  buildTieredSystemPrompt,
  buildVerifiedSafetySnapshot,
  buildWebLlmPrompt,
  checkOutOfScopeQuery,
  NUMERIC_GUARDRAIL_INSTRUCTION,
  quickRuleMatch,
  trimToLastCompleteSentence,
  type SafetyReasoningStep,
  type SafetyRecommendation,
} from '../engine/safetyAdvisor';
import type {
  MatchedExperimentResult,
  NasaPsiExperiment,
  SimulationParams,
  ThermoTelemetry,
} from '../engine/thermoCore';
import type { CadMarker } from '../engine/ductProbes';
import { formatSpreadRate, type UnitSystem } from '../engine/units';
import {
  formatTierStatusLabel,
  getCachedHardwareProfile,
  getHardwareProfile,
  resolveVerifiedMlcModelId,
  type HardwareProfile,
} from '../utils/hardwareProfiler';

export const WEBLLM_MODEL_ID = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';

const WARMUP_TIMEOUT_MS = 10_000;
const COMPLETION_TIMEOUT_MS = 18_000;
const LOCKED_TEMPERATURE = 0.15;

// Module-level singleton engine, worker, and initialization promise deduplicator
let engineInstance: MLCEngineInterface | null = null;
let engineWorkerInstance: Worker | null = null;
let engineInitPromise: Promise<MLCEngineInterface | null> | null = null;
let activeSingletonModelId: string | null = null;

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timerId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timerId !== null) {
      clearTimeout(timerId);
    }
  });
}

export function resetWebLlmSingleton(): void {
  engineInitPromise = null;
  if (engineWorkerInstance) {
    try {
      engineWorkerInstance.onerror = null;
      engineWorkerInstance.onmessageerror = null;
      engineWorkerInstance.terminate();
    } catch {
      // Ignore worker termination errors
    }
    engineWorkerInstance = null;
  }
  engineInstance = null;
  activeSingletonModelId = null;
}

export type SafetyOfficerStatus =
  | 'Verified Telemetry Snapshot Fallback'
  | 'Loading Local Weights'
  | 'Offline WebGPU Ready';

export type SafetyMessageSource =
  | 'Deterministic'
  | 'Local model (numbers audited)'
  | 'Not modeled';

export interface MessageTelemetrySnapshot {
  experiment: NasaPsiExperiment;
  similarityScore: number;
  spreadLabel: string;
  loiMarginLabel: string;
  regime: string;
  hazardLevel: SafetyRecommendation['hazardLevel'];
  params: SimulationParams;
}

export interface SafetyChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  source: SafetyMessageSource;
  kind?: 'diagnostic' | 'chat';
  promptForRegenerate?: string;
  snapshot?: MessageTelemetrySnapshot;
  thoughtSteps?: SafetyReasoningStep[];
  thoughtDurationS?: number;
  createdAtMs?: number;
  threadSnapshot?: SafetyChatMessage[];
}

export interface ActiveSafetyThinking {
  id: string;
  kind: 'diagnostic' | 'chat';
  activeLabel: string;
  steps: SafetyReasoningStep[];
  stepIntervalMs: number;
}

interface UseSafetyOfficerLLMArgs {
  params: SimulationParams;
  telemetry: ThermoTelemetry;
  matched: MatchedExperimentResult;
  unitSystem: UnitSystem;
  markers?: CadMarker[];
}

export function useSafetyOfficerLLM({
  params,
  telemetry,
  matched,
  unitSystem,
  markers = [],
}: UseSafetyOfficerLLMArgs) {
  const [selectedBackend, setSelectedBackend] = useState<InferenceBackendId>('verified');
  const [webGpuPhase, setWebGpuPhase] = useState<WebGpuRuntimePhase>('idle');
  const [status, setStatus] = useState<SafetyOfficerStatus>('Verified Telemetry Snapshot Fallback');
  const [loadProgress, setLoadProgress] = useState<number>(0);
  const [loadNote, setLoadNote] = useState<string>(
    'Deterministic telemetry snapshot active (zero network calls).',
  );
  const [webGpuUnavailableNote, setWebGpuUnavailableNote] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [activeThinking, setActiveThinking] = useState<ActiveSafetyThinking | null>(null);
  const [regeneratingMessageId, setRegeneratingMessageId] = useState<string | null>(null);
  const [webGpuSupported, setWebGpuSupported] = useState<boolean>(false);
  const [hardwareProfile, setHardwareProfile] = useState<HardwareProfile | null>(() =>
    getCachedHardwareProfile(),
  );
  const [activeModelId, setActiveModelId] = useState<string | null>(() => activeSingletonModelId);
  const [auditPassCount, setAuditPassCount] = useState<number>(0);
  const [auditFailCount, setAuditFailCount] = useState<number>(0);
  const [messages, setMessages] = useState<SafetyChatMessage[]>([]);
  const [sessionArchive, setSessionArchive] = useState<SafetyChatMessage[]>([]);
  const [lastUpdatedLabel, setLastUpdatedLabel] = useState<string>('Synced to telemetry');

  const cancelTokenRef = useRef<number>(0);
  const loadTokenRef = useRef<number>(0);
  const pendingReasoningTimerRef = useRef<{
    timerId: number;
    resolve: (completed: boolean) => void;
  } | null>(null);

  const handleScopedWorkerError = useCallback((reason: string) => {
    resetWebLlmSingleton();
    setActiveModelId(null);
    setWebGpuPhase('error');
    setStatus('Verified Telemetry Snapshot Fallback');
    setLoadProgress(0);
    const fallbackNote = `Local WebGPU worker recovered (${reason}) — using Deterministic Telemetry Engine.`;
    setWebGpuUnavailableNote(fallbackNote);
    setLoadNote(fallbackNote);
  }, []);

  useEffect(() => {
    const hasGpu = typeof navigator !== 'undefined' && 'gpu' in navigator && Boolean(navigator.gpu);
    setWebGpuSupported(hasGpu);
    void getHardwareProfile().then((prof) => {
      setHardwareProfile(prof);
      setWebGpuSupported(prof.hasWebGpu && prof.allowWebLlm);
    });

    return () => {
      loadTokenRef.current += 1;
      if (pendingReasoningTimerRef.current) {
        window.clearTimeout(pendingReasoningTimerRef.current.timerId);
        pendingReasoningTimerRef.current.resolve(false);
        pendingReasoningTimerRef.current = null;
      }
    };
  }, []);

  const verifiedSnapshot: SafetyRecommendation = useMemo(
    () => buildVerifiedSafetySnapshot(params, telemetry, matched, unitSystem),
    [params, telemetry, matched, unitSystem],
  );

  const buildSnapshotBadge = useCallback((): MessageTelemetrySnapshot => {
    const spreadFmt = formatSpreadRate(telemetry.flameSpreadRateMs, unitSystem);
    return {
      experiment: matched.experiment,
      similarityScore: matched.similarityScore,
      spreadLabel: `${spreadFmt.text} ${spreadFmt.unit}`,
      loiMarginLabel: `${telemetry.loiMarginPercent >= 0 ? '+' : ''}${telemetry.loiMarginPercent.toFixed(1)}%`,
      regime: telemetry.regime,
      hazardLevel: verifiedSnapshot.hazardLevel,
      params: {
        ...params,
        ...(params.hardware ? { hardware: { ...params.hardware } } : {}),
      },
    };
  }, [matched, params, telemetry, unitSystem, verifiedSnapshot.hazardLevel]);

  // Keep telemetry label synced when parameters update
  useEffect(() => {
    setLastUpdatedLabel('Synced to telemetry');
  }, [
    params.o2Percent,
    params.pressurePa,
    params.flowVelocityMs,
    params.gravityMs2,
    params.materialId,
    params.flowMode,
    unitSystem,
  ]);

  const initLocalWeights = useCallback(async () => {
    const token = ++loadTokenRef.current;
    setSelectedBackend('webgpu');
    setWebGpuUnavailableNote(null);

    if (engineInstance && activeSingletonModelId) {
      setActiveModelId(activeSingletonModelId);
      setWebGpuPhase('ready');
      setStatus('Offline WebGPU Ready');
      setLoadProgress(100);
      setLoadNote(`Local WebGPU model ready: ${activeSingletonModelId}`);
      return true;
    }

    setWebGpuPhase('probing');
    setStatus('Loading Local Weights');
    setLoadProgress(0);
    setLoadNote('Probing WebGPU hardware tier...');

    const profile = await getHardwareProfile();
    setHardwareProfile(profile);

    if (loadTokenRef.current !== token) {
      return false;
    }

    // Requirement 1: On constrained hardware tier, disable WebLLM completely and run Deterministic mode only
    if (profile.tier === 'constrained' || !profile.allowWebLlm) {
      const constrainedNote =
        profile.tier === 'constrained'
          ? 'Constrained hardware tier detected — locked to Deterministic Telemetry Engine (prevents small-model numeric drift & mobile OOM).'
          : WEBGPU_IFRAME_DISABLED_NOTE;
      setWebGpuSupported(false);
      setActiveModelId(null);
      setWebGpuPhase('unavailable');
      setStatus('Verified Telemetry Snapshot Fallback');
      setLoadProgress(0);
      setWebGpuUnavailableNote(constrainedNote);
      setLoadNote(constrainedNote);
      return false;
    }

    if (!profile.hasWebGpu) {
      setWebGpuSupported(false);
      setActiveModelId(null);
      setWebGpuPhase('unavailable');
      setStatus('Verified Telemetry Snapshot Fallback');
      setLoadProgress(0);
      setWebGpuUnavailableNote(WEBGPU_IFRAME_DISABLED_NOTE);
      setLoadNote(WEBGPU_IFRAME_DISABLED_NOTE);
      return false;
    }

    setWebGpuSupported(true);

    try {
      setWebGpuPhase('loading');
      setLoadProgress(0);

      // Deduplicate concurrent preload and user prompt initializations
      if (!engineInitPromise) {
        engineInitPromise = (async (): Promise<MLCEngineInterface | null> => {
          const {
            CreateWebWorkerMLCEngine,
            CreateMLCEngine,
            prebuiltAppConfig,
          } = await import('@mlc-ai/web-llm');

          const installedIds = (prebuiltAppConfig?.model_list ?? []).map((m) => m.model_id);
          const verifiedModelId = resolveVerifiedMlcModelId(profile, installedIds);

          if (!verifiedModelId) {
            throw new Error(
              `No verified Qwen2.5 model ID from [${profile.candidateModelIds.join(', ')}] found in prebuiltAppConfig.model_list`,
            );
          }

          activeSingletonModelId = verifiedModelId;
          setActiveModelId(verifiedModelId);

          const minContextWindow = profile.tier === 'performance' ? 2048 : 1024;
          const contextWindowSize = Math.max(minContextWindow, profile.contextWindowSize);

          setLoadNote(
            `Initializing ${verifiedModelId} (${profile.tier} tier, KV ${contextWindowSize}) via WebGPU worker...`,
          );

          const initProgressCallback = (report: InitProgressReport) => {
            const pct = Math.max(0, Math.min(100, Math.round((report.progress ?? 0) * 100)));
            setLoadProgress(pct);
            setLoadNote(report.text || `Loading ${verifiedModelId} · ${pct}%`);
          };

          const chatOpts = {
            context_window_size: contextWindowSize,
          };

          let createdEngine: MLCEngineInterface;
          try {
            const worker = new Worker(new URL('../workers/webllm.worker.ts', import.meta.url), {
              type: 'module',
            });
            // Scoped strictly to the dedicated WebLLM worker instance
            worker.onerror = (errEvent) => {
              errEvent.preventDefault?.();
              handleScopedWorkerError('worker error');
            };
            worker.onmessageerror = () => {
              handleScopedWorkerError('worker message error');
            };
            engineWorkerInstance = worker;

            createdEngine = await CreateWebWorkerMLCEngine(
              worker,
              verifiedModelId,
              { initProgressCallback },
              chatOpts,
            );
          } catch (workerErr) {
            if (engineWorkerInstance) {
              try {
                engineWorkerInstance.onerror = null;
                engineWorkerInstance.onmessageerror = null;
                engineWorkerInstance.terminate();
              } catch {
                // Ignore
              }
              engineWorkerInstance = null;
            }
            if (isWorkerSandboxError(workerErr)) {
              setLoadNote(
                'Worker restricted in iframe — falling back to main-thread WebGPU engine...',
              );
              createdEngine = await CreateMLCEngine(
                verifiedModelId,
                { initProgressCallback },
                chatOpts,
              );
            } else {
              throw workerErr;
            }
          }

          // Conditional 1-token shader warmup on balanced & performance tiers
          if (profile.enableWarmup) {
            setLoadNote(`Pre-compiling WebGPU shaders (${profile.tier} tier)...`);
            try {
              await withTimeout(
                createdEngine.chat.completions.create({
                  messages: [{ role: 'user', content: 'ok' }],
                  max_tokens: 1,
                  temperature: 0.1,
                  stream: false,
                }),
                WARMUP_TIMEOUT_MS,
                'WebGPU warmup timed out after 10s',
              );
            } catch {
              // Non-fatal warmup timeout; continue with initialized engine
            } finally {
              if (typeof createdEngine.resetChat === 'function') {
                try {
                  await createdEngine.resetChat();
                } catch {
                  // Ignore warmup reset error
                }
              }
            }
          }

          engineInstance = createdEngine;
          return createdEngine;
        })();
      }

      const engine = await engineInitPromise;

      if (loadTokenRef.current !== token || !engine) {
        return false;
      }

      setWebGpuPhase('ready');
      setStatus('Offline WebGPU Ready');
      setLoadProgress(100);
      setWebGpuUnavailableNote(null);
      setLoadNote(`WebGPU Ready: ${activeSingletonModelId ?? profile.modelId} (${profile.tier})`);
      return true;
    } catch (err) {
      resetWebLlmSingleton();
      setActiveModelId(null);
      if (loadTokenRef.current !== token) {
        return false;
      }
      const msg = err instanceof Error ? err.message : String(err ?? '');
      const isGpuOrIframeIssue = /gpu|adapter|webgpu|security|sandbox|origin/i.test(msg);
      const note = isGpuOrIframeIssue
        ? WEBGPU_IFRAME_DISABLED_NOTE
        : 'WebGPU model weights unavailable offline — using Deterministic Telemetry Engine meanwhile';
      setWebGpuPhase('error');
      setStatus('Verified Telemetry Snapshot Fallback');
      setLoadProgress(0);
      setWebGpuUnavailableNote(note);
      setLoadNote(note);
      return false;
    }
  }, [handleScopedWorkerError]);

  const unloadLocalWeights = useCallback(() => {
    loadTokenRef.current += 1;
    resetWebLlmSingleton();
    setActiveModelId(null);
    setSelectedBackend('verified');
    setWebGpuPhase('idle');
    setStatus('Verified Telemetry Snapshot Fallback');
    setLoadProgress(0);
    setWebGpuUnavailableNote(null);
    setLoadNote('Deterministic telemetry snapshot active (zero network calls).');
  }, []);

  const selectBackend = useCallback(
    (next: InferenceBackendId) => {
      if (next === 'verified') {
        unloadLocalWeights();
      } else {
        setSelectedBackend('webgpu');
        setWebGpuUnavailableNote(null);
        void initLocalWeights();
      }
    },
    [initLocalWeights, unloadLocalWeights],
  );

  const clearPendingReasoningTimer = useCallback(() => {
    if (pendingReasoningTimerRef.current) {
      window.clearTimeout(pendingReasoningTimerRef.current.timerId);
      const { resolve } = pendingReasoningTimerRef.current;
      pendingReasoningTimerRef.current = null;
      resolve(false);
    }
  }, []);

  const awaitReasoningTrace = useCallback(
    (token: number, durationMs = 1180) =>
      new Promise<boolean>((resolve) => {
        clearPendingReasoningTimer();
        if (cancelTokenRef.current !== token) {
          resolve(false);
          return;
        }
        const timerId = window.setTimeout(() => {
          pendingReasoningTimerRef.current = null;
          resolve(cancelTokenRef.current === token);
        }, durationMs);
        pendingReasoningTimerRef.current = { timerId, resolve };
      }),
    [clearPendingReasoningTimer],
  );

  const stopGenerating = useCallback(() => {
    cancelTokenRef.current += 1;
    clearPendingReasoningTimer();
    if (engineInstance && typeof engineInstance.interruptGenerate === 'function') {
      try {
        engineInstance.interruptGenerate();
      } catch {
        // Ignore interrupt errors
      }
    }
    setActiveThinking(null);
    setRegeneratingMessageId(null);
    setIsGenerating(false);
  }, [clearPendingReasoningTimer]);

  const messagesRef = useRef<SafetyChatMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const appendAssistantMessage = useCallback((assistantMsg: SafetyChatMessage) => {
    const withTime: SafetyChatMessage = {
      ...assistantMsg,
      createdAtMs: assistantMsg.createdAtMs ?? Date.now(),
    };
    const nextThread = [...messagesRef.current, withTime];
    messagesRef.current = nextThread;
    const archivedEntry: SafetyChatMessage = {
      ...withTime,
      threadSnapshot: nextThread,
    };
    setMessages(nextThread);
    setSessionArchive((arch) => [
      ...arch.filter((m) => m.id !== archivedEntry.id),
      archivedEntry,
    ]);
  }, []);

  /**
   * Executes a non-streaming atomic WebGPU completion wrapped in an 18-second hard timeout,
   * trims truncated sentences on `finish_reason === 'length'`, resets the KV cache, and runs
   * the strict post-LLM numeric audit against the live telemetry snapshot.
   */
  const runAuditedWebGpuCompletion = useCallback(
    async (
      chatMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    ): Promise<string | null> => {
      const engine = engineInstance;
      if (!engine) return null;
      const profile = hardwareProfile ?? (await getHardwareProfile());
      if (profile.tier === 'constrained' || !profile.allowWebLlm) {
        return null;
      }

      try {
        const reply = await withTimeout(
          engine.chat.completions.create({
            messages: chatMessages,
            temperature: LOCKED_TEMPERATURE,
            max_tokens: profile.maxTokens,
            stream: false,
          }),
          COMPLETION_TIMEOUT_MS,
          'WebGPU inference timed out after 18s',
        );

        const choice = reply.choices?.[0];
        const rawText = choice?.message?.content?.trim() || '';
        if (!rawText) return null;

        const cleanedText =
          choice?.finish_reason === 'length'
            ? trimToLastCompleteSentence(rawText)
            : rawText;

        const audit = auditLlmNumbers(
          cleanedText,
          params,
          telemetry,
          matched,
          unitSystem,
          markers,
        );

        if (!audit.passed) {
          setAuditFailCount((c) => c + 1);
          return null;
        }

        setAuditPassCount((c) => c + 1);
        return cleanedText;
      } finally {
        if (engineInstance && typeof engineInstance.resetChat === 'function') {
          try {
            await engineInstance.resetChat();
          } catch {
            resetWebLlmSingleton();
            setActiveModelId(null);
          }
        }
      }
    },
    [hardwareProfile, markers, matched, params, telemetry, unitSystem],
  );

  const analyzeSuppressionProtocol = useCallback(async () => {
    if (isGenerating) return;
    const token = ++cancelTokenRef.current;
    const diagId = `diag-${Date.now()}`;
    const userPrompt = 'Run Protocol Diagnostic for current chamber telemetry.';
    const snapMeta = buildSnapshotBadge();
    const useWebGpu = Boolean(
      engineInstance &&
        status === 'Offline WebGPU Ready' &&
        hardwareProfile?.tier !== 'constrained',
    );
    const backendLabel = useWebGpu
      ? `${hardwareProfile?.modelFamily ?? 'Qwen2.5-1.5B'} Local WebGPU`
      : 'Deterministic Telemetry Engine';
    const steps = buildSafetyReasoningSteps(
      params,
      telemetry,
      matched,
      unitSystem,
      'diagnostic',
      markers,
      backendLabel,
    );
    const startedAt = performance.now();

    setIsGenerating(true);
    setRegeneratingMessageId(null);
    setActiveThinking({
      id: `${diagId}-think`,
      kind: 'diagnostic',
      activeLabel: useWebGpu
        ? 'Thinking · Local WebGPU'
        : 'Analyzing chamber telemetry & PSI flight bounds',
      steps,
      stepIntervalMs: useWebGpu ? 750 : 280,
    });

    const userMsg: SafetyChatMessage = {
      id: `${diagId}-u`,
      role: 'user',
      content: userPrompt,
      source: useWebGpu ? 'Local model (numbers audited)' : 'Deterministic',
      createdAtMs: Date.now(),
    };
    const nextWithUser = [...messagesRef.current, userMsg];
    messagesRef.current = nextWithUser;
    setMessages(nextWithUser);

    try {
      if (useWebGpu && engineInstance) {
        const prompt = buildWebLlmPrompt(params, telemetry, matched, unitSystem);
        const auditedText = await runAuditedWebGpuCompletion([
          {
            role: 'system',
            content: `You are an onboard Spacecraft Fire Safety Officer. Provide crisp, technical fire-suppression orders citing the exact NASA PSI run ID. Zero emojis. ${NUMERIC_GUARDRAIL_INSTRUCTION}`,
          },
          { role: 'user', content: prompt },
        ]);
        if (cancelTokenRef.current !== token) return;
        if (auditedText) {
          const durationS = Math.max(0.1, (performance.now() - startedAt) / 1000);
          appendAssistantMessage({
            id: `${diagId}-a`,
            role: 'assistant',
            content: auditedText,
            source: 'Local model (numbers audited)',
            kind: 'diagnostic',
            promptForRegenerate: userPrompt,
            snapshot: snapMeta,
            thoughtSteps: steps,
            thoughtDurationS: durationS,
          });
          setLastUpdatedLabel('Local model (numbers audited)');
          return;
        }
      }

      const completed = await awaitReasoningTrace(token, 1180);
      if (!completed || cancelTokenRef.current !== token) return;
      const durationS = Math.max(0.1, (performance.now() - startedAt) / 1000);
      appendAssistantMessage({
        id: `${diagId}-a`,
        role: 'assistant',
        content: verifiedSnapshot.rawText,
        source: 'Deterministic',
        kind: 'diagnostic',
        promptForRegenerate: userPrompt,
        snapshot: snapMeta,
        thoughtSteps: steps,
        thoughtDurationS: durationS,
      });
      setLastUpdatedLabel('Deterministic');
    } catch {
      if (cancelTokenRef.current !== token) return;
      const durationS = Math.max(0.1, (performance.now() - startedAt) / 1000);
      appendAssistantMessage({
        id: `${diagId}-a`,
        role: 'assistant',
        content: verifiedSnapshot.rawText,
        source: 'Deterministic',
        kind: 'diagnostic',
        promptForRegenerate: userPrompt,
        snapshot: snapMeta,
        thoughtSteps: steps,
        thoughtDurationS: durationS,
      });
      setLastUpdatedLabel('Deterministic');
    } finally {
      if (cancelTokenRef.current === token) {
        setActiveThinking(null);
        setIsGenerating(false);
      }
    }
  }, [
    appendAssistantMessage,
    awaitReasoningTrace,
    buildSnapshotBadge,
    hardwareProfile?.modelFamily,
    hardwareProfile?.tier,
    isGenerating,
    markers,
    matched,
    params,
    runAuditedWebGpuCompletion,
    status,
    telemetry,
    unitSystem,
    verifiedSnapshot.rawText,
  ]);

  const sendChatMessage = useCallback(
    async (rawQuestion: string) => {
      const question = rawQuestion.trim();
      if (!question || isGenerating) return;

      const token = ++cancelTokenRef.current;
      const msgId = `chat-${Date.now()}`;
      const snapMeta = buildSnapshotBadge();

      // Requirement 3: Pre-LLM Out-of-Scope Router (`Not modeled`)
      const outOfScopeAnswer = checkOutOfScopeQuery(
        question,
        params,
        telemetry,
        matched,
        unitSystem,
      );

      // Requirement 5: Fast-Path Deterministic Bypass (`Deterministic`)
      const fastPathAnswer =
        outOfScopeAnswer === null
          ? quickRuleMatch(question, params, telemetry, matched, unitSystem, markers)
          : null;

      const useWebGpu =
        outOfScopeAnswer === null &&
        fastPathAnswer === null &&
        Boolean(
          engineInstance &&
            status === 'Offline WebGPU Ready' &&
            hardwareProfile?.tier !== 'constrained',
        );

      const backendLabel =
        outOfScopeAnswer !== null
          ? '1D Scope Guardrail'
          : useWebGpu
            ? `${hardwareProfile?.modelFamily ?? 'Qwen2.5-1.5B'} Local WebGPU`
            : 'Deterministic Telemetry Engine';

      const steps = buildSafetyReasoningSteps(
        params,
        telemetry,
        matched,
        unitSystem,
        'chat',
        markers,
        backendLabel,
      );

      const userMsg: SafetyChatMessage = {
        id: `${msgId}-u`,
        role: 'user',
        content: question,
        source:
          outOfScopeAnswer !== null
            ? 'Not modeled'
            : useWebGpu
              ? 'Local model (numbers audited)'
              : 'Deterministic',
        createdAtMs: Date.now(),
      };
      const nextWithUser = [...messagesRef.current, userMsg];
      messagesRef.current = nextWithUser;
      setMessages(nextWithUser);

      if (outOfScopeAnswer !== null) {
        appendAssistantMessage({
          id: `${msgId}-a`,
          role: 'assistant',
          content: outOfScopeAnswer,
          source: 'Not modeled',
          kind: 'chat',
          promptForRegenerate: question,
          snapshot: snapMeta,
          thoughtSteps: steps,
          thoughtDurationS: 0.1,
        });
        setLastUpdatedLabel('Not modeled');
        return;
      }

      if (fastPathAnswer !== null) {
        appendAssistantMessage({
          id: `${msgId}-a`,
          role: 'assistant',
          content: fastPathAnswer,
          source: 'Deterministic',
          kind: 'chat',
          promptForRegenerate: question,
          snapshot: snapMeta,
          thoughtSteps: steps,
          thoughtDurationS: 0.1,
        });
        setLastUpdatedLabel('Deterministic');
        return;
      }

      const startedAt = performance.now();
      setIsGenerating(true);
      setRegeneratingMessageId(null);
      setActiveThinking({
        id: `${msgId}-think`,
        kind: 'chat',
        activeLabel: useWebGpu ? 'Thinking · Local WebGPU' : 'Analyzing chamber telemetry',
        steps,
        stepIntervalMs: useWebGpu ? 750 : 280,
      });

      try {
        if (useWebGpu && engineInstance) {
          const profile = hardwareProfile ?? (await getHardwareProfile());
          const liveSystemPrompt = buildTieredSystemPrompt(
            params,
            telemetry,
            matched,
            unitSystem,
            profile.systemPromptBudget,
          );
          const recentHistory = messages.slice(-4).map((m) => ({
            role: m.role,
            content: m.content,
          }));
          const auditedText = await runAuditedWebGpuCompletion([
            { role: 'system', content: liveSystemPrompt },
            ...recentHistory,
            { role: 'user', content: question },
          ]);
          if (cancelTokenRef.current !== token) return;
          if (auditedText) {
            const durationS = Math.max(0.1, (performance.now() - startedAt) / 1000);
            appendAssistantMessage({
              id: `${msgId}-a`,
              role: 'assistant',
              content: auditedText,
              source: 'Local model (numbers audited)',
              kind: 'chat',
              promptForRegenerate: question,
              snapshot: snapMeta,
              thoughtSteps: steps,
              thoughtDurationS: durationS,
            });
            setLastUpdatedLabel('Local model (numbers audited)');
            return;
          }
        }

        const completed = await awaitReasoningTrace(token, 1180);
        if (!completed || cancelTokenRef.current !== token) return;
        const durationS = Math.max(0.1, (performance.now() - startedAt) / 1000);
        const fallbackText = buildGroundedChatAnswer(
          question,
          params,
          telemetry,
          matched,
          unitSystem,
          markers,
        );
        appendAssistantMessage({
          id: `${msgId}-a`,
          role: 'assistant',
          content: fallbackText,
          source: 'Deterministic',
          kind: 'chat',
          promptForRegenerate: question,
          snapshot: snapMeta,
          thoughtSteps: steps,
          thoughtDurationS: durationS,
        });
        setLastUpdatedLabel('Deterministic');
      } catch {
        if (cancelTokenRef.current !== token) return;
        const durationS = Math.max(0.1, (performance.now() - startedAt) / 1000);
        const fallbackText = buildGroundedChatAnswer(
          question,
          params,
          telemetry,
          matched,
          unitSystem,
          markers,
        );
        appendAssistantMessage({
          id: `${msgId}-a`,
          role: 'assistant',
          content: fallbackText,
          source: 'Deterministic',
          kind: 'chat',
          promptForRegenerate: question,
          snapshot: snapMeta,
          thoughtSteps: steps,
          thoughtDurationS: durationS,
        });
        setLastUpdatedLabel('Deterministic');
      } finally {
        if (cancelTokenRef.current === token) {
          setActiveThinking(null);
          setIsGenerating(false);
        }
      }
    },
    [
      appendAssistantMessage,
      awaitReasoningTrace,
      buildSnapshotBadge,
      hardwareProfile,
      isGenerating,
      markers,
      matched,
      messages,
      params,
      runAuditedWebGpuCompletion,
      status,
      telemetry,
      unitSystem,
    ],
  );

  const regenerateMessage = useCallback(
    async (assistantMsgId: string) => {
      if (isGenerating) return;
      const target = messages.find((m) => m.id === assistantMsgId && m.role === 'assistant');
      if (!target) return;

      const token = ++cancelTokenRef.current;
      const snapMeta = buildSnapshotBadge();
      const promptText = target.promptForRegenerate || 'Summarize current chamber telemetry';

      const outOfScopeAnswer =
        target.kind === 'diagnostic'
          ? null
          : checkOutOfScopeQuery(promptText, params, telemetry, matched, unitSystem);

      const fastPathAnswer =
        target.kind === 'diagnostic' || outOfScopeAnswer !== null
          ? null
          : quickRuleMatch(promptText, params, telemetry, matched, unitSystem, markers);

      const useWebGpu =
        outOfScopeAnswer === null &&
        fastPathAnswer === null &&
        Boolean(
          engineInstance &&
            status === 'Offline WebGPU Ready' &&
            hardwareProfile?.tier !== 'constrained',
        );

      const backendLabel =
        outOfScopeAnswer !== null
          ? '1D Scope Guardrail'
          : useWebGpu
            ? `${hardwareProfile?.modelFamily ?? 'Qwen2.5-1.5B'} Local WebGPU`
            : 'Deterministic Telemetry Engine';

      const steps = buildSafetyReasoningSteps(
        params,
        telemetry,
        matched,
        unitSystem,
        target.kind ?? 'chat',
        markers,
        backendLabel,
      );
      const startedAt = performance.now();

      setIsGenerating(true);
      setRegeneratingMessageId(assistantMsgId);
      setActiveThinking({
        id: `${assistantMsgId}-regen`,
        kind: target.kind ?? 'chat',
        activeLabel: useWebGpu ? 'Thinking · Local WebGPU' : 'Re-evaluating chamber telemetry',
        steps,
        stepIntervalMs: useWebGpu ? 750 : 280,
      });

      let nextContent = '';
      let nextSource: SafetyMessageSource =
        outOfScopeAnswer !== null ? 'Not modeled' : 'Deterministic';

      if (target.kind === 'diagnostic') {
        nextContent = verifiedSnapshot.rawText;
      } else if (outOfScopeAnswer !== null) {
        nextContent = outOfScopeAnswer;
      } else {
        nextContent =
          fastPathAnswer ??
          buildGroundedChatAnswer(promptText, params, telemetry, matched, unitSystem, markers);
      }

      try {
        if (useWebGpu && engineInstance) {
          const profile = hardwareProfile ?? (await getHardwareProfile());
          const prompt =
            target.kind === 'diagnostic'
              ? buildWebLlmPrompt(params, telemetry, matched, unitSystem)
              : promptText;
          const sys =
            target.kind === 'diagnostic'
              ? `You are an onboard Spacecraft Fire Safety Officer. Provide crisp, technical fire-suppression orders citing the exact NASA PSI run ID. Zero emojis. ${NUMERIC_GUARDRAIL_INSTRUCTION}`
              : buildTieredSystemPrompt(
                  params,
                  telemetry,
                  matched,
                  unitSystem,
                  profile.systemPromptBudget,
                );
          const auditedText = await runAuditedWebGpuCompletion([
            { role: 'system', content: sys },
            { role: 'user', content: prompt },
          ]);
          if (cancelTokenRef.current !== token) return;
          if (auditedText) {
            nextContent = auditedText;
            nextSource = 'Local model (numbers audited)';
          }
        } else if (outOfScopeAnswer === null && fastPathAnswer === null) {
          const completed = await awaitReasoningTrace(token, 1180);
          if (!completed || cancelTokenRef.current !== token) return;
        }
      } catch {
        // Keep verified deterministic snapshot text
      } finally {
        if (cancelTokenRef.current === token) {
          setActiveThinking(null);
          setRegeneratingMessageId(null);
          setIsGenerating(false);
        }
      }

      if (cancelTokenRef.current !== token) return;
      const durationS = Math.max(0.1, (performance.now() - startedAt) / 1000);
      setMessages((prev) => {
        const nextThread = prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: nextContent,
                source: nextSource,
                snapshot: snapMeta,
                thoughtSteps: steps,
                thoughtDurationS: durationS,
                createdAtMs: Date.now(),
              }
            : m,
        );
        messagesRef.current = nextThread;
        const updatedMsg = nextThread.find((m) => m.id === assistantMsgId);
        if (updatedMsg) {
          setSessionArchive((arch) =>
            arch.map((item) =>
              item.id === assistantMsgId
                ? { ...updatedMsg, threadSnapshot: nextThread }
                : item,
            ),
          );
        }
        return nextThread;
      });
    },
    [
      awaitReasoningTrace,
      buildSnapshotBadge,
      hardwareProfile,
      isGenerating,
      markers,
      matched,
      messages,
      params,
      runAuditedWebGpuCompletion,
      status,
      telemetry,
      unitSystem,
      verifiedSnapshot.rawText,
    ],
  );

  const clearMessages = useCallback(() => {
    cancelTokenRef.current += 1;
    clearPendingReasoningTimer();
    setActiveThinking(null);
    setRegeneratingMessageId(null);
    setIsGenerating(false);
    messagesRef.current = [];
    setMessages([]);
  }, [clearPendingReasoningTimer]);

  const clearDiagnosticHistory = useCallback(() => {
    messagesRef.current = [];
    setSessionArchive([]);
    setMessages([]);
  }, []);

  const restoreDiagnosticSession = useCallback((entry: SafetyChatMessage) => {
    if (entry.threadSnapshot && entry.threadSnapshot.length > 0) {
      messagesRef.current = entry.threadSnapshot;
      setMessages(entry.threadSnapshot);
    }
  }, []);

  const tierStatusLabel = useMemo(
    () =>
      formatTierStatusLabel(
        hardwareProfile,
        selectedBackend === 'webgpu' ? (activeModelId ?? hardwareProfile?.modelId ?? null) : null,
      ),
    [activeModelId, hardwareProfile, selectedBackend],
  );

  return {
    selectedBackend,
    webGpuPhase,
    webGpuUnavailableNote,
    status,
    loadProgress,
    loadNote,
    webGpuSupported,
    hardwareProfile,
    activeModelId,
    tierStatusLabel,
    auditPassCount,
    auditFailCount,
    isGenerating,
    activeThinking,
    regeneratingMessageId,
    verifiedSnapshot,
    messages,
    sessionArchive,
    lastUpdatedLabel,
    selectBackend,
    initLocalWeights,
    unloadLocalWeights,
    stopGenerating,
    analyzeSuppressionProtocol,
    sendChatMessage,
    regenerateMessage,
    clearMessages,
    clearDiagnosticHistory,
    restoreDiagnosticSession,
  };
}
