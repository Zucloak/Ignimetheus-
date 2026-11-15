<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/assets/ignimetheus_dark.svg" />
    <source media="(prefers-color-scheme: light)" srcset="public/assets/ignimetheus_light.svg" />
    <img src="public/assets/ignimetheus.svg" alt="Ignimetheus — Flame in Freefall" width="180" height="180" />
  </picture>
</p>

# Ignimetheus

### Flame in Freefall — Spacecraft Fire Safety Digital Twin

**Ignimetheus** is a browser-based, reduced-order 1D SI thermo-fluids digital twin for spacecraft microgravity combustion and cabin HVAC fire safety. It pairs a 60 fps HTML5 Canvas flow-duct simulation with live `0g` vs. `1g` flammability envelopes, active and passive suppression hardware modeling, NASA Saffire / BASS-II / FLEX reference matching, and an air-gapped local WebGPU Fire Safety Officer backed by deterministic fallbacks and strict numeric auditing.

---

## 1. Key Capabilities

- **60 fps HTML5 Canvas Duct & Flame Simulation (`src/components/SimulationStage.tsx`)**:
  - Real-time visualization of velocity streamlines, vector fields, thermal heat-flux contours, a 6-point thermocouple array (`TC-1` through `TC-6`), interactive CAD spatial probes (`P-n`) and calipers (`D-n`), and a toggleable `1g` buoyant plume silhouette overlay.
  - Supports `msg-12cm` (`12 cm` Microgravity Science Glovebox duct) and `saffire-40cm` (`40 cm` Cygnus Saffire flow duct) confinement scales across `rod`, `sheet`, `channel`, and `droplet` specimen geometries.
- **Reduced-Order 1D SI Thermo-Fluids Engine (`src/engine/thermoCore.ts`)**:
  - Evaluates effective velocity $U_{\mathrm{eff}} = \sqrt{U_{\mathrm{flow}}^2 + U_{\mathrm{buoy}}^2}$, oxygen-enriched exploration atmospheres (e.g., Orion / Artemis `34% O₂` at `56.5 kPa`), quiescent radiative quenching (`0 cm/s` in `0g`), low-velocity forced-flow flammability dips, high-flow convective blow-off (`Da* < 1.00`), and two-sided thin-sheet radiative quenching for charring/ash-forming fabrics (`nomex`, `silicone`).
- **Live `0g` vs. `1g` Flammability Envelopes**:
  - Tracks pressure- and flow-adjusted effective Limiting Oxygen Index (`LOI_eff`), `LOI` margin, Extinction-Proximity Index (`Da*`), and `NASA-STD-6001` `152 mm` burn-length screening verdicts across `STANDBY`, `IGNITING` (`80 W` hot wire), `SUSTAINED_BURN`, and `SELF_EXTINGUISHED` states.
- **Active & Passive Suppression Modeling**:
  - Models upstream **Wake Baffle** wake stabilization, **Cu-Ni Flame Arrestor Mesh** (`280 mm` clamp up to `32% O₂`, overwhelmed at `34% O₂`), and **Pulse N₂ Suppression** (`-8.0% O₂` inert dilution transient).

---

## 2. NASA Saffire Calibration & Reference Library (`src/data/nasaPsiExperiments.json`)

Six large-scale Cygnus Saffire microgravity concurrent-flow benchmarks are calibrated and evaluated against **Urban et al., ASGSR 2017 (NASA NTRS 20180005168, Table 1, pp. 30–31)** alongside adapted `BASS-II`, `FLEX`, and `NASA-STD-6001` reference scenarios:

| Record ID | Split Role | Material (`specimenGeometry`, `ductScale`) | Conditions (`0g`) | Published `V_f` (`mm/s`) | Simulated `V_f` (`mm/s`) | Relative Error / Match |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: |
| **`SAFFIRE-I-01`** | Calibration (`20 cm/s`) | `cellulose` (`sheet`, `saffire-40cm`) | `21.6% O₂, 101.3 kPa, 20 cm/s` concurrent | `1.80` | `1.888` | `+4.9%` |
| **`SAFFIRE-II-05`** | Calibration (`20 cm/s`) | `cellulose` (`sheet`, `saffire-40cm`) | `22.1% O₂, 101.3 kPa, 20 cm/s` concurrent | `2.10` | `2.017` | `-3.9%` |
| **`SAFFIRE-II-06`** | Held-Out (`25 cm/s`) | `cellulose` (`sheet`, `saffire-40cm`) | `22.1% O₂, 101.3 kPa, 25 cm/s` concurrent | `2.60` | `2.296` | `-11.7%` |
| **`SAFFIRE-III-01`** | Held-Out (`25 cm/s`) | `cellulose` (`sheet`, `saffire-40cm`) | `21.1% O₂, 101.3 kPa, 25 cm/s` concurrent | `2.30` | `2.005` | `-12.8%` |
| **`SAFFIRE-II-07`** | Extinction Benchmark | `nomex` (`sheet`, `saffire-40cm`) | `22.1% O₂, 101.3 kPa, 20 cm/s` concurrent | `0.00` | `0.000` | Exact (`Quenched`) |
| **`SAFFIRE-II-01`** | Extinction Benchmark | `silicone` (`sheet`, `saffire-40cm`) | `22.1% O₂, 101.3 kPa, 20 cm/s` concurrent | `0.00` | `0.000` | Exact (`Quenched`) |
| **`BASS-II-14`** | MSG Rod Baseline | `pmma` (`rod`, `msg-12cm`) | `21.0% O₂, 101.3 kPa, 15 cm/s` opposed | `1.22` | `1.824` | `+49.5%` |

