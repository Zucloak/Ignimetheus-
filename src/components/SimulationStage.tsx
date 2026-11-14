import React, { useEffect, useRef, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  Copy01Icon,
  CpuIcon,
  Download01Icon,
  KeyboardIcon,
  MoreVerticalIcon,
  RotateLeft01Icon,
  SidebarLeftIcon,
  SidebarRightIcon,
  Tick01Icon,
} from '@hugeicons/core-free-icons';
import type { CadMarker, CadToolMode } from '../engine/ductProbes';
import type { InferenceBackendId } from '../engine/inferenceBackend';
import {
  IGNITION_PULSE_DURATION_S,
  NASA_STD_BURN_LIMIT_MM,
  resolveDuctHardware,
  SPECIMEN_LENGTH_MM,
  type ChamberCombustionState,
  type ExtinctionRegime,
  type SimulationParams,
  type TestDurationMode,
  type ThermoTelemetry,
} from '../engine/thermoCore';
import {
  formatSpreadRate,
  formatTemperature,
  type UnitSystem,
} from '../engine/units';
import type { SafetyOfficerStatus } from '../hooks/useSafetyOfficerLLM';
import { CombustionDuctCanvas } from './CombustionDuctCanvas';
import { CombustionTriggerButton } from './CombustionTriggerButton';

export type ViewportMode = 'split' | 'collapsed' | 'fullscreen';

interface SimulationStageProps {
  viewportMode: ViewportMode;
  params: SimulationParams;
  telemetry: ThermoTelemetry;
  unitSystem: UnitSystem;
  activeScenarioLabel: string;
  matchedProgram: string;
  leftSidebarOpen: boolean;
  rightInspectorOpen: boolean;
  isPlaying: boolean;
  showStreamlines: boolean;
  showVectors: boolean;
  showContours: boolean;
  showThermocouples: boolean;
  showCrosshair: boolean;
  show1gOverlay?: boolean;
  testDuration: TestDurationMode;
  cadTool: CadToolMode;
  markers: CadMarker[];
  pendingCaliperStart: { xMm: number; yMm: number } | null;
  selectedBackend: InferenceBackendId;
  llmStatus: SafetyOfficerStatus;
  onToggleLeftSidebar: () => void;
  onToggleRightInspector: () => void;
  onSetViewportMode: (mode: ViewportMode) => void;
  onChangeCadTool: (tool: CadToolMode) => void;
  onDropMarkerPoint: (xMm: number, yMm: number) => void;
  onTogglePlay: () => void;
  onToggleCombustion: () => void;
  onDischargeN2: () => void;
  onToggleStreamlines: () => void;
  onToggleVectors: () => void;
  onToggleContours: () => void;
  onToggleThermocouples: () => void;
  onToggleCrosshair: () => void;
  onToggle1gOverlay?: () => void;
  onResetParams: () => void;
  onExportJson: () => void;
  onExportCsv: () => void;
  onCopyShareUrl: () => Promise<boolean>;
  onSelectBackend: (backend: InferenceBackendId) => void;
}

export function formatChronometer(elapsedS: number, testDuration: TestDurationMode): string {
  const safe = Math.max(0, elapsedS);
  const mins = Math.floor(safe / 60);
  const secs = (safe % 60).toFixed(1).padStart(4, '0');
  const durLabel = testDuration === 'Continuous' ? 'LOOP' : `${testDuration.toFixed(1)}s`;
  return `T+ ${String(mins).padStart(2, '0')}:${secs}s / ${durLabel}`;
}

function getStatusDotClass(
  chamberState: ChamberCombustionState,
  regime: ExtinctionRegime,
): string {
  if (chamberState === 'IGNITING') return 'bg-amber-300';
  if (chamberState === 'SELF_EXTINGUISHED') return 'bg-rose-300';
  if (chamberState === 'STANDBY') return 'bg-zinc-500';
  if (regime === 'Critical Runaway') return 'bg-rose-300';
  if (regime === 'Ventilation-Driven Spread') return 'bg-amber-300';
  if (regime === 'Radiative Spherical' || regime === 'Blow-Off Extinction') return 'bg-cyan-300';
  return 'bg-zinc-400';
}

