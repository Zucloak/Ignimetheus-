export type UnitSystem = 'nasa-psi' | 'si-thermo' | 'hvac-us';

export interface UnitSystemMeta {
  id: UnitSystem;
  label: string;
  shortLabel: string;
}

export const UNIT_SYSTEMS: UnitSystemMeta[] = [
  { id: 'nasa-psi', label: 'NASA PSI Lab', shortLabel: 'NASA PSI' },
  { id: 'si-thermo', label: 'SI Thermo', shortLabel: 'SI Thermo' },
  { id: 'hvac-us', label: 'HVAC / Aerospace US', shortLabel: 'HVAC US' },
];

export const STANDARD_GRAVITY_MS2 = 9.80665;
export const STANDARD_ATM_PA = 101325;
export const PA_PER_PSI = 6894.757293168361;
export const MS_PER_FPM = 0.3048 / 60; // 0.00508 m/s
export const MS_PER_IN_MIN = 0.0254 / 60;
export const W_PER_BTU_HR = 0.2930710701722222;
export const WM2_PER_BTU_HR_FT2 = 3.154590745063;

export interface FormattedValue {
  value: number;
  text: string;
  unit: string;
}

// Pressure conversions (Base SI: Pa)
export function paToKpa(pa: number): number {
  return pa / 1000;
}

export function kpaToPa(kpa: number): number {
  return kpa * 1000;
}

export function paToPsi(pa: number): number {
  return pa / PA_PER_PSI;
}

export function psiToPa(psi: number): number {
  return psi * PA_PER_PSI;
}

export function paToAtm(pa: number): number {
  return pa / STANDARD_ATM_PA;
}

export function formatPressure(pa: number, system: UnitSystem): FormattedValue {
  if (system === 'hvac-us') {
    const val = paToPsi(pa);
    return { value: val, text: val.toFixed(2), unit: 'psi' };
  }
  if (system === 'si-thermo') {
    if (pa >= 1000) {
      const kpa = paToKpa(pa);
      return { value: kpa, text: kpa.toFixed(1), unit: 'kPa' };
    }
    return { value: pa, text: pa.toFixed(0), unit: 'Pa' };
  }
  // nasa-psi
  const kpa = paToKpa(pa);
  return { value: kpa, text: kpa.toFixed(1), unit: 'kPa' };
}

export function pressureFromDisplay(displayVal: number, system: UnitSystem): number {
  if (system === 'hvac-us') return psiToPa(displayVal);
  return kpaToPa(displayVal);
}

// Velocity conversions (Base SI: m/s)
export function msToCms(ms: number): number {
  return ms * 100;
}

export function cmsToMs(cms: number): number {
  return cms / 100;
}

export function msToFpm(ms: number): number {
  return ms / MS_PER_FPM;
}

export function fpmToMs(fpm: number): number {
  return fpm * MS_PER_FPM;
}

export function formatVelocity(ms: number, system: UnitSystem): FormattedValue {
  if (system === 'nasa-psi') {
    const cms = msToCms(ms);
    return { value: cms, text: cms.toFixed(1), unit: 'cm/s' };
  }
  if (system === 'hvac-us') {
    const fpm = msToFpm(ms);
    return { value: fpm, text: fpm.toFixed(1), unit: 'ft/min' };
  }
  return { value: ms, text: ms.toFixed(3), unit: 'm/s' };
}

export function velocityFromDisplay(displayVal: number, system: UnitSystem): number {
  if (system === 'nasa-psi') return cmsToMs(displayVal);
  if (system === 'hvac-us') return fpmToMs(displayVal);
  return displayVal;
}

// Flame Spread Rate conversions (Base SI: m/s)
export function formatSpreadRate(ms: number, system: UnitSystem): FormattedValue {
  if (system === 'nasa-psi') {
    const mms = ms * 1000;
    return { value: mms, text: mms.toFixed(2), unit: 'mm/s' };
  }
  if (system === 'hvac-us') {
    const inMin = ms / MS_PER_IN_MIN;
    return { value: inMin, text: inMin.toFixed(2), unit: 'in/min' };
  }
  const mms = ms * 1000;
  if (ms >= 0.01) {
    return { value: ms, text: ms.toFixed(4), unit: 'm/s' };
  }
  return { value: mms, text: mms.toFixed(2), unit: 'mm/s' };
}

// Temperature conversions (Base SI: K)
export function kelvinToCelsius(k: number): number {
  return k - 273.15;
}

export function celsiusToKelvin(c: number): number {
  return c + 273.15;
}

export function kelvinToFahrenheit(k: number): number {
  return (k - 273.15) * (9 / 5) + 32;
}

