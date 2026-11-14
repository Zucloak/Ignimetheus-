import test from 'node:test';
import assert from 'node:assert/strict';
import experimentsJson from '../data/nasaPsiExperiments.json';
import {
  auditLlmNumbers,
  buildGroundedChatAnswer,
  buildLiveContextSystemPrompt,
  buildSafetyReasoningSteps,
  buildTieredSystemPrompt,
  buildVerifiedSafetySnapshot,
  checkOutOfScopeQuery,
  NUMERIC_GUARDRAIL_INSTRUCTION,
  quickRuleMatch,
  tokenizeInlineMetricPills,
  trimToLastCompleteSentence,
} from './safetyAdvisor';
import {
  computeThermoTelemetry,
  matchClosestExperiment,
  MISSION_PRESETS,
  resetChamberToStandby,
  stepChamberTransient,
  triggerIgniterPulse,
  type NasaPsiExperiment,
} from './thermoCore';

const experiments = experimentsJson as NasaPsiExperiment[];

test('live context system prompt injects chamber parameters and matched NASA PSI run ID', () => {
  const params = MISSION_PRESETS[1].params; // Orion / Artemis 34% O2
  const telemetry = computeThermoTelemetry(params);
  const matched = matchClosestExperiment(params, experiments);
  const sys = buildLiveContextSystemPrompt(params, telemetry, matched, 'nasa-psi');

  assert.ok(sys.includes('34.0%'));
  assert.ok(sys.includes('56.5 kPa'));
  assert.ok(sys.includes('BASS-II-45'));
  assert.ok(sys.includes('Critical Runaway'));
  assert.ok(sys.includes(NUMERIC_GUARDRAIL_INSTRUCTION));
});

test('grounded chat responder answers quick questions and custom queries with live telemetry', () => {
  const params = MISSION_PRESETS[2].params; // Ventilation Shutdown 0 cm/s
  const telemetry = computeThermoTelemetry(params);
  const matched = matchClosestExperiment(params, experiments);

  const quenchAns = buildGroundedChatAnswer(
    'Why does 0 cm/s quench in 0g?',
    params,
    telemetry,
    matched,
    'nasa-psi',
  );
  assert.ok(quenchAns.includes('FLEX-09'));
  assert.ok(quenchAns.toLowerCase().includes('radiative'));

  const compare1g = buildGroundedChatAnswer(
    'Compare with Earth 1g test',
    params,
    telemetry,
    matched,
    'nasa-psi',
  );
  assert.ok(compare1g.includes('NASA-STD-6001'));
  assert.ok(compare1g.includes('FLEX-09'));

  const suppress = buildGroundedChatAnswer(
    'Recommend suppression steps',
    params,
    telemetry,
    matched,
    'nasa-psi',
  );
  assert.ok(suppress.includes('HVAC:'));
  assert.ok(suppress.includes('SUPPRESSION:'));
});

test('verified safety snapshot reflects STANDBY, IGNITING (80W), and SELF_EXTINGUISHED states', () => {
  const issParams = MISSION_PRESETS[0].params;
  const matchedIss = matchClosestExperiment(issParams, experiments);

  const standbySnap = buildVerifiedSafetySnapshot(
    issParams,
    computeThermoTelemetry(issParams, resetChamberToStandby()),
    matchedIss,
    'nasa-psi',
  );
  assert.equal(standbySnap.hazardLevel, 'NOMINAL');
  assert.ok(standbySnap.summary.includes('STANDBY'));

  const ignitingChamber = stepChamberTransient(triggerIgniterPulse(resetChamberToStandby()), 1.0, issParams);
  const ignSnap = buildVerifiedSafetySnapshot(
    issParams,
    computeThermoTelemetry(issParams, ignitingChamber),
    matchedIss,
    'nasa-psi',
  );
  assert.equal(ignSnap.hazardLevel, 'ELEVATED');
  assert.ok(ignSnap.summary.includes('80 W'));

  const earthParams = MISSION_PRESETS[3].params;
  const matchedEarth = matchClosestExperiment(earthParams, experiments);
  const extChamber = stepChamberTransient(triggerIgniterPulse(resetChamberToStandby()), 3.6, earthParams);
  const extSnap = buildVerifiedSafetySnapshot(
    earthParams,
    computeThermoTelemetry(earthParams, extChamber),
    matchedEarth,
    'nasa-psi',
  );
  assert.equal(extSnap.hazardLevel, 'EXTINGUISHED');
  assert.ok(extSnap.summary.includes('Self-Extinguished (Below Flammability Limit)'));
});

