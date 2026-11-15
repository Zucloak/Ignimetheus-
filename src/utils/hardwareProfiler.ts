export type HardwareTier = 'constrained' | 'balanced' | 'performance';
export type QuantizationTag = 'q4f16_1' | 'q4f32_1';
export type SystemPromptBudget = 'compact' | 'standard' | 'full';
export type LocalModelFamily =
  | 'Deterministic'
  | 'Qwen3-0.6B'
  | 'Qwen2.5-0.5B-Instruct'
  | 'Qwen2.5-1.5B-Instruct';

export interface HardwareCapabilityInput {
  isMobileOrTouch: boolean;
  isCompactViewport: boolean;
  deviceMemoryGb: number;
  hardwareConcurrency: number;
  hasWebGpu: boolean;
  supportsShaderF16: boolean;
  maxStorageBufferBindingSize: number;
}

export interface HardwareProfile extends HardwareCapabilityInput {
  tier: HardwareTier;
  tierOverride: HardwareTier | null;
  allowWebLlm: boolean;
  quantization: QuantizationTag;
  modelFamily: LocalModelFamily;
  modelId: string | null;
  candidateModelIds: string[];
  contextWindowSize: 1024 | 1536 | 2048;
  maxTokens: 140 | 220 | 320;
  systemPromptBudget: SystemPromptBudget;
  enableWarmup: boolean;
}

export const MB_256 = 256 * 1024 * 1024;
export const GB_1 = 1024 * 1024 * 1024;

let cachedProfile: HardwareProfile | null = null;
let pendingProfilePromise: Promise<HardwareProfile> | null = null;

/**
 * Parses ?tier=constrained|balanced|performance from a URL search string.
 */
export function parseTierOverrideFromSearch(search: string): HardwareTier | null {
  if (!search) return null;
  try {
    const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
    const raw = params.get('tier')?.trim().toLowerCase();
    if (raw === 'constrained' || raw === 'balanced' || raw === 'performance') {
      return raw;
    }
  } catch {
    // Ignore malformed query string
  }
  return null;
}

/**
 * Pure deterministic hardware tier & model configuration classifier.
 * On the `constrained` tier, WebLLM loading is disabled (`allowWebLlm: false`, `modelId: null`)
 * to prevent small-model numeric hallucinations and mobile OOM.
 */
