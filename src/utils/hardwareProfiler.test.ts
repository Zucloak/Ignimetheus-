import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyHardwareCapabilities,
  formatTierStatusLabel,
  GB_1,
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

test('classifyHardwareCapabilities classifies balanced and performance tiers with q4f16_1/q4f32_1 and KV window >= 1024/2048', () => {
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
  assert.equal(balancedF16.modelId, 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC');
  assert.equal(balancedF16.contextWindowSize, 1024);
  assert.equal(balancedF16.maxTokens, 220);
  assert.equal(balancedF16.enableWarmup, true);

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

test('parseTierOverrideFromSearch and resolveVerifiedMlcModelId handle URL overrides and prebuiltAppConfig fallback', () => {
  assert.equal(parseTierOverrideFromSearch('?tier=constrained'), 'constrained');
  assert.equal(parseTierOverrideFromSearch('?o2=21&tier=balanced'), 'balanced');
  assert.equal(parseTierOverrideFromSearch('?tier=PERFORMANCE'), 'performance');
  assert.equal(parseTierOverrideFromSearch('?tier=invalid'), null);

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

  // Exact match available
  assert.equal(
    resolveVerifiedMlcModelId(perfProfile, [
      'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
      'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    ]),
    'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
  );

  // Step down to 0.5B when 1.5B is absent from prebuiltAppConfig
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
  assert.equal(formatTierStatusLabel(perfProfile, null), 'Tier: performance · Deterministic');
});