test('grounded chat responder resolves @TC-1..6, @SAFFIRE-II-03, @BASS-II-14, and @FLEX citations', () => {
  const params = MISSION_PRESETS[0].params;
  const telemetry = computeThermoTelemetry(params);
  const matched = matchClosestExperiment(params, experiments);

  const tcAns = buildGroundedChatAnswer('Analyze @TC-1..6 gradient', params, telemetry, matched, 'nasa-psi');
  assert.ok(tcAns.includes('TC-1:'));
  assert.ok(tcAns.includes('TC-6:'));

  const saffireAns = buildGroundedChatAnswer('Cite @SAFFIRE-II-03', params, telemetry, matched, 'nasa-psi');
  assert.ok(saffireAns.includes('SAFFIRE-II-03'));
  assert.ok(saffireAns.includes('Nomex'));

  const bassAns = buildGroundedChatAnswer('Cite @BASS-II-14', params, telemetry, matched, 'nasa-psi');
  assert.ok(bassAns.includes('BASS-II-14'));
  assert.ok(bassAns.includes('1.22 mm/s'));

  const flexAns = buildGroundedChatAnswer('Explain @FLEX', params, telemetry, matched, 'nasa-psi');
  assert.ok(flexAns.includes('FLEX'));
  assert.ok(flexAns.toLowerCase().includes('radiative'));
});

test('tokenizeInlineMetricPills separates prose and monospace metric/citation tokens cleanly', () => {
  const segments = tokenizeInlineMetricPills(
    'Matched BASS-II-14 at 21.0% O2 and 15.0 cm/s (Da=1.42) with @TC-1..6.',
  );
  const pills = segments.filter((s) => s.isMetricPill).map((s) => s.text);
  assert.ok(pills.includes('BASS-II-14'));
  assert.ok(pills.includes('21.0%'));
  assert.ok(pills.includes('15.0 cm/s'));
  assert.ok(pills.includes('Da=1.42'));
  assert.ok(pills.includes('@TC-1..6.'));
});

test('buildSafetyReasoningSteps encodes live telemetry, geometry, hardware, and NASA PSI match', () => {
  const params = {
    ...MISSION_PRESETS[0].params,
    specimenGeometry: 'channel' as const,
    hardware: { wakeBaffle: true, flameArrestor: false, inertNozzle: true },
  };
  const telemetry = computeThermoTelemetry(params);
  const matched = matchClosestExperiment(params, experiments);
  const steps = buildSafetyReasoningSteps(
    params,
    telemetry,
    matched,
    'nasa-psi',
    'diagnostic',
    [{ kind: 'point', id: 'P-1', xMm: 200, yMm: 0 }],
    'Verified Telemetry Engine',
  );

  assert.equal(steps.length, 4);
  assert.ok(steps[0].label.includes('Avionics Channel'));
  assert.ok(steps[1].detail.includes('Wake Baffle'));
  assert.ok(steps[1].detail.includes('N2 Nozzle Armed'));
  assert.ok(steps[2].label.includes(matched.experiment.id));
  assert.ok(steps[3].detail.includes('1 active CAD marker'));
});

test('quickRuleMatch fast-path routes standard telemetry queries and returns null on open-ended prompts', () => {
  const params = MISSION_PRESETS[0].params;
  const telemetry = computeThermoTelemetry(params);
  const matched = matchClosestExperiment(params, experiments);
  const markers = [{ kind: 'point' as const, id: 'P-1', xMm: 210, yMm: 0 }];

  const probeHit = quickRuleMatch('Inspect @P-1 probe', params, telemetry, matched, 'nasa-psi', markers);
  assert.ok(probeHit && probeHit.includes('CAD Sensor Probe P-1'));

  const tcHit = quickRuleMatch('Read @TC-1..6 sensors', params, telemetry, matched, 'nasa-psi', markers);
  assert.ok(tcHit && tcHit.includes('Live Thermocouple Array'));

  const orionHit = quickRuleMatch('Explain Orion / Artemis 34% O2 hazard', params, telemetry, matched, 'nasa-psi');
  assert.ok(orionHit && orionHit.includes('Orion / Artemis Exploration Atmosphere'));

  const mitigationHit = quickRuleMatch('How do N2 suppression and Flame Arrestor mesh work?', params, telemetry, matched, 'nasa-psi');
  assert.ok(mitigationHit && mitigationHit.includes('DUCT MITIGATION:'));

  const openEnded = quickRuleMatch('Synthesize a custom thermal narrative for current test', params, telemetry, matched, 'nasa-psi');
  assert.equal(openEnded, null);
});