export function classifyHardwareCapabilities(
  input: HardwareCapabilityInput,
  tierOverride: HardwareTier | null = null,
): HardwareProfile {
  const {
    isMobileOrTouch,
    isCompactViewport,
    deviceMemoryGb,
    hardwareConcurrency,
    hasWebGpu,
    supportsShaderF16,
    maxStorageBufferBindingSize,
  } = input;

  const quantization: QuantizationTag = supportsShaderF16 ? 'q4f16_1' : 'q4f32_1';
  const altQuantization: QuantizationTag = supportsShaderF16 ? 'q4f32_1' : 'q4f16_1';

  let detectedTier: HardwareTier;
  const isConstrained =
    isMobileOrTouch ||
    isCompactViewport ||
    deviceMemoryGb <= 4 ||
    !hasWebGpu ||
    maxStorageBufferBindingSize < MB_256;

  if (isConstrained) {
    detectedTier = 'constrained';
  } else if (
    deviceMemoryGb <= 8 ||
    maxStorageBufferBindingSize < GB_1 ||
    hardwareConcurrency <= 4
  ) {
    detectedTier = 'balanced';
  } else {
    detectedTier = 'performance';
  }

  const effectiveTier: HardwareTier = tierOverride ?? detectedTier;

  if (effectiveTier === 'constrained') {
    return {
      ...input,
      tier: 'constrained',
      tierOverride,
      allowWebLlm: false,
      quantization,
      modelFamily: 'Deterministic',
      modelId: null,
      candidateModelIds: [],
      contextWindowSize: 1024,
      maxTokens: 140,
      systemPromptBudget: 'compact',
      enableWarmup: false,
    };
  }

  if (effectiveTier === 'balanced') {
    const primary = `Qwen3-0.6B-${quantization}-MLC`;
    const secondary = `Qwen3-0.6B-${altQuantization}-MLC`;
    const instructPrimary = `Qwen3-0.6B-Instruct-${quantization}-MLC`;
    const instructSecondary = `Qwen3-0.6B-Instruct-${altQuantization}-MLC`;
    const stepDownPrimary = `Qwen2.5-0.5B-Instruct-${quantization}-MLC`;
    const stepDownSecondary = `Qwen2.5-0.5B-Instruct-${altQuantization}-MLC`;
    return {
      ...input,
      tier: 'balanced',
      tierOverride,
      allowWebLlm: hasWebGpu || tierOverride === 'balanced',
      quantization,
      modelFamily: 'Qwen3-0.6B',
      modelId: primary,
      candidateModelIds: [
        primary,
        secondary,
        instructPrimary,
        instructSecondary,
        stepDownPrimary,
        stepDownSecondary,
      ],
      contextWindowSize: 1536,
      maxTokens: 320,
      systemPromptBudget: 'standard',
      enableWarmup: true,
    };
  }

  const perfPrimary = `Qwen2.5-1.5B-Instruct-${quantization}-MLC`;
  const perfSecondary = `Qwen2.5-1.5B-Instruct-${altQuantization}-MLC`;
  const qwen3StepPrimary = `Qwen3-0.6B-${quantization}-MLC`;
  const qwen3StepSecondary = `Qwen3-0.6B-${altQuantization}-MLC`;
  const qwen3InstructPrimary = `Qwen3-0.6B-Instruct-${quantization}-MLC`;
  const qwen3InstructSecondary = `Qwen3-0.6B-Instruct-${altQuantization}-MLC`;
  const stepDownPrimary = `Qwen2.5-0.5B-Instruct-${quantization}-MLC`;
  const stepDownSecondary = `Qwen2.5-0.5B-Instruct-${altQuantization}-MLC`;

  return {
    ...input,
    tier: 'performance',
    tierOverride,
    allowWebLlm: hasWebGpu || tierOverride === 'performance',
    quantization,
    modelFamily: 'Qwen2.5-1.5B-Instruct',
    modelId: perfPrimary,
    candidateModelIds: [
      perfPrimary,
      perfSecondary,
      qwen3StepPrimary,
      qwen3StepSecondary,
      qwen3InstructPrimary,
      qwen3InstructSecondary,
      stepDownPrimary,
      stepDownSecondary,
    ],
    contextWindowSize: 2048,
    maxTokens: 320,
    systemPromptBudget: 'full',
    enableWarmup: true,
  };
}

export interface ModelGenerationParams {
  temperature: number;
  top_p: number;
  top_k?: number;
  max_tokens: number;
  enableThinking: boolean;
}

/**
 * Detects whether the active WebLLM model ID belongs to the Qwen3 reasoning family.
 */
export function isQwen3ModelId(modelId: string | null | undefined): boolean {
  return Boolean(modelId && /^qwen3/i.test(modelId.trim()));
}

/**
 * Returns Qwen-approved non-greedy sampling parameters for Qwen3 reasoning models
 * (temperature 0.6, top_p 0.95, top_k 20, max_tokens >= 320) to prevent repetitive
 * thinking loops, or locked low-temperature sampling for Qwen2.5 Instruct models.
 */
export function getGenerationParamsForModel(
  modelId: string | null | undefined,
  profile?: Pick<HardwareProfile, 'maxTokens'> | null,
): ModelGenerationParams {
  const baseMaxTokens = profile?.maxTokens ?? 320;
  if (isQwen3ModelId(modelId)) {
    return {
      temperature: 0.6,
      top_p: 0.95,
      top_k: 20,
      max_tokens: Math.max(320, baseMaxTokens),
      enableThinking: true,
    };
  }
  return {
    temperature: 0.15,
    top_p: 0.9,
    max_tokens: baseMaxTokens,
    enableThinking: false,
  };
}

/**
 * Validates the profile's candidate model IDs against `@mlc-ai/web-llm`'s
 * `prebuiltAppConfig.model_list`, stepping down automatically or returning `null`
 * (Deterministic fallback) if no matching model ID is registered.
 */
