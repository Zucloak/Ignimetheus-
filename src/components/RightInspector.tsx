import React, { useMemo, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
} from '@hugeicons/core-free-icons';
import {
  measureCaliperMm,
  sampleDuctFieldAtMm,
  THERMOCOUPLE_ARRAY_SPECS,
  type CadMarker,
} from '../engine/ductProbes';
import {
  AMBIENT_CHAMBER_TEMP_K,
  computeThermoTelemetry,
  DUCT_SCALES,
  MATERIALS,
  resolveDuctScale,
  type MatchedExperimentResult,
  type NasaPsiExperiment,
  type SimulationParams,
  type ThermoTelemetry,
} from '../engine/thermoCore';
import {
  formatHeatFlux,
  formatLength,
  formatPressure,
  formatSpreadRate,
  formatTemperature,
  formatVelocity,
  type UnitSystem,
} from '../engine/units';

interface RightInspectorProps {
  params: SimulationParams;
  telemetry: ThermoTelemetry;
  matched: MatchedExperimentResult;
  unitSystem: UnitSystem;
  markers: CadMarker[];
  pendingCaliperStart: { xMm: number; yMm: number } | null;
  desktopOpen: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onLoadExperiment: (exp: NasaPsiExperiment) => void;
  onPinCenterlineProbe: () => void;
  onRemoveMarker: (id: string) => void;
  onClearMarkers: () => void;
  onCiteMarkerInChat: (id: string) => void;
}

function getTcDotColor(tempK: number): string {
  if (tempK > 700) return 'bg-rose-300';
  if (tempK > 420) return 'bg-amber-300';
  return 'bg-cyan-300';
}

