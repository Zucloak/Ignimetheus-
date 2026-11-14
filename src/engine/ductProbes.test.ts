import test from 'node:test';
import assert from 'node:assert/strict';
import experimentsJson from '../data/nasaPsiExperiments.json';
import {
  DUCT_HALF_HEIGHT_MM,
  DUCT_LENGTH_MM,
  getInitialCadMarkers,
  measureCaliperMm,
  nextMarkerId,
  sampleDuctFieldAtMm,
  THERMOCOUPLE_ARRAY_SPECS,
  type CadCaliperMarker,
  type CadMarker,
} from './ductProbes';
import { buildGroundedChatAnswer } from './safetyAdvisor';
import {
  AMBIENT_CHAMBER_TEMP_K,
  computeThermoTelemetry,
  matchClosestExperiment,
  MISSION_PRESETS,
  resetChamberToStandby,
  stepChamberTransient,
  triggerIgniterPulse,
  type NasaPsiExperiment,
} from './thermoCore';

const experiments = experimentsJson as NasaPsiExperiment[];

test('sampleDuctFieldAtMm clamps duct bounds and reflects Poiseuille centerline peak velocity', () => {
  const params = MISSION_PRESETS[0].params;
  const standby = computeThermoTelemetry(params, resetChamberToStandby());

  const center = sampleDuctFieldAtMm(216, 0, params, standby);
  const wall = sampleDuctFieldAtMm(216, DUCT_HALF_HEIGHT_MM, params, standby);
  const clamped = sampleDuctFieldAtMm(999, -999, params, standby);

  assert.equal(center.localTempK, AMBIENT_CHAMBER_TEMP_K);
  assert.ok(center.localVelMs > wall.localVelMs);
  assert.equal(clamped.xMm, DUCT_LENGTH_MM);
  assert.equal(clamped.yMm, -DUCT_HALF_HEIGHT_MM);

  // Hot sustained burn raises temperature near flame center
  const burnChamber = stepChamberTransient(triggerIgniterPulse(resetChamberToStandby()), 4.5, params);
  const burnTelemetry = computeThermoTelemetry(params, burnChamber);
  const hotProbe = sampleDuctFieldAtMm(216, 0, params, burnTelemetry);
  assert.ok(hotProbe.localTempK > AMBIENT_CHAMBER_TEMP_K + 100);
});

test('measureCaliperMm and nextMarkerId compute exact Euclidean distance and sequential IDs', () => {
  const cal: CadCaliperMarker = {
    kind: 'caliper',
    id: 'D-1',
    x1Mm: 100,
    y1Mm: 0,
    x2Mm: 130,
    y2Mm: 40,
  };
  const span = measureCaliperMm(cal);
  assert.equal(span.dxMm, 30);
  assert.equal(span.dyMm, 40);
  assert.equal(span.distanceMm, 50);

  const existing: CadMarker[] = [
    ...getInitialCadMarkers(),
    { kind: 'point', id: 'P-3', xMm: 150, yMm: 10 },
    cal,
  ];
  assert.equal(nextMarkerId(existing, 'point'), 'P-4');
  assert.equal(nextMarkerId(existing, 'caliper'), 'D-2');
});

test('buildGroundedChatAnswer resolves @P-1, @D-1, and single @TC-3 telemetry queries', () => {
  const params = MISSION_PRESETS[0].params;
  const telemetry = computeThermoTelemetry(params);
  const matched = matchClosestExperiment(params, experiments);
  const markers: CadMarker[] = [
    ...getInitialCadMarkers(),
    { kind: 'caliper', id: 'D-1', x1Mm: 150, y1Mm: 0, x2Mm: 210, y2Mm: 0 },
  ];

  const pAns = buildGroundedChatAnswer('Inspect @P-1', params, telemetry, matched, 'nasa-psi', markers);
  assert.ok(pAns.includes('CAD Sensor Probe P-1'));
  assert.ok(pAns.includes('X=216.0 mm'));

  const dAns = buildGroundedChatAnswer('Measure @D-1', params, telemetry, matched, 'nasa-psi', markers);
  assert.ok(dAns.includes('CAD Caliper Marker D-1'));
  assert.ok(dAns.includes('Distance=60.0 mm'));

  const tc3Ans = buildGroundedChatAnswer('Check @TC-3 sensor', params, telemetry, matched, 'nasa-psi', markers);
  assert.ok(tc3Ans.includes('Focused sensor TC-3'));
});

test('THERMOCOUPLE_ARRAY_SPECS lists TC-1 through TC-6 in axial order inside duct bounds', () => {
  assert.equal(THERMOCOUPLE_ARRAY_SPECS.length, 6);
  for (let i = 0; i < THERMOCOUPLE_ARRAY_SPECS.length; i++) {
    const tc = THERMOCOUPLE_ARRAY_SPECS[i];
    assert.equal(tc.id, `TC-${i + 1}`);
    assert.ok(tc.axialMm > 0 && tc.axialMm < DUCT_LENGTH_MM);
    if (i > 0) {
      assert.ok(tc.axialMm > THERMOCOUPLE_ARRAY_SPECS[i - 1].axialMm);
    }
  }
});