- **4-Fold Leave-One-Out Cross-Validation**: Across the four cotton-fiberglass (SIBAL) Saffire runs, held-out spread-rate error spans `4.46%` to `16.33%` (MAPE = `9.03%`).

---

## 3. Air-Gapped Local WebGPU Safety Officer

The onboard Fire Safety Officer (`src/hooks/useSafetyOfficerLLM.ts`, `src/engine/safetyAdvisor.ts`, `src/utils/hardwareProfiler.ts`, `src/workers/webllm.worker.ts`) runs 100% client-side with zero cloud API calls:

1. **Device-Adaptive Hardware Tiering & URL Overrides**:
   Append `?tier=constrained`, `?tier=balanced`, or `?tier=performance` to the app URL to force a hardware profile regardless of local GPU/RAM probing:
   - `?tier=constrained` (default on mobile, viewport `<= 430 px`, `<= 4 GB` RAM, WebGPU storage buffer `< 256 MB`, or no WebGPU): Disables WebLLM loading (`allowWebLlm: false`) and runs strictly in zero-latency `Deterministic` mode.
   - `?tier=balanced`: Loads `Qwen3-0.6B-q4f16_1-MLC` (with automatic `q4f32_1` fallback when `shader-f16` is unavailable), `context_window_size: 1536`, `max_tokens: 320`, non-greedy Qwen3 sampling (`temperature: 0.6`, `top_p: 0.95`, `top_k: 20`), and isolates `<think>...</think>` reasoning traces into an expandable UI accordion.
   - `?tier=performance`: Loads `Qwen2.5-1.5B-Instruct` (`q4f16_1` / `q4f32_1`), `context_window_size: 2048`, `max_tokens: 320`.
2. **Pre-LLM Out-of-Scope Router (`Not modeled`)**:
   Intercepts queries requesting unmodeled physics (CO/HCN/HCl ppm yields, crew evacuation timelines, cabin depressurization bleed-down durations, formal flight hardware certification, electrical arc energy in mJ, or 3D soot concentration fields) before inference.
3. **Fast-Path Deterministic Bypass (`0 ms / 0 GPU`)**:
   Resolves standard telemetry queries (`@TC-1..6`, `@P-1..`, `0g vs 1g` comparisons, `N2` / `Flame Arrestor` protocols, `Orion / Artemis 34% O2`, `Saffire` / `BASS-II` / `FLEX` citations) directly from live solver state.
4. **Strict Post-LLM Numeric Auditing & Rejection Transparency**:
   Parses the final response excluding `<think>` blocks and verifies every numeric token against the live telemetry snapshot. If a numeric audit fails, Ignimetheus automatically engages the `Deterministic` fallback while preserving any model `<think>` trace marked as unverified/rejected (`Local Reasoning Process failed validation (numerical trace mismatch); fallback engaged.`).

---

## 4. Local Setup & Verification

```bash
# Install dependencies
npm install

# Start the local development server on http://localhost:3000
npm run dev

# Override hardware tier in the browser if desired
# http://localhost:3000/?tier=constrained
# http://localhost:3000/?tier=balanced
# http://localhost:3000/?tier=performance

# Run the unit test suite (thermoCore, units, ductProbes, safetyAdvisor, hardwareProfiler, toastQueue, inferenceBackend)
npm test

# Type-check with TypeScript
npm run lint

# Build offline-ready production bundle (dist/ + PWA service worker)
npm run build
```

---

## 5. License & Data Attribution

- **Source Code**: Licensed under the [Apache License, Version 2.0](./LICENSE).
- **NASA PSI & NTRS Reference Data**: Experimental metadata adapted from NASA Physical Sciences Informatics (`psi.nasa.gov`, `PSI-98` DOI `10.60555/0t15-1z43`, `PSI-99` DOI `10.60555/2chp-m469`, `CC0-1.0`) and Urban et al., ASGSR 2017 (`NASA NTRS 20180005168`).
