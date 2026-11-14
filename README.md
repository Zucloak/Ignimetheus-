# Flame in Freefall — Microgravity Combustion & HVAC Digital Twin

Precision aerospace thermo-fluids digital twin for spacecraft microgravity combustion, forced-convection boundary-layer flame spread, and NASA Physical Sciences Informatics (PSI) / NTRS experimental telemetry analysis.

Built as a 100% client-side, offline-first engineering workbench (Vite + React + TypeScript + self-hosted variable typography + air-gapped WebGPU inference with deterministic numeric auditing).

---

## 1. Engineering Scope & Physical Model

In terrestrial ($1g$) environments, natural buoyancy drives upward convective plumes ($\approx 35\text{--}50\text{ cm/s}$) that cool the pyrolysis zone while entraining fresh oxidizer. In microgravity ($0g$), buoyant convection vanishes ($g \to 0$):

1. **Quiescent Radiative Quenching ($U_{\text{flow}} \to 0\text{ cm/s}$ in $0g$)**:
   Oxygen transport relies on molecular diffusion while $\text{CO}_2/\text{H}_2\text{O}$ gas-band and soot radiation continuously drain thermal energy from the reaction zone, elevating the effective Limiting Oxygen Index ($\text{LOI}_{\text{eff}}$) and causing self-extinguishment or spherical blue flamelets.
2. **Low-Velocity Forced-Flow Flammability Dip ($5\text{--}30\text{ cm/s}$ in $0g$)**:
   Spacecraft cabin HVAC ventilation thins the diffusive boundary layer and supplies oxidizer faster than radiative heat loss can quench the pyrolysis front, depressing $\text{LOI}_{\text{eff}}$ below the Earth $1g$ NASA-STD-6001 Test 1 upward screening limit.
3. **High-Flow Convective Blow-Off ($U_{\text{flow}} > 38\text{--}42\text{ cm/s}$)**:
   At high forced velocities, convective residence time $\tau_{\text{flow}}$ drops below the chemical reaction time scale $\tau_{\text{chem}}$, driving the Extinction-Proximity Index ($\text{Da}^*$) below unity and blowing off the flame front.

### Core Governing Correlations (`src/engine/thermoCore.ts`)

- **Effective Buoyant + Forced Velocity**:
  $$U_{\text{buoy}} = 0.35 \sqrt{\frac{g}{9.80665}}, \qquad U_{\text{eff}} = \sqrt{U_{\text{flow}}^2 + U_{\text{buoy}}^2}$$
- **Two-Sided Thin-Sheet Charring Radiative Penalty**:
  Thin-sheet charring/ash-forming fabrics (`nomex`, `silicone` in `sheet` geometry) lose radiant energy from both faces across an intumescent char or silica-ash barrier, adding $+2.20\%$ to $+4.20\%\ \text{O}_2$ to $\text{LOI}_{\text{eff}}$.
- **Duct Confinement Scale (`msg-12cm` vs. `saffire-40cm`)**:
  Models both the $12\text{ cm}$ Microgravity Science Glovebox (`MSG`, $D_h = 0.12\text{ m}$) and the $40\text{ cm}$ Cygnus Saffire flow duct ($D_h = 0.40\text{ m}$, $0.88\times$ wide-duct view-factor spread scaling).
- **Extinction-Proximity Index ($\text{Da}^*$)**:
  Algebraic residence-vs-reaction index anchored directly to the solver's $\text{LOI}$ margin ($\text{Da}^* \ge 1.00$ for sustained propagation; $\text{Da}^* < 1.00$ for quenched or blow-off regimes).

---

## 2. NASA Reference Dataset & Validation Split (`src/data/nasaPsiExperiments.json`)

The reference library includes 6 large-scale Cygnus Saffire records verified against **Urban et al., ASGSR 2017 (NASA NTRS 20180005168, Table 1, pp. 30–31)** alongside adapted `BASS-II`, `FLEX`, and `NASA-STD-6001` reference scenarios:

| Record ID | Split Role | Material (`specimenGeometry`, `ductScale`) | Conditions ($0g$) | Published $V_f$ ($\text{mm/s}$) | Simulated $V_f$ ($\text{mm/s}$) | Relative Error / Match |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: |
| **`SAFFIRE-I-01`** | Calibration ($20\text{ cm/s}$) | `cellulose` (`sheet`, `saffire-40cm`) | $21.6\%\ \text{O}_2,\ 101.3\text{ kPa},\ 20\text{ cm/s}$ concurrent | `1.80` | `1.888` | `+4.9%` |
| **`SAFFIRE-II-05`** | Calibration ($20\text{ cm/s}$) | `cellulose` (`sheet`, `saffire-40cm`) | $22.1\%\ \text{O}_2,\ 101.3\text{ kPa},\ 20\text{ cm/s}$ concurrent | `2.10` | `2.017` | `-3.9%` |
| **`SAFFIRE-II-06`** | Held-Out ($25\text{ cm/s}$) | `cellulose` (`sheet`, `saffire-40cm`) | $22.1\%\ \text{O}_2,\ 101.3\text{ kPa},\ 25\text{ cm/s}$ concurrent | `2.60` | `2.296` | `-11.7%` |
| **`SAFFIRE-III-01`** | Held-Out ($25\text{ cm/s}$) | `cellulose` (`sheet`, `saffire-40cm`) | $21.1\%\ \text{O}_2,\ 101.3\text{ kPa},\ 25\text{ cm/s}$ concurrent | `2.30` | `2.005` | `-12.8%` |
| **`SAFFIRE-II-07`** | Extinction Benchmark | `nomex` (`sheet`, `saffire-40cm`) | $22.1\%\ \text{O}_2,\ 101.3\text{ kPa},\ 20\text{ cm/s}$ concurrent | `0.00` | `0.000` | Exact (`Quenched`) |
| **`SAFFIRE-II-01`** | Extinction Benchmark | `silicone` (`sheet`, `saffire-40cm`) | $22.1\%\ \text{O}_2,\ 101.3\text{ kPa},\ 20\text{ cm/s}$ concurrent | `0.00` | `0.000` | Exact (`Quenched`) |
| **`BASS-II-14`** | MSG Rod Baseline | `pmma` (`rod`, `msg-12cm`) | $21.0\%\ \text{O}_2,\ 101.3\text{ kPa},\ 15\text{ cm/s}$ opposed | `1.22` | `1.824` | `+49.5%` |