export const RightInspector: React.FC<RightInspectorProps> = ({
  params,
  telemetry,
  matched,
  unitSystem,
  markers,
  pendingCaliperStart,
  desktopOpen,
  mobileOpen,
  onCloseMobile,
  onLoadExperiment,
  onPinCenterlineProbe,
  onRemoveMarker,
  onClearMarkers,
  onCiteMarkerInChat,
}) => {
  // 4 top-level telemetry accordions (zero parameter sliders)
  const [liveTelemetryOpen, setLiveTelemetryOpen] = useState(true);
  const [benchmarkOpen, setBenchmarkOpen] = useState(true);
  const [probesOpen, setProbesOpen] = useState(true);
  const [thermocouplesOpen, setThermocouplesOpen] = useState(false);

  const [envelopeOpen, setEnvelopeOpen] = useState(false);
  const [flightNotesOpen, setFlightNotesOpen] = useState(false);
  const [probesExpanded, setProbesExpanded] = useState(false);

  const visibleMarkers =
    probesExpanded || markers.length <= 3 ? markers : markers.slice(0, 3);

  const spreadFmt = formatSpreadRate(telemetry.flameSpreadRateMs, unitSystem);
  const fluxFmt = formatHeatFlux(telemetry.totalHeatFluxWm2, unitSystem);
  const peakFmt = formatTemperature(telemetry.peakFlameTempK, unitSystem);

  const exp = matched.experiment;
  const expVel = formatVelocity(exp.flowVelocityMs, unitSystem);
  const expPress = formatPressure(exp.pressurePa, unitSystem);
  const expBurn =
    exp.observedBurnLengthMm !== null
      ? formatLength(exp.observedBurnLengthMm / 1000, unitSystem)
      : null;
  const expBurnDisplay = expBurn
    ? `${expBurn.text} ${expBurn.unit}`
    : `Coupon: ${exp.sampleLengthMm ?? 940} × ${exp.sampleWidthMm ?? 406} mm (burn length unverified)`;
  const expSpread =
    exp.observedSpreadRateMmS !== null
      ? formatSpreadRate(exp.observedSpreadRateMmS / 1000, unitSystem)
      : null;
  const provenanceLabel = exp.provenanceTag ?? 'Literature Baseline';

  const velocityCurve = useMemo(() => {
    const pts: Array<{ vMs: number; spreadUg: number; spread1g: number }> = [];
    for (let i = 0; i <= 25; i++) {
      const vMs = (i / 25) * 0.5;
      const tUg = computeThermoTelemetry({ ...params, flowVelocityMs: vMs, gravityMs2: 0.0 });
      const t1g = computeThermoTelemetry({ ...params, flowVelocityMs: vMs, gravityMs2: 9.80665 });
      pts.push({ vMs, spreadUg: tUg.flameSpreadRateMs, spread1g: t1g.flameSpreadRateMs });
    }
    return pts;
  }, [params]);

  const svgW = 280;
  const svgH = 60;
  const maxSpread = Math.max(
    0.005,
    ...velocityCurve.map((p) => Math.max(p.spreadUg, p.spread1g)),
  );
  const pathUg = velocityCurve
    .map((p, idx) => {
      const x = (p.vMs / 0.5) * svgW;
      const y = svgH - 6 - (p.spreadUg / maxSpread) * (svgH - 12);
      return `${idx === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const path1g = velocityCurve
    .map((p, idx) => {
      const x = (p.vMs / 0.5) * svgW;
      const y = svgH - 6 - (p.spread1g / maxSpread) * (svgH - 12);
      return `${idx === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const curX = (params.flowVelocityMs / 0.5) * svgW;
  const curY = svgH - 6 - (telemetry.flameSpreadRateMs / maxSpread) * (svgH - 12);

  const renderInspectorBody = (isMobile: boolean) => (
    <div className="flex h-full flex-col bg-[#0C0C0E] text-[#F4F4F5] select-none">
      {/* Inspector Header (44px) */}
      <div className="flex h-11 items-center justify-between border-b border-[#1F1F24] px-3.5 shrink-0">
        <span className="text-[11px] font-mono uppercase tracking-wider text-[#A1A1AA]">
          Telemetry &amp; Diagnostic Inspector
        </span>
        {isMobile && (
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close inspector drawer"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#A1A1AA] hover:bg-[#18181C] hover:text-[#F4F4F5] cursor-pointer"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={1.5} />
          </button>
        )}
      </div>

      {/* Scrollable Pure-Telemetry Accordions */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#1F1F24]">
        {/* Accordion 1: Live Thermo-Fluids Telemetry (Expanded by default) */}
        <section aria-label="Live Thermo-Fluids Telemetry" className="px-3.5 py-2.5">
          <button
            type="button"
            data-testid="right-acc-telemetry-btn"
            onClick={() => setLiveTelemetryOpen((o) => !o)}
            aria-expanded={liveTelemetryOpen}
            className="flex w-full items-center justify-between gap-2 py-0.5 text-left text-[10.5px] font-mono uppercase tracking-wider text-[#A1A1AA] hover:text-[#F4F4F5] cursor-pointer"
          >
            <span>Live Thermo-Fluids Telemetry</span>
            <HugeiconsIcon
              icon={liveTelemetryOpen ? ArrowDown01Icon : ArrowRight01Icon}
              size={12}
              strokeWidth={1.5}
              className="text-[#71717A] shrink-0"
            />
          </button>

          <div className="accordion-content" data-open={liveTelemetryOpen}>
            <div className="accordion-inner">
              <div className="mt-2.5 flex flex-col gap-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-[#1F1F24] bg-[#111114] px-2.5 py-2">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-[#71717A]">
                      Spread Rate
                    </div>
                    <div className="mt-0.5 font-mono text-[13px] font-semibold tabular-nums text-[#F4F4F5]">
                      <span data-testid="spread-rate-val">{spreadFmt.text}</span>{' '}
                      <span className="text-[10px] font-normal text-[#71717A]">
                        {spreadFmt.unit}
                      </span>
                    </div>
                  </div>

                  <div
                    className="rounded-lg border border-[#1F1F24] bg-[#111114] px-2.5 py-2"
                    title={
                      telemetry.n2DischargeActive
                        ? `N2 Suppression Active: Effective O2 ${telemetry.effectiveO2Percent.toFixed(1)}% vs Setpoint ${params.o2Percent.toFixed(1)}%`
                        : `Ambient O2 ${params.o2Percent.toFixed(1)}% vs Effective LOI ${telemetry.effectiveLoiPercent.toFixed(1)}%`
                    }
                  >
                    <div className="flex items-center justify-between gap-1 text-[10px] font-mono uppercase tracking-wider text-[#71717A]">
                      <span>LOI Margin</span>
                    </div>
                    <div className="mt-0.5 font-mono text-[13px] font-semibold tabular-nums text-[#F4F4F5]">
                      <span data-testid="loi-margin-val">
                        {telemetry.loiMarginPercent >= 0 ? '+' : ''}
                        {telemetry.loiMarginPercent.toFixed(1)}%
                      </span>{' '}
                      <span className="text-[10px] font-normal text-[#71717A]">
                        ({telemetry.effectiveLoiPercent.toFixed(1)}%)
                      </span>
                    </div>
                    {telemetry.n2DischargeActive && (
                      <div
                        data-testid="n2-effective-o2-readout"
                        className="mt-0.5 text-[9.5px] font-mono tabular-nums text-[#67E8F9]"
                      >
                        Eff. {telemetry.effectiveO2Percent.toFixed(1)}% / Set {params.o2Percent.toFixed(1)}% O2
                      </div>
                    )}
                  </div>

                  <div
                    className="rounded-lg border border-[#1F1F24] bg-[#111114] px-2.5 py-2"
                    title="Extinction-Proximity Index Da* = exp(f(LOI Margin, Flow Strain)) | Da* >= 1.0 indicates sustained burn margin (LOI Margin >= 0); Da* < 1.0 indicates quenched/blow-off margin. Algebraic index derived from solver LOI margin (not independent Arrhenius kinetics)."
                  >
                    <div className="text-[10px] font-mono uppercase tracking-wider text-[#71717A]">
                      Extinction Index (Da*) / Re
                    </div>
                    <div className="mt-0.5 font-mono text-[13px] font-semibold tabular-nums text-[#F4F4F5]">
                      <span data-testid="damkohler-val">{telemetry.damkohlerNumber.toFixed(2)}</span>{' '}
                      <span
                        data-testid="reynolds-val"
                        title={`Inlet Duct Re (300K, Dh=${Math.round(DUCT_SCALES[resolveDuctScale(params)].hydraulicDiameterM * 1000)}mm)`}
                        className="text-[10px] font-normal text-[#71717A]"
                      >
                        Re {Math.round(telemetry.reynoldsDuct)}
                      </span>
                    </div>
                    <div
                      data-testid="reynolds-note"
                      className="mt-0.5 text-[9px] font-mono text-[#71717A] truncate"
                      title={`Inlet Duct Re (300K, Dh=${Math.round(DUCT_SCALES[resolveDuctScale(params)].hydraulicDiameterM * 1000)}mm)`}
                    >
                      Inlet Duct Re (300K, Dh={Math.round(DUCT_SCALES[resolveDuctScale(params)].hydraulicDiameterM * 1000)}mm)
                    </div>
                  </div>

                  <div className="rounded-lg border border-[#1F1F24] bg-[#111114] px-2.5 py-2">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-[#71717A]">
                      Heat Flux / Peak
                    </div>
                    <div className="mt-0.5 font-mono text-[13px] font-semibold tabular-nums text-[#F4F4F5]">
                      <span data-testid="heat-flux-val">{fluxFmt.text}</span>{' '}
                      <span className="text-[10px] font-normal text-[#71717A]">
                        {fluxFmt.unit} · {peakFmt.text}
                        {peakFmt.unit}
                      </span>
                    </div>
                  </div>
                </div>

                {telemetry.isOutsideCorrelationRange && (
                  <div
                    data-testid="outside-envelope-badge"
                    className="flex items-center justify-between rounded border border-[#27272A] bg-[#141418] px-2 py-1 text-[10px] font-mono text-[#A1A1AA]"
                    title="Inputs exceed calibrated NASA PSI correlation envelope (14-36% O2, 0-45 cm/s, 0-1.5g)"
                  >
                    <span className="uppercase tracking-wider text-[#D4D4D8]">
                      Outside Calibrated Envelope
                    </span>
                    <span className="text-[9px] text-[#71717A]">Extrapolated</span>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <span className="font-mono text-[10px] text-[#71717A] truncate min-w-0">
                    {telemetry.regime}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEnvelopeOpen((o) => !o)}
                    aria-expanded={envelopeOpen}
                    title="Toggle 0g vs. 1g Spread Envelope — Whether a 1g screening result transfers to microgravity depends on ventilation flow and O2; compare live margins across regimes."
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-mono text-[#A1A1AA] hover:bg-[#18181C] hover:text-[#F4F4F5] shrink-0 whitespace-nowrap cursor-pointer"
                  >
                    <span>{envelopeOpen ? 'Hide Envelope' : '0g vs. 1g Envelope'}</span>
                    <HugeiconsIcon
                      icon={envelopeOpen ? ArrowDown01Icon : ArrowRight01Icon}
                      size={11}
                      strokeWidth={1.5}
                    />
                  </button>
                </div>

                {envelopeOpen && (
                  <div className="rounded-lg border border-[#1F1F24] bg-[#111114] p-2.5">
                    <div className="mb-1 flex items-center justify-between text-[10px] font-mono tabular-nums text-[#71717A]">
                      <span>Solid: 0g · Dashed: 1g</span>
                      <span>{MATERIALS[params.materialId].shortName}</span>
                    </div>
                    <svg
                      viewBox={`0 0 ${svgW} ${svgH}`}
                      className="h-[58px] w-full overflow-visible"
                      role="img"
                      aria-label="0g vs 1g flame spread envelope curve"
                    >
                      <line x1={0} y1={svgH - 6} x2={svgW} y2={svgH - 6} stroke="#27272A" strokeWidth={1} />
                      <path d={path1g} fill="none" stroke="#52525B" strokeWidth={1.25} strokeDasharray="4 3" />
                      <path d={pathUg} fill="none" stroke="#E4E4E7" strokeWidth={1.75} />
                      <line x1={curX} y1={4} x2={curX} y2={svgH - 6} stroke="#71717A" strokeWidth={1} strokeDasharray="2 2" />
                      <circle cx={curX} cy={curY} r={3.5} fill="#F4F4F5" stroke="#09090B" strokeWidth={1.5} />
                    </svg>
                    <p
                      data-testid="envelope-regime-note"
                      className="mt-1.5 text-[10px] leading-snug text-[#71717A]"
                    >
                      Whether a 1g screening result transfers to microgravity depends on ventilation flow and O2; compare live margins across regimes.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Accordion 2: Closest Reference Scenario (Adapted) (Expanded by default) */}
        <section aria-label="Closest Reference Scenario (Adapted)" className="px-3.5 py-2.5">
          <button
            type="button"
            data-testid="right-acc-benchmark-btn"
            onClick={() => setBenchmarkOpen((o) => !o)}
            aria-expanded={benchmarkOpen}
            className="flex w-full items-center justify-between gap-2 py-0.5 text-left text-[10.5px] font-mono uppercase tracking-wider text-[#A1A1AA] hover:text-[#F4F4F5] cursor-pointer"
          >
            <span>Closest Reference Scenario (Adapted)</span>
            <span className="flex items-center gap-2 shrink-0">
              <span className="tabular-nums text-[#71717A]">{matched.similarityScore}%</span>
              <HugeiconsIcon
                icon={benchmarkOpen ? ArrowDown01Icon : ArrowRight01Icon}
                size={12}
                strokeWidth={1.5}
                className="text-[#71717A]"
              />
            </span>
          </button>

          <div className="accordion-content" data-open={benchmarkOpen}>
            <div className="accordion-inner">
              <div className="mt-2.5 rounded-lg border border-[#1F1F24] bg-[#111114] p-2.5 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        data-testid="matched-exp-id"
                        className="font-mono text-xs font-semibold text-[#F4F4F5]"
                      >
                        {exp.id}
                      </span>
                      <span
                        data-testid="matched-exp-provenance"
                        className="rounded border border-[#27272A] bg-[#18181C] px-1.5 py-0.5 font-mono text-[9.5px] text-[#A1A1AA]"
                      >
                        {provenanceLabel}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] leading-snug text-[#A1A1AA] line-clamp-2">
                      {exp.title}
                    </div>
                    {exp.psiInvestigationId && exp.doi && (
                      <div
                        data-testid="matched-exp-psi-doi"
                        className="mt-1 font-mono text-[10px] tabular-nums text-[#71717A] truncate"
                        title={`${exp.psiInvestigationId} · DOI ${exp.doi} (${exp.license ?? 'CC0-1.0'})`}
                      >
                        {exp.psiInvestigationId} · DOI {exp.doi}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onLoadExperiment(exp)}
                    className="rounded-md bg-[#18181C] px-2.5 py-1 text-[11px] font-medium text-[#F4F4F5] hover:bg-[#27272A] shrink-0 cursor-pointer"
                  >
                    Load Run
                  </button>
                </div>

                <div className="flex items-center justify-between border-t border-[#1F1F24] pt-2">
                  <span className="font-mono text-[10px] text-[#71717A] truncate">
                    {MATERIALS[exp.materialId].shortName} · {exp.o2Percent.toFixed(1)}% O2 · {expVel.text} {expVel.unit}
                  </span>
                  <button
                    type="button"
                    onClick={() => setFlightNotesOpen((o) => !o)}
                    className="text-[10.5px] font-mono text-[#A1A1AA] hover:text-[#F4F4F5] shrink-0 cursor-pointer"
                  >
                    {flightNotesOpen ? 'Hide Notes' : 'Flight Notes'}
                  </button>
                </div>

                {flightNotesOpen && (
                  <div className="border-t border-[#1F1F24] pt-2 flex flex-col gap-1.5 text-[11px] text-[#A1A1AA]">
                    <div className="grid grid-cols-2 gap-1.5 font-mono text-[10.5px] tabular-nums">
                      <div className={expBurn ? '' : 'col-span-2'}>
                        <span className="text-[#71717A]">Burn </span>
                        <span data-testid="matched-exp-burn" className="text-[#E4E4E7]">
                          {expBurnDisplay}
                        </span>
                      </div>
                      <div>
                        <span className="text-[#71717A]">Spread </span>
                        <span className="text-[#E4E4E7]">
                          {expSpread ? `${expSpread.text} ${expSpread.unit}` : 'Criterion <= 152 mm'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[#71717A]">Pressure </span>
                        <span className="text-[#E4E4E7]">{expPress.text} {expPress.unit}</span>
                      </div>
                      <div>
                        <span className="text-[#71717A]">Thick </span>
                        <span className="text-[#E4E4E7]">{exp.sampleThicknessMm} mm</span>
                      </div>
                    </div>
                    <p className="leading-snug">{exp.discrepancyNote1gVsUg}</p>
                    {exp.provenance?.notes && (
                      <p className="text-[10.5px] leading-snug text-[#71717A]">
                        {exp.provenance.notes}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-1.5 font-mono text-[10px] text-[#71717A]">
                      <span>
                        {exp.psiInvestigationId && exp.doi
                          ? `${exp.psiInvestigationId} · DOI ${exp.doi} · ${exp.license ?? 'CC0-1.0'}`
                          : exp.psiCitation}
                      </span>
                      <span
                        data-testid="matched-exp-verification-status"
                        className="rounded border border-[#27272A] bg-[#18181C] px-1.5 py-0.5 text-[9px] text-[#A1A1AA]"
                      >
                        {exp.verificationStatus === 'verified_ntrs_20180005168'
                          ? exp.sourceCitation ?? 'Urban et al., ASGSR 2017 (NASA NTRS 20180005168, Table 1, pp. 30–31)'
                          : exp.sourceTable
                            ? `${exp.sourceTable} · Pending raw PSI check`
                            : 'Pending raw PSI check'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Accordion 3: Active Probes & Markers (Expanded by default) */}
        <section
          aria-label="Active Probes and Markers"
          data-testid="active-probes-section"
          className="px-3.5 py-2.5"
        >
          <button
            type="button"
            data-testid="right-acc-probes-btn"
            onClick={() => setProbesOpen((o) => !o)}
            aria-expanded={probesOpen}
            className="flex w-full items-center justify-between gap-2 py-0.5 text-left text-[10.5px] font-mono uppercase tracking-wider text-[#A1A1AA] hover:text-[#F4F4F5] cursor-pointer"
          >
            <span>Active Probes &amp; Markers ({markers.length})</span>
            <HugeiconsIcon
              icon={probesOpen ? ArrowDown01Icon : ArrowRight01Icon}
              size={12}
              strokeWidth={1.5}
              className="text-[#71717A] shrink-0"
            />
          </button>

          <div className="accordion-content" data-open={probesOpen}>
            <div className="accordion-inner">
              <div className="mt-2 flex flex-col gap-2">
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    data-testid="pin-centerline-btn"
                    onClick={onPinCenterlineProbe}
                    className="rounded-md bg-[#18181C] px-2 py-0.5 text-[10.5px] font-medium text-[#E4E4E7] hover:bg-[#27272A] whitespace-nowrap cursor-pointer"
                  >
                    Pin Centerline
                  </button>
                  {markers.length > 0 && (
                    <button
                      type="button"
                      onClick={onClearMarkers}
                      className="rounded-md px-2 py-0.5 text-[10.5px] font-medium text-[#71717A] hover:bg-[#18181C] hover:text-[#F4F4F5] whitespace-nowrap cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {pendingCaliperStart && (
                  <div className="rounded-lg border border-[#27272A] bg-[#18181C] px-2.5 py-1.5 font-mono text-[10.5px] text-[#E4E4E7] tabular-nums">
                    Caliper start locked at X={pendingCaliperStart.xMm.toFixed(0)}mm Y={pendingCaliperStart.yMm.toFixed(0)}mm — click 2nd point on duct
                  </div>
                )}

                {markers.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[#27272A] bg-[#111114]/50 px-3 py-2.5 text-[11px] text-[#71717A]">
                    Click anywhere inside the quartz duct canvas to pin a live sensor probe (P-n) or caliper span (D-n).
                  </div>
                ) : (
                  <>
                    <div
                      data-testid="probe-list-container"
                      className={`flex flex-col gap-1.5 pr-0.5 ${
                        markers.length > 3 ? 'max-h-[228px] overflow-y-auto hover-scrollbar' : ''
                      }`}
                    >
                      {visibleMarkers.map((marker) => {
                        if (marker.kind === 'point') {
                          const sampled = sampleDuctFieldAtMm(marker.xMm, marker.yMm, params, telemetry);
                          const tFmt = formatTemperature(sampled.localTempK, unitSystem);
                          const vFmt = formatVelocity(sampled.localVelMs, unitSystem);
                          return (
                            <div
                              key={marker.id}
                              data-testid={`marker-item-${marker.id}`}
                              className="flex items-center justify-between gap-2 rounded-lg border border-[#1F1F24] bg-[#111114] px-2.5 py-1.5 font-mono text-[11px] tabular-nums shrink-0"
                            >
                              <button
                                type="button"
                                onClick={() => onCiteMarkerInChat(marker.id)}
                                title={`Ask AI Safety Officer about @${marker.id}`}
                                className="flex flex-col text-left min-w-0 flex-1 cursor-pointer group"
                              >
                                <div className="flex items-center gap-1.5">
                                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shrink-0" />
                                  <span className="font-semibold text-[#F4F4F5] group-hover:underline">
                                    {marker.id}
                                  </span>
                                  <span className="text-[#71717A] text-[10px]">
                                    X={sampled.xMm.toFixed(0)}mm Y={sampled.yMm.toFixed(0)}mm
                                  </span>
                                </div>
                                <div className="mt-0.5 text-[10.5px] text-[#A1A1AA]">
                                  T={tFmt.text}{tFmt.unit} · V={vFmt.text} {vFmt.unit}
                                </div>
                              </button>

                              <button
                                type="button"
                                onClick={() => onRemoveMarker(marker.id)}
                                aria-label={`Remove marker ${marker.id}`}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[#71717A] hover:bg-[#18181C] hover:text-[#F4F4F5] shrink-0 cursor-pointer"
                              >
                                <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.5} />
                              </button>
                            </div>
                          );
                        }

                        const span = measureCaliperMm(marker);
                        return (
                          <div
                            key={marker.id}
                            data-testid={`marker-item-${marker.id}`}
                            className="flex items-center justify-between gap-2 rounded-lg border border-[#1F1F24] bg-[#111114] px-2.5 py-1.5 font-mono text-[11px] tabular-nums shrink-0"
                          >
                            <button
                              type="button"
                              onClick={() => onCiteMarkerInChat(marker.id)}
                              title={`Ask AI Safety Officer about @${marker.id}`}
                              className="flex flex-col text-left min-w-0 flex-1 cursor-pointer group"
                            >
                              <div className="flex items-center gap-1.5">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-300 shrink-0" />
                                <span className="font-semibold text-[#F4F4F5] group-hover:underline">
                                  {marker.id}
                                </span>
                                <span className="text-[#E4E4E7] text-[10.5px]">
                                  Dist {span.distanceMm.toFixed(1)} mm
                                </span>
                              </div>
                              <div className="mt-0.5 text-[10.5px] text-[#71717A]">
                                dX={span.dxMm.toFixed(1)}mm · dY={span.dyMm.toFixed(1)}mm
                              </div>
                            </button>

                            <button
                              type="button"
                              onClick={() => onRemoveMarker(marker.id)}
                              aria-label={`Remove marker ${marker.id}`}
                              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[#71717A] hover:bg-[#18181C] hover:text-[#F4F4F5] shrink-0 cursor-pointer"
                            >
                              <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.5} />
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    {markers.length > 3 && (
                      <div className="flex items-center justify-end pt-0.5">
                        <button
                          type="button"
                          data-testid="toggle-all-probes-btn"
                          onClick={() => setProbesExpanded((e) => !e)}
                          className="border-0 bg-transparent px-1 py-0.5 text-[11px] font-mono text-[#A1A1AA] hover:text-[#F4F4F5] transition-colors cursor-pointer"
                        >
                          {probesExpanded ? 'Show less' : `See all (${markers.length})`}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Accordion 4: Thermocouple Array (TC-1 - TC-6) (Collapsed by default) */}
        <section aria-label="Thermocouple Array TC-1 through TC-6" className="px-3.5 py-2.5">
          <button
            type="button"
            data-testid="right-acc-thermocouples-btn"
            onClick={() => setThermocouplesOpen((o) => !o)}
            aria-expanded={thermocouplesOpen}
            className="flex w-full items-center justify-between gap-2 py-0.5 text-left text-[10.5px] font-mono uppercase tracking-wider text-[#A1A1AA] hover:text-[#F4F4F5] cursor-pointer"
          >
            <span>Thermocouple Array (TC-1 – TC-6)</span>
            <HugeiconsIcon
              icon={thermocouplesOpen ? ArrowDown01Icon : ArrowRight01Icon}
              size={12}
              strokeWidth={1.5}
              className="text-[#71717A] shrink-0"
            />
          </button>

          <div className="accordion-content" data-open={thermocouplesOpen}>
            <div className="accordion-inner">
              <div
                data-testid="thermocouple-array-grid"
                className="mt-2.5 grid grid-cols-2 gap-1.5"
              >
                {THERMOCOUPLE_ARRAY_SPECS.map((tc, idx) => {
                  const tempK = telemetry.thermocoupleTempsK[idx] ?? AMBIENT_CHAMBER_TEMP_K;
                  const tempFmt = formatTemperature(tempK, unitSystem);
                  return (
                    <div
                      key={tc.id}
                      data-testid={`tc-readout-${tc.id}`}
                      className="rounded-lg border border-[#1F1F24] bg-[#111114] px-2.5 py-1.5 font-mono tabular-nums"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold text-[#E4E4E7]">
                          <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${getTcDotColor(tempK)}`} />
                          <span>{tc.id}</span>
                        </span>
                        <span className="text-[10px] text-[#71717A]">{tc.axialMm} mm</span>
                      </div>
                      <div className="mt-0.5 text-xs font-semibold text-[#F4F4F5]">
                        {tempFmt.text}
                        <span className="text-[10px] font-normal text-[#71717A]">
                          {tempFmt.unit}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Collapsible Right Inspector */}
      {desktopOpen && (
        <aside
          aria-label="Telemetry and Diagnostic Inspector"
          data-testid="right-inspector"
          className="hidden lg:flex w-80 xl:w-[344px] shrink-0 h-screen border-l border-[#1F1F24] flex-col overflow-hidden"
        >
          {renderInspectorBody(false)}
        </aside>
      )}

      {/* Mobile Drawer Overlay (< lg) */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Telemetry and Diagnostic Inspector Drawer"
        >
          <div
            aria-hidden="true"
            onClick={onCloseMobile}
            className="fixed inset-0 bg-black/70 backdrop-blur-xs"
          />
          <aside className="relative z-10 flex h-full w-80 max-w-[90vw] flex-col border-l border-[#27272A] shadow-2xl">
            {renderInspectorBody(true)}
          </aside>
        </div>
      )}
    </>
  );
};
