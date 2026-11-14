import test from 'node:test';
import assert from 'node:assert/strict';
import {
  celsiusToKelvin,
  clampDurationSeconds,
  clampGravityG,
  cmsToMs,
  fahrenheitToKelvin,
  formatGravity,
  formatHeatFlux,
  formatPower,
  formatPressure,
  formatTemperature,
  formatVelocity,
  fpmToMs,
  gravityFromDisplay,
  kelvinToCelsius,
  kelvinToFahrenheit,
  kpaToPa,
  msToCms,
  msToFpm,
  paToAtm,
  paToKpa,
  paToPsi,
  pressureFromDisplay,
  psiToPa,
  STANDARD_ATM_PA,
  STANDARD_GRAVITY_MS2,
  velocityFromDisplay,
} from './units';

test('pressure conversions round-trip accurately from base SI Pa', () => {
  const pa = STANDARD_ATM_PA;
  assert.ok(Math.abs(paToKpa(pa) - 101.325) < 1e-6);
  assert.ok(Math.abs(kpaToPa(paToKpa(pa)) - pa) < 1e-6);
  assert.ok(Math.abs(paToPsi(pa) - 14.6959) < 1e-3);
  assert.ok(Math.abs(psiToPa(paToPsi(pa)) - pa) < 1e-4);
  assert.ok(Math.abs(paToAtm(pa) - 1.0) < 1e-6);

  const usFormatted = formatPressure(56537, 'hvac-us');
  assert.equal(usFormatted.unit, 'psi');
  assert.ok(Math.abs(usFormatted.value - 8.2) < 0.02);
  assert.ok(Math.abs(pressureFromDisplay(8.2, 'hvac-us') - 56537) < 20);
});

test('velocity conversions convert m/s <-> cm/s <-> ft/min without drift', () => {
  const ms = 0.15;
  assert.ok(Math.abs(msToCms(ms) - 15.0) < 1e-9);
  assert.ok(Math.abs(cmsToMs(15.0) - ms) < 1e-9);
  assert.ok(Math.abs(msToFpm(ms) - 29.527559) < 1e-4);
  assert.ok(Math.abs(fpmToMs(msToFpm(ms)) - ms) < 1e-9);

  assert.equal(formatVelocity(0.2, 'nasa-psi').unit, 'cm/s');
  assert.equal(formatVelocity(0.2, 'si-thermo').unit, 'm/s');
  assert.equal(formatVelocity(0.2, 'hvac-us').unit, 'ft/min');
  assert.ok(Math.abs(velocityFromDisplay(20, 'nasa-psi') - 0.2) < 1e-9);
});

test('temperature, heat flux, power, and gravity format cleanly across all 3 modes', () => {
  const k = 1273.15;
  assert.ok(Math.abs(kelvinToCelsius(k) - 1000) < 1e-6);
  assert.ok(Math.abs(celsiusToKelvin(1000) - k) < 1e-6);
  assert.ok(Math.abs(kelvinToFahrenheit(273.15) - 32) < 1e-6);
  assert.ok(Math.abs(fahrenheitToKelvin(212) - 373.15) < 1e-6);

  assert.equal(formatTemperature(k, 'nasa-psi').unit, '°C');
  assert.equal(formatTemperature(k, 'si-thermo').unit, 'K');
  assert.equal(formatTemperature(k, 'hvac-us').unit, '°F');

  assert.equal(formatHeatFlux(25000, 'nasa-psi').text, '2.50');
  assert.equal(formatHeatFlux(25000, 'nasa-psi').unit, 'W/cm²');
  assert.equal(formatHeatFlux(25000, 'si-thermo').unit, 'kW/m²');
  assert.equal(formatHeatFlux(25000, 'hvac-us').unit, 'BTU/hr·ft²');

  assert.equal(formatPower(45, 'nasa-psi').unit, 'W');
  assert.equal(formatPower(45, 'hvac-us').unit, 'BTU/hr');

  assert.equal(formatGravity(0, 'nasa-psi').unit, 'μg');
  assert.equal(formatGravity(0, 'si-thermo').unit, 'm/s²');
  assert.equal(formatGravity(STANDARD_GRAVITY_MS2, 'hvac-us').text, '1.000');
});

test('custom gravity (0..2.000 g) and custom duration (2..600 s) clamp and convert cleanly', () => {
  assert.equal(clampGravityG(-0.5), 0);
  assert.equal(clampGravityG(1.65), 1.65);
  assert.equal(clampGravityG(3.5), 2.0);

  assert.ok(Math.abs(gravityFromDisplay(1.5, 'nasa-psi') - 1.5 * STANDARD_GRAVITY_MS2) < 1e-6);
  assert.ok(Math.abs(gravityFromDisplay(14.71, 'si-thermo') - 14.71) < 1e-6);
  assert.ok(Math.abs(gravityFromDisplay(50, 'si-thermo') - 2.0 * STANDARD_GRAVITY_MS2) < 1e-6);

  assert.equal(clampDurationSeconds(0.5), 2);
  assert.equal(clampDurationSeconds(2.24), 2.2);
  assert.equal(clampDurationSeconds(22), 22);
  assert.equal(clampDurationSeconds(999), 600);
});