test('checkOutOfScopeQuery intercepts unmodeled toxic ppm, evacuation, depressurization, and certification queries', () => {
  const params = MISSION_PRESETS[0].params;
  const telemetry = computeThermoTelemetry(params);
  const matched = matchClosestExperiment(params, experiments);

  const toxicAns = checkOutOfScopeQuery('What is the HCN and CO ppm concentration?', params, telemetry, matched, 'nasa-psi');
  assert.ok(toxicAns && toxicAns.includes('Not modeled in this 1D thermo-fluids solver'));

  const evacAns = checkOutOfScopeQuery('What is the crew evacuation time from the module?', params, telemetry, matched, 'nasa-psi');
  assert.ok(evacAns && evacAns.includes('Not modeled in this 1D thermo-fluids solver'));

  const certAns = checkOutOfScopeQuery('Is this material formally certified for flight?', params, telemetry, matched, 'nasa-psi');
  assert.ok(certAns && certAns.includes('Not modeled in this 1D thermo-fluids solver'));

  const arcAns = checkOutOfScopeQuery('What electrical arc energy in mJ ignited the sample?', params, telemetry, matched, 'nasa-psi');
  assert.ok(arcAns && arcAns.includes('Not modeled in this 1D thermo-fluids solver'));

  const inScopeAns = checkOutOfScopeQuery('Compare 0g vs 1g LOI margin', params, telemetry, matched, 'nasa-psi');
  assert.equal(inScopeAns, null);
});

test('auditLlmNumbers passes exact/rounded telemetry numbers and rejects fabricated numbers', () => {
  const params = MISSION_PRESETS[0].params; // 21.0% O2, 101.3 kPa, 15.0 cm/s, 0.00g
  const telemetry = computeThermoTelemetry(params);
  const matched = matchClosestExperiment(params, experiments);

  const validOutput = `HVAC: Isolate 120 mm duct flow from 15.0 cm/s to 0 cm/s at 21.0% O2 and 101.3 kPa. Spread is 1.82 mm/s vs NASA-STD-6001 152.4 mm criterion (BASS-II-14 baseline 1.22 mm/s over 300 mm coupon).`;
  const passAudit = auditLlmNumbers(validOutput, params, telemetry, matched, 'nasa-psi');
  assert.equal(passAudit.passed, true);
  assert.deepEqual(passAudit.rejectedNumbers, []);

  const hallucinatedOutput = `HVAC: At 19.7% O2 and 84.3 kPa, the flame spreads at 4.65 mm/s across 512 mm.`;
  const failAudit = auditLlmNumbers(hallucinatedOutput, params, telemetry, matched, 'nasa-psi');
  assert.equal(failAudit.passed, false);
  assert.ok(failAudit.rejectedNumbers.includes(19.7));
  assert.ok(failAudit.rejectedNumbers.includes(84.3));
  assert.ok(failAudit.rejectedNumbers.includes(4.65));
});

test('trimToLastCompleteSentence trims truncated LLM output cleanly and buildTieredSystemPrompt includes guardrail', () => {
  assert.equal(
    trimToLastCompleteSentence('Isolate HVAC damper immediately. Reduce O2 below 15.6% LOI. Maintain CO2 standby on'),
    'Isolate HVAC damper immediately. Reduce O2 below 15.6% LOI.',
  );

  const params = MISSION_PRESETS[0].params;
  const telemetry = computeThermoTelemetry(params);
  const matched = matchClosestExperiment(params, experiments);
  for (const budget of ['compact', 'standard', 'full'] as const) {
    const prompt = buildTieredSystemPrompt(params, telemetry, matched, 'nasa-psi', budget);
    assert.ok(prompt.includes(NUMERIC_GUARDRAIL_INSTRUCTION));
  }
});