export function resolveVerifiedMlcModelId(
  profile: HardwareProfile,
  availableModelIds: readonly string[],
): string | null {
  if (!profile.allowWebLlm || profile.tier === 'constrained' || profile.candidateModelIds.length === 0) {
    return null;
  }
  const availableSet = new Set(availableModelIds);
  for (const candidate of profile.candidateModelIds) {
    if (availableSet.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Formats a concise status bar label showing active hardware tier and model/engine.
 */
export function formatTierStatusLabel(
  profile: HardwareProfile | null,
  activeModelId: string | null,
): string {
  if (!profile || profile.tier === 'constrained' || !profile.allowWebLlm || !activeModelId) {
    const tierName = profile?.tier ?? 'constrained';
    return `Tier: ${tierName} · Deterministic`;
  }
  const shortModel = activeModelId.replace(/-MLC$/i, '');
  return `Tier: ${profile.tier} · ${shortModel}`;
}

/**
 * Probes device capabilities once per session (respecting ?tier= URL override)
 * and caches the resulting HardwareProfile.
 */
export async function getHardwareProfile(forceRefresh = false): Promise<HardwareProfile> {
  if (!forceRefresh && cachedProfile) {
    return cachedProfile;
  }
  if (!forceRefresh && pendingProfilePromise) {
    return pendingProfilePromise;
  }

  pendingProfilePromise = (async (): Promise<HardwareProfile> => {
    const hasWindow = typeof window !== 'undefined';
    const hasNavigator = typeof navigator !== 'undefined';

    const tierOverride = hasWindow
      ? parseTierOverrideFromSearch(window.location.search)
      : null;

    const ua = hasNavigator ? navigator.userAgent || '' : '';
    const coarsePointer =
      hasWindow && typeof window.matchMedia === 'function'
        ? window.matchMedia('(pointer: coarse)').matches
        : false;
    const touchPoints = hasNavigator ? navigator.maxTouchPoints ?? 0 : 0;
    const isMobileOrTouch =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua) ||
      (touchPoints > 1 && coarsePointer);

    const isCompactViewport = hasWindow ? window.innerWidth <= 430 : false;

    const rawMem =
      hasNavigator && 'deviceMemory' in navigator
        ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory)
        : NaN;
    const deviceMemoryGb = Number.isFinite(rawMem) && rawMem > 0 ? rawMem : 8;

    const rawCores = hasNavigator ? Number(navigator.hardwareConcurrency) : NaN;
    const hardwareConcurrency = Number.isFinite(rawCores) && rawCores > 0 ? rawCores : 4;

    let hasWebGpu = false;
    let supportsShaderF16 = false;
    let maxStorageBufferBindingSize = 0;

    const navGpu =
      hasNavigator && 'gpu' in navigator
        ? (navigator as Navigator & {
            gpu?: {
              requestAdapter?: () => Promise<{
                limits?: { maxStorageBufferBindingSize?: number };
                features?: { has?: (name: string) => boolean };
              } | null>;
            };
          }).gpu
        : undefined;

    if (navGpu && typeof navGpu.requestAdapter === 'function') {
      try {
        const adapter = await navGpu.requestAdapter();
        if (adapter) {
          hasWebGpu = true;
          maxStorageBufferBindingSize = Number(
            adapter.limits?.maxStorageBufferBindingSize ?? MB_256,
          );
          supportsShaderF16 = Boolean(adapter.features?.has?.('shader-f16'));
        }
      } catch {
        hasWebGpu = false;
      }
    }

    const profile = classifyHardwareCapabilities(
      {
        isMobileOrTouch,
        isCompactViewport,
        deviceMemoryGb,
        hardwareConcurrency,
        hasWebGpu,
        supportsShaderF16,
        maxStorageBufferBindingSize,
      },
      tierOverride,
    );

    cachedProfile = profile;
    return profile;
  })();

  try {
    return await pendingProfilePromise;
  } finally {
    pendingProfilePromise = null;
  }
}

export function getCachedHardwareProfile(): HardwareProfile | null {
  return cachedProfile;
}

export function clearHardwareProfileCacheForTests(): void {
  cachedProfile = null;
  pendingProfilePromise = null;
}
