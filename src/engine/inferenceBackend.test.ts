import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatComposerBackendStatus,
  getSelectedEngineLabel,
  isWorkerSandboxError,
  WEBGPU_IFRAME_DISABLED_NOTE,
} from './inferenceBackend';

test('getSelectedEngineLabel reflects active backend choice immediately', () => {
  assert.equal(getSelectedEngineLabel('verified'), 'Verified Telemetry Engine');
  assert.equal(getSelectedEngineLabel('webgpu'), 'Qwen2.5-1.5B Local WebGPU');
});

test('formatComposerBackendStatus shows download/compile progress and ready state for webgpu', () => {
  assert.deepEqual(formatComposerBackendStatus('verified', 'idle', 0), {
    label: 'Telemetry Grounded',
    dotColor: 'zinc',
  });
  assert.deepEqual(formatComposerBackendStatus('webgpu', 'loading', 48.4), {
    label: 'Loading Qwen2.5-1.5B · 48%',
    dotColor: 'amber',
  });
  assert.deepEqual(formatComposerBackendStatus('webgpu', 'ready', 100), {
    label: 'WebGPU Ready',
    dotColor: 'cyan',
  });
  assert.deepEqual(formatComposerBackendStatus('webgpu', 'unavailable', 0), {
    label: 'Telemetry Grounded',
    dotColor: 'amber',
  });
});

test('isWorkerSandboxError detects SecurityError and sandboxed iframe worker failures', () => {
  const secErr = new Error("Failed to construct 'Worker': Script at '...' cannot be accessed from origin 'null'.");
  secErr.name = 'SecurityError';
  assert.equal(isWorkerSandboxError(secErr), true);

  assert.equal(isWorkerSandboxError(new Error('Worker blocked by sandbox policy')), true);
  assert.equal(isWorkerSandboxError(new Error('Network offline')), false);
  assert.ok(WEBGPU_IFRAME_DISABLED_NOTE.includes('Chrome/Edge desktop'));
});
