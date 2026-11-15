import test from 'node:test';
import assert from 'node:assert/strict';
import { prebuiltAppConfig } from '@mlc-ai/web-llm';
import {
  classifyHardwareCapabilities,
  formatTierStatusLabel,
  GB_1,
  getGenerationParamsForModel,
  isQwen3ModelId,
  MB_256,
  parseTierOverrideFromSearch,
  resolveVerifiedMlcModelId,
} from './hardwareProfiler';

test('classifyHardwareCapabilities locks constrained devices to Deterministic mode (allowWebLlm: false)', () => {
  const mobileProfile = classifyHardwareCapabilities({
    isMobileOrTouch: true,
    isCompactViewport: true,
    deviceMemoryGb: 8,
    hardwareConcurrency: 8,
    hasWebGpu: true,
    supportsShaderF16: true,
    maxStorageBufferBindingSize: GB_1 * 2,
  });
  assert.equal(mobileProfile.tier, 'constrained');
  assert.equal(mobileProfile.allowWebLlm, false);
  assert.equal(mobileProfile.modelFamily, 'Deterministic');
  assert.equal(mobileProfile.modelId, null);
  assert.equal(mobileProfile.enableWarmup, false);

  const lowRamProfile = classifyHardwareCapabilities({
    isMobileOrTouch: false,
    isCompactViewport: false,
    deviceMemoryGb: 4,
    hardwareConcurrency: 8,
    hasWebGpu: true,
    supportsShaderF16: true,
    maxStorageBufferBindingSize: GB_1,
  });
  assert.equal(lowRamProfile.tier, 'constrained');
  assert.equal(lowRamProfile.allowWebLlm, false);

  const smallBufferProfile = classifyHardwareCapabilities({
    isMobileOrTouch: false,
    isCompactViewport: false,
    deviceMemoryGb: 16,
    hardwareConcurrency: 8,
    hasWebGpu: true,
    supportsShaderF16: true,
    maxStorageBufferBindingSize: MB_256 - 1024,
  });
  assert.equal(smallBufferProfile.tier, 'constrained');
  assert.equal(smallBufferProfile.allowWebLlm, false);
});

