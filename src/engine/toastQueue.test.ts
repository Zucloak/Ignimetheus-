import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVerdictToastInput,
  dismissToastById,
  enqueueToast,
  getToastStackTransform,
  stepToastTimers,
  SYSTEM_TOAST_DURATION_MS,
  VERDICT_TOAST_DURATION_MS,
} from './toastQueue';
import { MISSION_PRESETS } from './thermoCore';

test('enqueueToast places newest toast at index 0 with 3.5s system and 6.5s verdict durations', () => {
  let q = enqueueToast(
    [],
    {
      id: 'sys-1',
      kind: 'system',
      title: 'Preset Loaded',
      metadata: 'PMMA · 21.0% O2',
      summary: 'Loaded ISS Nominal preset.',
    },
  );
  assert.equal(q.length, 1);
  assert.equal(q[0].durationMs, SYSTEM_TOAST_DURATION_MS);

  const verdictInput = buildVerdictToastInput(
    {
      outcome: 'PASS',
      reason: 'SELF_EXTINGUISHED',
      headline: 'PASS — Self-Extinguished',
      summary: 'Self-extinguished.',
      elapsedTimeS: 3.5,
      burnLengthMm: 0,
      testDuration: 60,
    },
    MISSION_PRESETS[0].params,
  );
  q = enqueueToast(q, { ...verdictInput, id: 'verdict-1' });
  assert.equal(q.length, 2);
  assert.equal(q[0].id, 'verdict-1');
  assert.equal(q[0].title, 'NASA-STD-6001 · PASS');
  assert.equal(q[0].summary, 'Self-extinguished at 0 mm in 3.5s');
  assert.equal(q[0].durationMs, VERDICT_TOAST_DURATION_MS);
});

test('stepToastTimers pauses when hovered and auto-clears expired toasts when unhovered', () => {
  let q = enqueueToast(
    [],
    {
      id: 'sys-1',
      kind: 'system',
      title: 'Markers Cleared',
      metadata: 'PMMA · 21.0% O2',
      summary: 'Removed all pinned duct probes.',
    },
  );
  const paused = stepToastTimers(q, 2000, true);
  assert.equal(paused[0].remainingMs, SYSTEM_TOAST_DURATION_MS);

  const partial = stepToastTimers(q, 2000, false);
  assert.equal(partial[0].remainingMs, 1500);

  const expired = stepToastTimers(partial, 1600, false);
  assert.equal(expired.length, 0);
});

test('getToastStackTransform returns 3D deck offsets when collapsed and flat 1.0 scale when hovered', () => {
  assert.deepEqual(getToastStackTransform(0, false), {
    translateYPx: 0,
    scale: 1.0,
    opacity: 1.0,
    zIndex: 30,
  });
  assert.deepEqual(getToastStackTransform(1, false), {
    translateYPx: 8,
    scale: 0.95,
    opacity: 0.7,
    zIndex: 20,
  });
  assert.deepEqual(getToastStackTransform(2, false), {
    translateYPx: 16,
    scale: 0.9,
    opacity: 0.4,
    zIndex: 10,
  });

  assert.deepEqual(getToastStackTransform(2, true), {
    translateYPx: 0,
    scale: 1.0,
    opacity: 1.0,
    zIndex: 10,
  });

  const q = enqueueToast(
    [],
    {
      id: 't1',
      kind: 'system',
      title: 'Telemetry Link Copied',
      metadata: 'PMMA · 21.0% O2',
      summary: 'Shareable URL copied.',
    },
  );
  assert.equal(dismissToastById(q, 't1').length, 0);
});