function getCompactStateLabel(telemetry: ThermoTelemetry): string {
  if (telemetry.chamberState === 'STANDBY') return 'STANDBY';
  if (telemetry.chamberState === 'IGNITING') {
    const rem = Math.max(0, IGNITION_PULSE_DURATION_S - telemetry.stateElapsedS).toFixed(1);
    return `IGNITING ${rem}s`;
  }
  if (telemetry.chamberState === 'SELF_EXTINGUISHED') return 'EXTINGUISHED';
  return telemetry.overloadActive ? 'BURNING +80W' : 'BURNING';
}

export const SimulationStage: React.FC<SimulationStageProps> = ({
  viewportMode,
  params,
  telemetry,
  unitSystem,
  activeScenarioLabel,
  matchedProgram,
  leftSidebarOpen,
  rightInspectorOpen,
  isPlaying,
  showStreamlines,
  showVectors,
  showContours,
  showThermocouples,
  showCrosshair,
  show1gOverlay = false,
  testDuration,
  cadTool,
  markers,
  pendingCaliperStart,
  selectedBackend,
  llmStatus,
  onToggleLeftSidebar,
  onToggleRightInspector,
  onSetViewportMode,
  onChangeCadTool,
  onDropMarkerPoint,
  onTogglePlay,
  onToggleCombustion,
  onDischargeN2,
  onToggleStreamlines,
  onToggleVectors,
  onToggleContours,
  onToggleThermocouples,
  onToggleCrosshair,
  onToggle1gOverlay = () => {},
  onResetParams,
  onExportJson,
  onExportCsv,
  onCopyShareUrl,
  onSelectBackend,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        setShortcutsOpen(false);
      }
    };
    window.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleEsc);
    };
  }, []);

  const spreadFmt = formatSpreadRate(telemetry.flameSpreadRateMs, unitSystem);
  const tempFmt = formatTemperature(telemetry.peakFlameTempK, unitSystem);
  const statusDot = getStatusDotClass(telemetry.chamberState, telemetry.regime);
  const stateLabel = getCompactStateLabel(telemetry);

  const burnFrac = Math.min(1, Math.max(0, telemetry.burnLengthMm / SPECIMEN_LENGTH_MM));
  const timeFrac =
    testDuration === 'Continuous'
      ? burnFrac
      : Math.min(1, Math.max(0, telemetry.elapsedTimeS / testDuration));
  const progressPct = Math.max(timeFrac, burnFrac) * 100;
  const exceededLimit = telemetry.burnLengthMm > NASA_STD_BURN_LIMIT_MM;
  const hardware = resolveDuctHardware(params);

  const visualToggles = [
    {
      id: 'streamlines',
      label: 'Streamlines',
      tooltip: 'Toggle Fluid Tracer Streamlines',
      active: showStreamlines,
      onClick: onToggleStreamlines,
    },
    {
      id: 'vectors',
      label: 'Vectors',
      tooltip: 'Toggle Velocity Vector Arrows',
      active: showVectors,
      onClick: onToggleVectors,
    },
    {
      id: 'contours',
      label: 'Heat Flux',
      tooltip: 'Toggle Thermal Heat-Flux Contours',
      active: showContours,
      onClick: onToggleContours,
    },
    {
      id: 'tc-grid',
      label: 'TC Grid',
      tooltip: 'Toggle Thermocouple Array Readouts',
      active: showThermocouples,
      onClick: onToggleThermocouples,
    },
    {
      id: 'crosshair',
      label: 'Crosshair',
      tooltip: 'Toggle AutoCAD Coordinate Crosshair Reticle',
      active: showCrosshair,
      onClick: onToggleCrosshair,
    },
    {
      id: '1g-overlay',
      label: '1g Overlay',
      tooltip:
        'Toggle 1g Buoyant Plume Silhouette Comparison Overlay — Whether a 1g screening result transfers to microgravity depends on ventilation flow and O2; compare live margins across regimes.',
      active: show1gOverlay,
      onClick: onToggle1gOverlay,
    },
  ];

  const renderMoreMenu = () => (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
        aria-label="More simulation actions"
        aria-expanded={menuOpen}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent text-[#A1A1AA] transition-colors hover:bg-[#1C1C20]/60 hover:text-[#F4F4F5] cursor-pointer"
      >
        <HugeiconsIcon icon={MoreVerticalIcon} size={14} strokeWidth={1.5} />
      </button>

      {menuOpen && (
        <div
          role="menu"
          aria-label="Secondary Actions"
          className="absolute right-0 mt-2 w-60 rounded-xl border border-[#27272A] bg-[#111114]/98 p-1.5 backdrop-blur-xl shadow-2xl z-50"
        >
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              const ok = await onCopyShareUrl();
              if (ok) {
                setCopiedUrl(true);
                window.setTimeout(() => setCopiedUrl(false), 1500);
              }
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-[#E4E4E7] hover:bg-[#18181C] cursor-pointer"
          >
            <HugeiconsIcon icon={copiedUrl ? Tick01Icon : Copy01Icon} size={13} strokeWidth={1.5} className="text-[#A1A1AA]" />
            <span>{copiedUrl ? 'Share URL Copied' : 'Copy Shareable URL'}</span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onResetParams();
              setMenuOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-[#E4E4E7] hover:bg-[#18181C] cursor-pointer"
          >
            <HugeiconsIcon icon={RotateLeft01Icon} size={13} strokeWidth={1.5} className="text-[#A1A1AA]" />
            <span>Reset Parameters</span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onExportJson();
              setMenuOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-[#E4E4E7] hover:bg-[#18181C] cursor-pointer"
          >
            <HugeiconsIcon icon={Download01Icon} size={13} strokeWidth={1.5} className="text-[#A1A1AA]" />
            <span>Export Telemetry JSON</span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onExportCsv();
              setMenuOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-[#E4E4E7] hover:bg-[#18181C] cursor-pointer"
          >
            <HugeiconsIcon icon={Download01Icon} size={13} strokeWidth={1.5} className="text-[#A1A1AA]" />
            <span>Export Telemetry CSV</span>
          </button>

          <div className="my-1 border-t border-[#1F1F24]" />

          {selectedBackend === 'webgpu' ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onSelectBackend('verified');
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-[#E4E4E7] hover:bg-[#18181C] cursor-pointer"
            >
              <HugeiconsIcon icon={CpuIcon} size={13} strokeWidth={1.5} className="text-[#A1A1AA]" />
              <span>Switch to Verified Telemetry Engine</span>
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              disabled={llmStatus === 'Loading Local Weights'}
              onClick={() => {
                onSelectBackend('webgpu');
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-[#E4E4E7] hover:bg-[#18181C] disabled:opacity-45 cursor-pointer"
            >
              <HugeiconsIcon icon={CpuIcon} size={13} strokeWidth={1.5} className="text-[#A1A1AA]" />
              <span>Load Local WebGPU Model</span>
            </button>
          )}

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setShortcutsOpen(true);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-[#E4E4E7] hover:bg-[#18181C] cursor-pointer"
          >
            <HugeiconsIcon icon={KeyboardIcon} size={13} strokeWidth={1.5} className="text-[#A1A1AA]" />
            <span>Keyboard Shortcuts</span>
          </button>
        </div>
      )}
    </div>
  );

  // Fullscreen Focus (100vh)
  if (viewportMode === 'fullscreen') {
    return (
      <div className="fixed inset-0 z-40 bg-[#09090B]">
        <CombustionDuctCanvas
          params={params}
          telemetry={telemetry}
          unitSystem={unitSystem}
          isPlaying={isPlaying}
          showStreamlines={showStreamlines}
          showVectors={showVectors}
          showContours={showContours}
          showThermocouples={showThermocouples}
          showCrosshair={showCrosshair}
          show1gOverlay={show1gOverlay}
          isFullscreen
          cadTool={cadTool}
          markers={markers}
          pendingCaliperStart={pendingCaliperStart}
          onDropMarkerPoint={onDropMarkerPoint}
        />

        <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
          <div
            role="group"
            aria-label="CAD Measurement Tool"
            className="inline-flex rounded-lg border border-[#27272A] bg-[#111114]/90 p-0.5 backdrop-blur-md"
          >
            <button
              type="button"
              onClick={() => onChangeCadTool('probe')}
              aria-pressed={cadTool === 'probe'}
              className={`rounded-md px-2.5 py-1 text-[11px] font-mono transition-colors cursor-pointer ${
                cadTool === 'probe'
                  ? 'bg-[#27272A] text-[#F4F4F5]'
                  : 'text-[#71717A] hover:text-[#E4E4E7]'
              }`}
            >
              Probe P-n
            </button>
            <button
              type="button"
              onClick={() => onChangeCadTool('caliper')}
              aria-pressed={cadTool === 'caliper'}
              className={`rounded-md px-2.5 py-1 text-[11px] font-mono transition-colors cursor-pointer ${
                cadTool === 'caliper'
                  ? 'bg-[#27272A] text-[#F4F4F5]'
                  : 'text-[#71717A] hover:text-[#E4E4E7]'
              }`}
            >
              Caliper D-n
            </button>
          </div>
          <button
            type="button"
            onClick={() => onSetViewportMode('split')}
            aria-label="Exit Fullscreen"
            className="inline-flex items-center rounded-md border-0 bg-[#111114]/85 px-2.5 py-1 text-xs font-medium text-[#E4E4E7] backdrop-blur-md hover:bg-[#1C1C20] hover:text-[#F4F4F5] cursor-pointer"
          >
            <span>Exit Fullscreen</span>
          </button>
        </div>

        {/* Bottom fullscreen dock */}
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2 flex w-[min(96vw,780px)] flex-col items-center gap-3">
          <nav
            aria-label="Fullscreen Simulation Controls"
            className="pointer-events-auto flex flex-col rounded-xl border border-[#27272A] bg-[#111114]/92 backdrop-blur-xl max-w-full overflow-hidden shadow-2xl"
          >
            <div className="flex items-center justify-between gap-4 px-3.5 pt-1.5 pb-1 text-[11px] font-mono tabular-nums text-[#A1A1AA]">
              <span className="text-[#F4F4F5]">{formatChronometer(telemetry.elapsedTimeS, testDuration)}</span>
              <span className={exceededLimit ? 'text-[#F4F4F5]' : 'text-[#A1A1AA]'}>
                Burn {Math.round(telemetry.burnLengthMm)} / {SPECIMEN_LENGTH_MM} mm
              </span>
            </div>
            <div className="h-[2px] w-full bg-[#1F1F24]">
              <div style={{ width: `${progressPct.toFixed(1)}%` }} className="h-full bg-[#E4E4E7]" />
            </div>
            <div className="flex items-center gap-0.5 px-2 py-1 overflow-x-auto no-scrollbar">
              <button
                type="button"
                onClick={onTogglePlay}
                title={isPlaying ? 'Pause Simulation (Space)' : 'Resume Simulation (Space)'}
                aria-label={isPlaying ? 'Pause Simulation (Space)' : 'Resume Simulation (Space)'}
                aria-pressed={isPlaying}
                className={`relative bg-transparent border-0 px-2.5 py-1.5 text-xs font-medium transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  isPlaying
                    ? 'text-[#F4F4F5]'
                    : 'text-[#71717A] hover:text-[#D4D4D8]'
                }`}
              >
                {isPlaying ? 'Pause' : 'Play'}
              </button>

              <CombustionTriggerButton
                chamberState={telemetry.chamberState}
                stateElapsedS={telemetry.stateElapsedS}
                variant="dock"
                testId="fullscreen-combustion-btn"
                onClick={onToggleCombustion}
              />

              {hardware.inertNozzle && (
                <button
                  type="button"
                  data-testid="fullscreen-discharge-n2-btn"
                  onClick={onDischargeN2}
                  className={`relative bg-transparent border-0 px-2.5 py-1.5 text-xs font-medium font-mono tabular-nums whitespace-nowrap shrink-0 transition-all cursor-pointer ${
                    telemetry.n2DischargeActive
                      ? 'text-[#F4F4F5]'
                      : 'text-[#71717A] hover:text-[#D4D4D8]'
                  }`}
                >
                  {telemetry.n2DischargeActive && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-2.5 bottom-0 h-2.5 bg-[radial-gradient(50%_100%_at_50%_100%,rgba(244,244,245,0.05)_0%,transparent_100%)]"
                    />
                  )}
                  <span className="relative z-10">
                    {telemetry.n2DischargeActive
                      ? `N2 ${telemetry.n2DischargeRemainingS.toFixed(1)}s`
                      : 'Discharge N2'}
                  </span>
                  {telemetry.n2DischargeActive && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute bottom-0.5 left-1/2 -translate-x-1/2 w-3.5 h-px bg-gradient-to-r from-transparent via-[#E4E4E7]/45 to-transparent"
                    />
                  )}
                </button>
              )}

              <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-[#27272A] shrink-0" />

              {visualToggles.map((btn) => (
                <button
                  key={btn.id}
                  type="button"
                  onClick={btn.onClick}
                  title={btn.tooltip}
                  aria-pressed={btn.active}
                  className={`relative bg-transparent border-0 px-2.5 py-1.5 text-xs font-medium transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                    btn.active
                      ? 'text-[#F4F4F5]'
                      : 'text-[#71717A] hover:text-[#D4D4D8]'
                  }`}
                >
                  {btn.active && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-2.5 bottom-0 h-2.5 bg-[radial-gradient(50%_100%_at_50%_100%,rgba(244,244,245,0.05)_0%,transparent_100%)]"
                    />
                  )}
                  <span className="relative z-10">{btn.label}</span>
                  {btn.active && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute bottom-0.5 left-1/2 -translate-x-1/2 w-3.5 h-px bg-gradient-to-r from-transparent via-[#E4E4E7]/45 to-transparent"
                    />
                  )}
                </button>
              ))}
            </div>
          </nav>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="sticky top-0 z-20 w-full bg-[#09090B]/92 backdrop-blur-xl">
        {/* Top Workspace Header (44px) */}
        <header className="flex h-11 items-center justify-between gap-2 border-b border-[#1F1F24] px-3 sm:px-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              data-testid="toggle-left-sidebar-btn"
              onClick={onToggleLeftSidebar}
              aria-label="Toggle navigation sidebar"
              aria-pressed={leftSidebarOpen}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent text-[#A1A1AA] transition-colors hover:bg-[#1C1C20]/60 hover:text-[#F4F4F5] shrink-0 cursor-pointer"
            >
              <HugeiconsIcon icon={SidebarLeftIcon} size={14} strokeWidth={1.5} />
            </button>

            <div className="flex items-center gap-1.5 min-w-0 text-xs">
              <span className="font-medium text-[#F4F4F5] truncate">{activeScenarioLabel}</span>
              <span className="text-[#52525B] hidden sm:inline">/</span>
              <span className="font-mono text-[11px] text-[#71717A] truncate hidden sm:inline">
                {matchedProgram} Duct Simulation
              </span>
            </div>

            <span
              data-testid="regime-badge"
              className="hidden md:inline-flex items-center gap-1.5 pl-1 text-[11px] font-mono text-[#E4E4E7] whitespace-nowrap"
            >
              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${statusDot}`} />
              <span>{stateLabel}</span>
              <span className="text-[#52525B]">·</span>
              <span className="text-[#A1A1AA]">{telemetry.regime}</span>
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {viewportMode === 'collapsed' ? (
              <button
                type="button"
                onClick={() => onSetViewportMode('split')}
                aria-label="Expand Simulation"
                className="inline-flex h-7 items-center gap-1 rounded-md border-0 bg-transparent px-2 text-[11px] font-medium text-[#A1A1AA] transition-colors hover:bg-[#1C1C20]/60 hover:text-[#F4F4F5] cursor-pointer"
              >
                <HugeiconsIcon icon={ArrowDown01Icon} size={13} strokeWidth={1.5} />
                <span>Expand Sim</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onSetViewportMode('collapsed')}
                title="Collapse Simulation Stage"
                aria-label="Collapse Simulation Stage"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent text-[#A1A1AA] transition-colors hover:bg-[#1C1C20]/60 hover:text-[#F4F4F5] cursor-pointer"
              >
                <HugeiconsIcon icon={ArrowUp01Icon} size={14} strokeWidth={1.5} />
              </button>
            )}

            <button
              type="button"
              onClick={() => onSetViewportMode('fullscreen')}
              title="Fullscreen Simulation Focus (F)"
              aria-label="Enter Fullscreen Simulation"
              className="inline-flex h-7 items-center rounded-md border-0 bg-transparent px-2 text-[11px] font-medium text-[#A1A1AA] transition-colors hover:bg-[#1C1C20]/60 hover:text-[#F4F4F5] cursor-pointer"
            >
              <span>Fullscreen</span>
            </button>

            {renderMoreMenu()}

            <button
              type="button"
              data-testid="toggle-right-inspector-btn"
              onClick={onToggleRightInspector}
              aria-label="Toggle telemetry and chamber inspector"
              aria-pressed={rightInspectorOpen}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent text-[#A1A1AA] transition-colors hover:bg-[#1C1C20]/60 hover:text-[#F4F4F5] shrink-0 cursor-pointer"
            >
              <HugeiconsIcon icon={SidebarRightIcon} size={14} strokeWidth={1.5} />
            </button>
          </div>
        </header>

        {/* Collapsed 42px Telemetry Bar OR Full-Width Simulation Stage */}
        {viewportMode === 'collapsed' ? (
          <div
            data-testid="collapsed-telemetry-bar"
            className="flex h-[42px] items-center justify-between gap-2 border-b border-[#1F1F24] bg-[#111114]/95 px-3 sm:px-4"
          >
            <div className="flex items-center gap-2 min-w-0 font-mono text-[11px] tabular-nums">
              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${statusDot}`} />
              <span className="text-[#E4E4E7] truncate">{stateLabel}</span>
              <span className="text-[#52525B]">·</span>
              <span data-testid="top-spread-val" className="text-[#A1A1AA]">
                {spreadFmt.text} {spreadFmt.unit}
              </span>
              <span className="hidden sm:inline text-[#52525B]">·</span>
              <span className="hidden sm:inline text-[#A1A1AA]">
                {tempFmt.text}{tempFmt.unit}
              </span>
              <span className="hidden md:inline text-[#52525B]">·</span>
              <span data-testid="chronometer-readout" className="hidden md:inline text-[#71717A]">
                {formatChronometer(telemetry.elapsedTimeS, testDuration)}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <CombustionTriggerButton
                chamberState={telemetry.chamberState}
                stateElapsedS={telemetry.stateElapsedS}
                variant="ghost"
                testId="collapsed-combustion-btn"
                onClick={onToggleCombustion}
              />
              <button
                type="button"
                onClick={() => onSetViewportMode('split')}
                className="rounded-lg bg-[#F4F4F5] px-2.5 py-1 text-[11px] font-medium text-[#09090B] hover:bg-white cursor-pointer"
              >
                Expand Simulation
              </button>
            </div>
          </div>
        ) : (
          <section
            aria-label="Microgravity Combustion Stage"
            data-testid="split-simulation-stage"
            className="w-full border-b border-[#1F1F24] bg-[#0C0C0E]"
          >
            {/* Full-width Canvas Viewport inside Center Pane (~32vh inside ~42vh total stage) */}
            <div className="relative h-[31vh] min-h-[224px] max-h-[340px] w-full bg-[#09090B]">
              <CombustionDuctCanvas
                params={params}
                telemetry={telemetry}
                unitSystem={unitSystem}
                isPlaying={isPlaying}
                showStreamlines={showStreamlines}
                showVectors={showVectors}
                showContours={showContours}
                showThermocouples={showThermocouples}
                showCrosshair={showCrosshair}
                show1gOverlay={show1gOverlay}
                isFullscreen={false}
                cadTool={cadTool}
                markers={markers}
                pendingCaliperStart={pendingCaliperStart}
                onDropMarkerPoint={onDropMarkerPoint}
              />
            </div>

            {/* Stage Progress & Action Bar */}
            <div className="border-t border-[#1F1F24] bg-[#111114]">
              <div className="h-[2px] w-full bg-[#18181C]">
                <div
                  data-testid="chronometer-progress"
                  style={{ width: `${progressPct.toFixed(1)}%` }}
                  className={`h-full transition-[width] duration-75 ${
                    exceededLimit ? 'bg-rose-300/80' : 'bg-[#E4E4E7]'
                  }`}
                />
              </div>

              <div className="flex items-center justify-between gap-2 px-2.5 py-1">
                <div className="flex items-center gap-0 overflow-x-auto no-scrollbar">
                  <button
                    type="button"
                    data-testid="dock-play-pause-btn"
                    onClick={onTogglePlay}
                    title={isPlaying ? 'Pause Simulation (Space)' : 'Resume Simulation (Space)'}
                    aria-label={isPlaying ? 'Pause Simulation (Space)' : 'Resume Simulation (Space)'}
                    aria-pressed={isPlaying}
                    className={`relative bg-transparent border-0 px-2 py-1.5 text-[11.5px] font-medium transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                      isPlaying
                        ? 'text-[#F4F4F5]'
                        : 'text-[#71717A] hover:text-[#D4D4D8]'
                    }`}
                  >
                    {isPlaying ? 'Pause' : 'Play'}
                  </button>

                  <CombustionTriggerButton
                    chamberState={telemetry.chamberState}
                    stateElapsedS={telemetry.stateElapsedS}
                    variant="dock"
                    testId="dock-combustion-btn"
                    onClick={onToggleCombustion}
                  />

                  {hardware.inertNozzle && (
                    <button
                      type="button"
                      data-testid="dock-discharge-n2-btn"
                      onClick={onDischargeN2}
                      title="Inject Inert Gas (N2) Suppression Purge (-8% O2 for 5.0s)"
                      className={`relative bg-transparent border-0 px-2 py-1.5 text-[11.5px] font-medium font-mono tabular-nums whitespace-nowrap shrink-0 transition-all cursor-pointer ${
                        telemetry.n2DischargeActive
                          ? 'text-[#F4F4F5]'
                          : 'text-[#71717A] hover:text-[#D4D4D8]'
                      }`}
                    >
                      {telemetry.n2DischargeActive && (
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-x-2 bottom-0 h-2.5 bg-[radial-gradient(50%_100%_at_50%_100%,rgba(244,244,245,0.05)_0%,transparent_100%)]"
                        />
                      )}
                      <span className="relative z-10">
                        {telemetry.n2DischargeActive
                          ? `N2 ${telemetry.n2DischargeRemainingS.toFixed(1)}s`
                          : 'Discharge N2'}
                      </span>
                      {telemetry.n2DischargeActive && (
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute bottom-0.5 left-1/2 -translate-x-1/2 w-3.5 h-px bg-gradient-to-r from-transparent via-[#E4E4E7]/45 to-transparent"
                        />
                      )}
                    </button>
                  )}

                  <span aria-hidden="true" className="mx-0.5 h-3.5 w-px bg-[#27272A] shrink-0" />

                  {visualToggles.map((btn) => (
                    <button
                      key={btn.id}
                      type="button"
                      data-testid={`dock-toggle-${btn.id}`}
                      onClick={btn.onClick}
                      title={btn.tooltip}
                      aria-label={btn.tooltip}
                      aria-pressed={btn.active}
                      className={`relative bg-transparent border-0 px-2 py-1.5 text-[11.5px] font-medium transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                        btn.active
                          ? 'text-[#F4F4F5]'
                          : 'text-[#71717A] hover:text-[#D4D4D8]'
                      }`}
                    >
                      {btn.active && (
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-x-2 bottom-0 h-2.5 bg-[radial-gradient(50%_100%_at_50%_100%,rgba(244,244,245,0.05)_0%,transparent_100%)]"
                        />
                      )}
                      <span className="relative z-10">{btn.label}</span>
                      {btn.active && (
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute bottom-0.5 left-1/2 -translate-x-1/2 w-3.5 h-px bg-gradient-to-r from-transparent via-[#E4E4E7]/45 to-transparent"
                        />
                      )}
                    </button>
                  ))}

                  <span aria-hidden="true" className="mx-1 h-3.5 w-px bg-[#27272A] shrink-0" />

                  {/* CAD Tool Mode Switcher (Segmented Slider Pill) */}
                  <div
                    role="group"
                    aria-label="CAD Measurement Tool"
                    className="inline-flex items-center rounded-lg border border-[#27272A] bg-[#09090B] p-0.5 shrink-0"
                  >
                    <button
                      type="button"
                      data-testid="cad-tool-probe"
                      onClick={() => onChangeCadTool('probe')}
                      title="Point Sensor Probe (P-n)"
                      aria-label="Probe P-n"
                      aria-pressed={cadTool === 'probe'}
                      className={`rounded-md px-2 py-0.5 text-[10.5px] font-mono whitespace-nowrap transition-colors cursor-pointer ${
                        cadTool === 'probe'
                          ? 'bg-[#27272A] text-[#F4F4F5]'
                          : 'text-[#71717A] hover:text-[#E4E4E7]'
                      }`}
                    >
                      Probe
                    </button>
                    <button
                      type="button"
                      data-testid="cad-tool-caliper"
                      onClick={() => onChangeCadTool('caliper')}
                      title="Two-Point Distance Caliper (D-n)"
                      aria-label="Caliper D-n"
                      aria-pressed={cadTool === 'caliper'}
                      className={`rounded-md px-2 py-0.5 text-[10.5px] font-mono whitespace-nowrap transition-colors cursor-pointer ${
                        cadTool === 'caliper'
                          ? 'bg-[#27272A] text-[#F4F4F5]'
                          : 'text-[#71717A] hover:text-[#E4E4E7]'
                      }`}
                    >
                      Caliper
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-[10.5px] font-mono tabular-nums text-[#A1A1AA] shrink-0 whitespace-nowrap">
                  <span data-testid="chronometer-readout">
                    {formatChronometer(telemetry.elapsedTimeS, testDuration)}
                  </span>
                  <span className="text-[#3F3F46]">·</span>
                  <span
                    data-testid="burn-length-readout"
                    className={exceededLimit ? 'text-[#F4F4F5] font-medium' : 'text-[#A1A1AA]'}
                  >
                    Burn {Math.round(telemetry.burnLengthMm)} / {SPECIMEN_LENGTH_MM} mm
                  </span>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Subtle bottom fade gradient so scrolling AI responses glide beneath the sticky stage */}
        <div
          aria-hidden="true"
          className="pointer-events-none h-5 w-full bg-gradient-to-b from-[#09090B]/95 to-transparent"
        />
      </div>

      {/* Keyboard Shortcuts Modal */}
      {shortcutsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard Shortcuts"
        >
          <div className="w-full max-w-sm rounded-xl border border-[#27272A] bg-[#111114] p-4">
            <div className="flex items-center justify-between border-b border-[#1F1F24] pb-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#F4F4F5]">
                Keyboard Shortcuts
              </h3>
              <button
                type="button"
                onClick={() => setShortcutsOpen(false)}
                aria-label="Close shortcuts"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-[#27272A] text-[#A1A1AA] hover:text-[#F4F4F5] cursor-pointer"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={1.5} />
              </button>
            </div>
            <div className="mt-3 flex flex-col gap-2 text-xs font-mono">
              {[
                ['Space', 'Play / Pause Simulation'],
                ['I', 'Pulse Igniter (80W / +80W Surge)'],
                ['R', 'Reset / Extinguish Chamber'],
                ['F', 'Toggle Fullscreen Focus'],
                ['1 – 4', 'Load NASA Mission Preset'],
                ['Esc', 'Exit Fullscreen / Close Drawers'],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-[#A1A1AA] font-sans">{desc}</span>
                  <kbd className="rounded border border-[#27272A] bg-[#18181C] px-2 py-0.5 text-[11px] text-[#E4E4E7]">
                    {key}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