test('classifyHardwareCapabilities classifies balanced tier to Qwen3-0.6B (KV 1536, maxTokens 320) and performance tier to Qwen2.5-1.5B', () => {
  const balancedF16 = classifyHardwareCapabilities({
    isMobileOrTouch: false,
    isCompactViewport: false,
    deviceMemoryGb: 8,
    hardwareConcurrency: 8,
    hasWebGpu: true,
    supportsShaderF16: true,
    maxStorageBufferBindingSize: GB_1 * 2,
  });
  assert.equal(balancedF16.tier, 'balanced');
  assert.equal(balancedF16.allowWebLlm, true);
  assert.equal(balancedF16.modelFamily, 'Qwen3-0.6B');
  assert.equal(balancedF16.modelId, 'Qwen3-0.6B-q4f16_1-MLC');
  assert.ok(balancedF16.candidateModelIds.includes('Qwen3-0.6B-q4f32_1-MLC'));
  assert.equal(balancedF16.contextWindowSize, 1536);
  assert.equal(balancedF16.maxTokens, 320);
  assert.equal(balancedF16.enableWarmup, true);

  const balancedF32 = classifyHardwareCapabilities({
    isMobileOrTouch: false,
    isCompactViewport: false,
    deviceMemoryGb: 8,
    hardwareConcurrency: 4,
    hasWebGpu: true,
    supportsShaderF16: false,
    maxStorageBufferBindingSize: GB_1 * 2,
  });
  assert.equal(balancedF32.tier, 'balanced');
  assert.equal(balancedF32.modelId, 'Qwen3-0.6B-q4f32_1-MLC');
  assert.equal(balancedF32.contextWindowSize, 1536);
  assert.equal(balancedF32.maxTokens, 320);

  const perfF32 = classifyHardwareCapabilities({
    isMobileOrTouch: false,
    isCompactViewport: false,
    deviceMemoryGb: 16,
    hardwareConcurrency: 12,
    hasWebGpu: true,
    supportsShaderF16: false,
    maxStorageBufferBindingSize: GB_1 * 2,
  });
  assert.equal(perfF32.tier, 'performance');
  assert.equal(perfF32.allowWebLlm, true);
  assert.equal(perfF32.modelId, 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC');
  assert.equal(perfF32.contextWindowSize, 2048);
  assert.equal(perfF32.maxTokens, 320);
  assert.equal(perfF32.enableWarmup, true);
});

test('parseTierOverrideFromSearch, resolveVerifiedMlcModelId, and getGenerationParamsForModel handle prebuiltAppConfig & Qwen3 sampling', () => {
  assert.equal(parseTierOverrideFromSearch('?tier=constrained'), 'constrained');
  assert.equal(parseTierOverrideFromSearch('?o2=21&tier=balanced'), 'balanced');
  assert.equal(parseTierOverrideFromSearch('?tier=PERFORMANCE'), 'performance');
  assert.equal(parseTierOverrideFromSearch('?tier=invalid'), null);

  const installedIds = prebuiltAppConfig.model_list.map((m) => m.model_id);
  const balancedProfile = classifyHardwareCapabilities({
    isMobileOrTouch: false,
    isCompactViewport: false,
    deviceMemoryGb: 8,
    hardwareConcurrency: 8,
    hasWebGpu: true,
    supportsShaderF16: true,
    maxStorageBufferBindingSize: GB_1 * 2,
  });
  assert.equal(
    resolveVerifiedMlcModelId(balancedProfile, installedIds),
    'Qwen3-0.6B-q4f16_1-MLC',
  );
  // Falls back to q4f32_1 when q4f16_1 is absent
  assert.equal(
    resolveVerifiedMlcModelId(balancedProfile, ['Qwen3-0.6B-q4f32_1-MLC']),
    'Qwen3-0.6B-q4f32_1-MLC',
  );

  const perfProfile = classifyHardwareCapabilities(
    {
      isMobileOrTouch: false,
      isCompactViewport: false,
      deviceMemoryGb: 16,
      hardwareConcurrency: 12,
      hasWebGpu: true,
      supportsShaderF16: true,
      maxStorageBufferBindingSize: GB_1 * 2,
    },
    null,
  );

  assert.equal(
    resolveVerifiedMlcModelId(perfProfile, installedIds),
    'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
  );

  // Step down to Qwen3-0.6B or Qwen2.5-0.5B when 1.5B is absent
  assert.equal(
    resolveVerifiedMlcModelId(perfProfile, ['Qwen2.5-0.5B-Instruct-q4f16_1-MLC']),
    'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
  );

  // Fall back to null (Deterministic) when no candidate is registered
  assert.equal(resolveVerifiedMlcModelId(perfProfile, ['Llama-3-8B-Instruct']), null);

  assert.equal(
    formatTierStatusLabel(perfProfile, 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC'),
    'Tier: performance · Qwen2.5-1.5B-Instruct-q4f16_1',
  );
  assert.equal(
    formatTierStatusLabel(balancedProfile, 'Qwen3-0.6B-q4f16_1-MLC'),
    'Tier: balanced · Qwen3-0.6B-q4f16_1',
  );
  assert.equal(formatTierStatusLabel(perfProfile, null), 'Tier: performance · Deterministic');

  assert.equal(isQwen3ModelId('Qwen3-0.6B-q4f16_1-MLC'), true);
  assert.equal(isQwen3ModelId('Qwen2.5-1.5B-Instruct-q4f16_1-MLC'), false);

  const qwen3Gen = getGenerationParamsForModel('Qwen3-0.6B-q4f16_1-MLC', balancedProfile);
  assert.deepEqual(qwen3Gen, {
    temperature: 0.6,
    top_p: 0.95,
    top_k: 20,
    max_tokens: 320,
    enableThinking: true,
  });

  const qwen25Gen = getGenerationParamsForModel('Qwen2.5-1.5B-Instruct-q4f16_1-MLC', perfProfile);
  assert.deepEqual(qwen25Gen, {
    temperature: 0.15,
    top_p: 0.9,
    max_tokens: 320,
    enableThinking: false,
  });
});