- **4-Fold Leave-One-Out (LOO) Cross-Validation**: Across the 4 SIBAL cotton-fiberglass Saffire runs, the held-out relative error spans **`4.46%` to `16.33%`** (Mean Absolute Percentage Error = **`9.03%`**).

---

## 3. Air-Gapped Safety Officer Pipeline & Guardrails

The onboard Fire Safety Officer (`src/hooks/useSafetyOfficerLLM.ts`, `src/engine/safetyAdvisor.ts`, `src/utils/hardwareProfiler.ts`) operates 100% locally with zero cloud API calls:

1. **Device-Adaptive Hardware Tiering (`?tier=constrained|balanced|performance`)**:
   - `constrained` (mobile, compact viewport $\le 430\text{ px}$, $\le 4\text{ GB}$ RAM, storage buffer $< 256\text{ MB}$, or no WebGPU): WebLLM loading is disabled (`allowWebLlm: false`); runs exclusively in zero-latency `Deterministic` mode.
   - `balanced`: `Qwen2.5-0.5B-Instruct` (`q4f16_1` / `q4f32_1`), `context_window_size: 1024`, `max_tokens: 220`.
   - `performance`: `Qwen2.5-1.5B-Instruct` (`q4f16_1` / `q4f32_1`), `context_window_size: 2048`, `max_tokens: 320`.
2. **Pre-LLM Out-of-Scope Router (`Not modeled`)**:
   - Intercepts questions requesting unmodeled quantities (toxic gas/CO/HCN ppm, crew evacuation time, cabin depressurization bleed-down time, formal flight certification, electrical arc energy in mJ, or 3D soot concentration) before invoking `quickRuleMatch` or WebLLM.
3. **Fast-Path Deterministic Bypass (`0 ms / 0 GPU`)**:
   - Resolves standard telemetry queries (`@TC-1..6`, `@P-1..`, `0g vs 1g` envelope comparisons, `N2 suppression` / `Flame Arrestor` mitigations, `Orion / Artemis 34% O2`, `Saffire / BASS-II` citations) instantaneously from live solver state.
4. **Post-LLM Strict Numeric Audit (`Local model (numbers audited)`)**:
   - Extracts every numeric token from WebLLM responses and verifies each value against the live telemetry snapshot (within displayed rounding tolerance plus fixed reference constants `0`, `1`, `300`, `120`, `400`, `6001`, `152.4`). Any hallucinated or altered number discards the LLM output and falls back to the deterministic template.

---

## 4. Architecture & Directory Structure

```text
src/
├── components/           # Precision aerospace workbench UI (Canvas stage, Inspector, Composer)
├── data/
│   └── nasaPsiExperiments.json  # NASA PSI & NTRS 20180005168 reference scenarios
├── engine/
│   ├── thermoCore.ts     # Pure TS 1D thermo-fluids solver & transient state machine (Wasm-ready)
│   ├── units.ts          # Pure unit conversion & formatting (NASA-PSI, SI, Imperial)
│   ├── ductProbes.ts     # Spatial CAD probe & caliper field sampler
│   ├── safetyAdvisor.ts  # Deterministic safety protocol, pre-router, and numeric auditor
│   └── *.test.ts         # Node test runner suites
├── hooks/
│   └── useSafetyOfficerLLM.ts   # Singleton Web Worker WebGPU controller & audit pipeline
├── utils/
│   └── hardwareProfiler.ts      # Session-cached WebGPU/RAM/CPU profiler & tier classifier
└── workers/
    └── webllm.worker.ts         # Dedicated Web Worker for off-main-thread WebLLM inference
```

---

## 5. Development, Testing & Production Build

```bash
# Install dependencies
npm install

# Start local development server on port 3000
npm run dev

# Run all 50 unit tests (thermoCore, units, ductProbes, safetyAdvisor, hardwareProfiler)
npm test

# Type-check with TypeScript
npm run lint

# Build offline-ready production bundle
npm run build
```

---

## 6. License & Data Attribution

- **Source Code**: Licensed under the [Apache License, Version 2.0](./LICENSE).
- **NASA PSI & NTRS Reference Data**: Experimental metadata adapted from NASA Physical Sciences Informatics (`psi.nasa.gov`, `PSI-98` DOI `10.60555/0t15-1z43`, `PSI-99` DOI `10.60555/2chp-m469`, Creative Commons Zero `CC0-1.0`) and Urban et al., ASGSR 2017 (`NASA NTRS 20180005168`).