export function fahrenheitToKelvin(f: number): number {
  return (f - 32) * (5 / 9) + 273.15;
}

export function formatTemperature(k: number, system: UnitSystem): FormattedValue {
  if (system === 'si-thermo') {
    return { value: k, text: k.toFixed(0), unit: 'K' };
  }
  if (system === 'hvac-us') {
    const f = kelvinToFahrenheit(k);
    return { value: f, text: f.toFixed(0), unit: '°F' };
  }
  const c = kelvinToCelsius(k);
  return { value: c, text: c.toFixed(0), unit: '°C' };
}

// Heat Flux conversions (Base SI: W/m^2)
export function wm2ToWcm2(wm2: number): number {
  return wm2 / 10000;
}

export function wm2ToBtuHrFt2(wm2: number): number {
  return wm2 / WM2_PER_BTU_HR_FT2;
}

export function formatHeatFlux(wm2: number, system: UnitSystem): FormattedValue {
  if (system === 'nasa-psi') {
    const wcm2 = wm2ToWcm2(wm2);
    return { value: wcm2, text: wcm2.toFixed(2), unit: 'W/cm²' };
  }
  if (system === 'hvac-us') {
    const btu = wm2ToBtuHrFt2(wm2);
    return { value: btu, text: btu.toFixed(0), unit: 'BTU/hr·ft²' };
  }
  if (wm2 >= 1000) {
    const kwm2 = wm2 / 1000;
    return { value: kwm2, text: kwm2.toFixed(2), unit: 'kW/m²' };
  }
  return { value: wm2, text: wm2.toFixed(0), unit: 'W/m²' };
}

// Power conversions (Base SI: W)
export function wattsToBtuHr(w: number): number {
  return w / W_PER_BTU_HR;
}

export function formatPower(w: number, system: UnitSystem): FormattedValue {
  if (system === 'hvac-us') {
    const btu = wattsToBtuHr(w);
    return { value: btu, text: btu.toFixed(0), unit: 'BTU/hr' };
  }
  return { value: w, text: w.toFixed(1), unit: 'W' };
}

// Length conversions (Base SI: m)
export function formatLength(m: number, system: UnitSystem): FormattedValue {
  if (system === 'hvac-us') {
    const inches = m / 0.0254;
    return { value: inches, text: inches.toFixed(2), unit: 'in' };
  }
  if (system === 'si-thermo') {
    const mm = m * 1000;
    return { value: mm, text: mm.toFixed(1), unit: 'mm' };
  }
  const cm = m * 100;
  return { value: cm, text: cm.toFixed(1), unit: 'cm' };
}

// Gravity conversions (Base SI: m/s^2)
export function ms2ToG(ms2: number): number {
  return ms2 / STANDARD_GRAVITY_MS2;
}

export function gToMs2(g: number): number {
  return g * STANDARD_GRAVITY_MS2;
}

export function formatGravity(ms2: number, system: UnitSystem): FormattedValue {
  const gVal = ms2ToG(ms2);
  if (system === 'si-thermo') {
    return { value: ms2, text: ms2.toFixed(3), unit: 'm/s²' };
  }
  if (system === 'nasa-psi') {
    if (gVal < 0.001) {
      // Nominal orbital microgravity environment (~1 micro-g residual)
      const microG = Math.max(1.0, gVal * 1_000_000);
      return { value: microG, text: microG.toFixed(1), unit: 'μg' };
    }
    return { value: gVal, text: gVal.toFixed(3), unit: 'g' };
  }
  return { value: gVal, text: gVal.toFixed(3), unit: 'g' };
}

export const MAX_GRAVITY_G = 2.0;
export const MIN_CUSTOM_DURATION_S = 2;
export const MAX_CUSTOM_DURATION_S = 600;

export function clampGravityG(g: number): number {
  if (!Number.isFinite(g)) return 0;
  return Math.max(0, Math.min(MAX_GRAVITY_G, g));
}

export function gravityFromDisplay(displayVal: number, system: UnitSystem): number {
  if (!Number.isFinite(displayVal)) return 0;
  const maxMs2 = MAX_GRAVITY_G * STANDARD_GRAVITY_MS2;
  if (system === 'si-thermo') {
    return Math.max(0, Math.min(maxMs2, displayVal));
  }
  return Math.max(0, Math.min(maxMs2, gToMs2(displayVal)));
}

export function clampDurationSeconds(sec: number): number {
  if (!Number.isFinite(sec)) return 60;
  const clamped = Math.max(MIN_CUSTOM_DURATION_S, Math.min(MAX_CUSTOM_DURATION_S, sec));
  return Math.round(clamped * 10) / 10;
}

