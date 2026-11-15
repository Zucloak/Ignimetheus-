import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import experimentsJson from './data/nasaPsiExperiments.json';
import { CommandComposer, type SlashActionId } from './components/CommandComposer';
import { LeftSidebar } from './components/LeftSidebar';
import { OfflineIndicator } from './components/OfflineIndicator';
import { RightInspector } from './components/RightInspector';
import { SafetyResponseStream } from './components/SafetyResponseStream';
import { SimulationStage, type ViewportMode } from './components/SimulationStage';
import { ToastStack } from './components/ToastStack';
import {
  getInitialCadMarkers,
  nextMarkerId,
  type CadMarker,
  type CadToolMode,
} from './engine/ductProbes';
import {
  buildVerdictToastInput,
  dismissToastById,
  enqueueToast,
  formatScenarioMetadata,
  stepToastTimers,
  type EnqueueToastInput,
  type ToastItem,
} from './engine/toastQueue';
import {
  AMBIENT_CHAMBER_TEMP_K,
  buildTestVerdict,
  canSustainCombustion,
  computeThermoTelemetry,
  dischargeNitrogen,
  extinguishChamber,
  getInitialChamberForParams,
  MATERIALS,
  matchClosestExperiment,
  MISSION_PRESETS,
  resetChamberToStandby,
  stepChamberTransient,
  triggerIgniterPulse,
  type ChamberTransientInput,
  type MissionPreset,
  type NasaPsiExperiment,
  type SimulationParams,
  type TestDurationMode,
  type TestVerdict,
} from './engine/thermoCore';
import type { UnitSystem } from './engine/units';
import { parseStateFromSearch, serializeStateToSearch } from './engine/urlSync';
import { useSafetyOfficerLLM } from './hooks/useSafetyOfficerLLM';

const NASA_PSI_EXPERIMENTS = experimentsJson as NasaPsiExperiment[];

export default function App() {
  const initial = useMemo(() => {
    if (typeof window === 'undefined') {
      return {
        params: { ...MISSION_PRESETS[0].params },
        unitSystem: 'nasa-psi' as UnitSystem,
      };
    }
    return parseStateFromSearch(window.location.search);
  }, []);

  const [params, setParams] = useState<SimulationParams>(initial.params);
  const [unitSystem, setUnitSystem] = useState<UnitSystem>(initial.unitSystem);

  const [viewportMode, setViewportMode] = useState<ViewportMode>('split');
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [mobileLeftOpen, setMobileLeftOpen] = useState(false);
  const [mobileRightOpen, setMobileRightOpen] = useState(false);

  const [cadTool, setCadTool] = useState<CadToolMode>('probe');
  const [markers, setMarkers] = useState<CadMarker[]>(() => getInitialCadMarkers());
  const [pendingCaliperStart, setPendingCaliperStart] = useState<{
    xMm: number;
    yMm: number;
  } | null>(null);

  const [isPlaying, setIsPlaying] = useState(true);
  const [showStreamlines, setShowStreamlines] = useState(true);
  const [showVectors, setShowVectors] = useState(true);
  const [showContours, setShowContours] = useState(true);
  const [showThermocouples, setShowThermocouples] = useState(true);
  const [showCrosshair, setShowCrosshair] = useState(true);
  const [show1gOverlay, setShow1gOverlay] = useState(false);
  const [testDuration, setTestDuration] = useState<TestDurationMode>(60);
  const [popoverResetSignal, setPopoverResetSignal] = useState(0);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [toastsHovered, setToastsHovered] = useState(false);
  const toastSeqRef = useRef(0);
  const prevVerdictRef = useRef<TestVerdict | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const centerStreamRef = useRef<HTMLDivElement | null>(null);
  const highlightTimerRef = useRef<number | null>(null);

  const [chamber, setChamber] = useState<ChamberTransientInput>(() =>
    getInitialChamberForParams(initial.params),
  );

  const pushToast = useCallback((input: EnqueueToastInput) => {
    toastSeqRef.current += 1;
    const suffix = `${Date.now()}-${toastSeqRef.current}`;
    setToasts((prev) => enqueueToast(prev, input, suffix));
  }, []);

  useEffect(() => {
    if (toasts.length === 0 || toastsHovered) return;
    const id = window.setInterval(() => {
      setToasts((prev) => stepToastTimers(prev, 50, false));
    }, 50);
    return () => window.clearInterval(id);
  }, [toasts.length, toastsHovered]);

  useEffect(() => {
    if (toasts.length === 0 && toastsHovered) {
      setToastsHovered(false);
    }
  }, [toasts.length, toastsHovered]);

  useEffect(() => {
    const currentVerdict = chamber.testVerdict;
    if (currentVerdict && prevVerdictRef.current !== currentVerdict) {
      pushToast(buildVerdictToastInput(currentVerdict, params));
    }
    prevVerdictRef.current = currentVerdict;
  }, [chamber.testVerdict, params, pushToast]);

  // Sync simulation state to URL query parameters (preserving ?tier= override if present)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const currentParams = new URLSearchParams(window.location.search);
    const tierParam = currentParams.get('tier');
    const serialized = serializeStateToSearch(params, unitSystem);
    const nextParams = new URLSearchParams(serialized);
    if (tierParam) {
      nextParams.set('tier', tierParam);
    }
    const nextSearch = `?${nextParams.toString()}`;
    if (window.location.search !== nextSearch) {
      window.history.replaceState(null, '', `${window.location.pathname}${nextSearch}`);
    }
  }, [params, unitSystem]);

  // Step 3.5s Joule ignition transient, chronometer, burn integration, flameScale, N2 purge decay, and TC thermal inertia
  const transientActive =
    isPlaying &&
    ((chamber.n2DischargeRemainingS ?? 0) > 0.001 ||
      (chamber.testVerdict === null
        ? chamber.state === 'IGNITING' ||
          chamber.state === 'SUSTAINED_BURN' ||
          chamber.overloadElapsedS !== null ||
          ((chamber.state === 'STANDBY' || chamber.state === 'SELF_EXTINGUISHED') &&
            (chamber.flameScale > 0.001 ||
              chamber.thermocoupleTempsK.some((t) => t > AMBIENT_CHAMBER_TEMP_K + 0.5)))
        : (chamber.state === 'SELF_EXTINGUISHED' || chamber.state === 'STANDBY') &&
          chamber.flameScale > 0.001));

  useEffect(() => {
    if (!transientActive) return;
    const id = window.setInterval(() => {
      setChamber((prev) => stepChamberTransient(prev, 0.05, params, testDuration));
    }, 50);
    return () => window.clearInterval(id);
  }, [transientActive, params, testDuration]);

  useEffect(() => {
    if (!chamber.testVerdict || !isPlaying) return;
    const waitFade =
      (chamber.state === 'SELF_EXTINGUISHED' || chamber.state === 'STANDBY') &&
      chamber.flameScale > 0.005;
    if (!waitFade) {
      setIsPlaying(false);
    }
  }, [chamber.testVerdict, chamber.state, chamber.flameScale, isPlaying]);

  const handlePulseIgniter = useCallback(() => {
    setIsPlaying(true);
    setChamber((prev) => triggerIgniterPulse(prev));
  }, []);

  const handleExtinguishChamber = useCallback(() => {
    setIsPlaying(true);
    setChamber((prev) => {
      if (prev.state === 'IGNITING' || prev.state === 'SUSTAINED_BURN') {
        return extinguishChamber(prev);
      }
      return resetChamberToStandby(prev, true);
    });
  }, []);

  const handleToggleCombustion = useCallback(() => {
    setIsPlaying(true);
    setChamber((prev) => {
      if (prev.state === 'IGNITING' || prev.state === 'SUSTAINED_BURN') {
        return extinguishChamber(prev);
      }
      return triggerIgniterPulse(prev);
    });
  }, []);

  const handleResetSpecimen = useCallback(() => {
    setIsPlaying(true);
    setChamber((prev) => resetChamberToStandby(prev, true));
  }, []);

  const handleDischargeN2 = useCallback(() => {
    setIsPlaying(true);
    setChamber((prev) => dischargeNitrogen(prev));
    pushToast({
      kind: 'system',
      title: 'N2 Suppression Discharged',
      metadata: formatScenarioMetadata(params),
      summary: 'Inert nitrogen purge active (-8.0% O2 for 5.0s).',
    });
  }, [params, pushToast]);

  const handleChangeTestDuration = useCallback((nextDur: TestDurationMode) => {
    setTestDuration(nextDur);
    setChamber((prev) => {
      if (
        prev.testVerdict &&
        prev.testVerdict.reason === 'TIME_LIMIT' &&
        (nextDur === 'Continuous' || prev.elapsedTimeS < nextDur)
      ) {
        return { ...prev, testVerdict: null };
      }
      return prev;
    });
  }, []);

  // Keyboard shortcuts (Space, I, R, F, 1-4, Esc)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileLeftOpen(false);
        setMobileRightOpen(false);
        setPendingCaliperStart(null);
        setViewportMode((m) => (m === 'fullscreen' ? 'split' : m));
        return;
      }

      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying((p) => !p);
      } else if (e.key === 'i' || e.key === 'I') {
        handlePulseIgniter();
      } else if (e.key === 'r' || e.key === 'R') {
        handleExtinguishChamber();
      } else if (e.key === 'f' || e.key === 'F') {
        setViewportMode((m) => (m === 'fullscreen' ? 'split' : 'fullscreen'));
      } else if (e.key >= '1' && e.key <= '4') {
        const idx = Number(e.key) - 1;
        const preset = MISSION_PRESETS[idx];
        if (preset) {
          const nextParams = { ...preset.params };
          setParams(nextParams);
          setMarkers([]);
          setPendingCaliperStart(null);
          setTestDuration(60);
          setPopoverResetSignal((s) => s + 1);
          setIsPlaying(true);
          setChamber(getInitialChamberForParams(nextParams));
          pushToast({
            kind: 'system',
            title: 'Preset Loaded',
            metadata: formatScenarioMetadata(nextParams),
            summary: `${preset.label} (${(nextParams.flowVelocityMs * 100).toFixed(1)} cm/s ${nextParams.flowMode} flow)`,
          });
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleExtinguishChamber, handlePulseIgniter, pushToast]);

  const activePreset = useMemo(
    () =>
      MISSION_PRESETS.find(
        (preset) =>
          Math.abs(preset.params.o2Percent - params.o2Percent) < 0.15 &&
          Math.abs(preset.params.pressurePa - params.pressurePa) < 400 &&
          Math.abs(preset.params.flowVelocityMs - params.flowVelocityMs) < 0.004 &&
          Math.abs(preset.params.gravityMs2 - params.gravityMs2) < 0.08 &&
          preset.params.materialId === params.materialId &&
          preset.params.flowMode === params.flowMode,
      ) ?? null,
    [params],
  );

  const telemetry = useMemo(() => computeThermoTelemetry(params, chamber), [params, chamber]);

  const matchedExperiment = useMemo(
    () => matchClosestExperiment(params, NASA_PSI_EXPERIMENTS),
    [params],
  );

  const safetyOfficer = useSafetyOfficerLLM({
    params,
    telemetry,
    matched: matchedExperiment,
    unitSystem,
    markers,
  });

  useEffect(() => {
    const el = centerStreamRef.current;
    if (!el || viewportMode === 'fullscreen') return;
    if (safetyOfficer.activeThinking || safetyOfficer.messages.length > 0) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [safetyOfficer.activeThinking, safetyOfficer.messages.length, viewportMode]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  const diagnosticMessages = useMemo(() => {
    const activeAssistants = safetyOfficer.messages.filter((m) => m.role === 'assistant');
    if (safetyOfficer.sessionArchive.length === 0) return activeAssistants;
    return safetyOfficer.sessionArchive;
  }, [safetyOfficer.messages, safetyOfficer.sessionArchive]);

  const handleRestoreDiagnostic = useCallback(
    (msg: (typeof diagnosticMessages)[number]) => {
      if (viewportMode === 'fullscreen') {
        setViewportMode('split');
      }
      safetyOfficer.restoreDiagnosticSession(msg);
      if (msg.snapshot?.params) {
        const restoredParams: SimulationParams = {
          ...msg.snapshot.params,
          ...(msg.snapshot.params.hardware
            ? { hardware: { ...msg.snapshot.params.hardware } }
            : {}),
        };
        setParams(restoredParams);
        setIsPlaying(true);
        setChamber(getInitialChamberForParams(restoredParams));
      }
      setHighlightedMessageId(msg.id);
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
      }
      highlightTimerRef.current = window.setTimeout(() => {
        setHighlightedMessageId((cur) => (cur === msg.id ? null : cur));
      }, 1600);

      window.requestAnimationFrame(() => {
        const target = document.querySelector(`[data-testid="safety-msg-${msg.id}"]`);
        if (target && typeof target.scrollIntoView === 'function') {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    },
    [safetyOfficer, viewportMode],
  );

  const handleChangeParams = useCallback(
    (patch: Partial<SimulationParams>) => {
      setParams((prevParams) => {
        const prevHw = prevParams.hardware ?? {
          wakeBaffle: false,
          flameArrestor: false,
          inertNozzle: false,
        };
        const mergedHardware = patch.hardware
          ? {
              ...prevHw,
              ...patch.hardware,
            }
          : prevParams.hardware;
        const nextParams = {
          ...prevParams,
          ...patch,
          ...(mergedHardware ? { hardware: mergedHardware } : {}),
        };
        setChamber((prevChamber) => {
          if (prevChamber.state === 'SUSTAINED_BURN') {
            const steady = computeThermoTelemetry(nextParams);
            if (!canSustainCombustion(nextParams, steady)) {
              const verdict =
                testDuration !== 'Continuous' && prevChamber.ignitedInRun
                  ? buildTestVerdict(
                      'SELF_EXTINGUISHED',
                      prevChamber.elapsedTimeS,
                      prevChamber.burnLengthMm,
                      testDuration,
                      false,
                    )
                  : prevChamber.testVerdict;
              return {
                ...prevChamber,
                state: 'SELF_EXTINGUISHED',
                stateElapsedS: 0,
                overloadElapsedS: null,
                flameScale: prevChamber.flameScale,
                thermocoupleTempsK: [...prevChamber.thermocoupleTempsK],
                testVerdict: verdict,
              };
            }
          }
          return prevChamber;
        });
        return nextParams;
      });
    },
    [testDuration],
  );

  const handleSelectPreset = useCallback(
    (preset: MissionPreset) => {
      const nextParams = { ...preset.params };
      setParams(nextParams);
      setMarkers([]);
      setPendingCaliperStart(null);
      setTestDuration(60);
      setPopoverResetSignal((s) => s + 1);
      setIsPlaying(true);
      setChamber(getInitialChamberForParams(nextParams));
      pushToast({
        kind: 'system',
        title: 'Preset Loaded',
        metadata: formatScenarioMetadata(nextParams),
        summary: `${preset.label} (${(nextParams.flowVelocityMs * 100).toFixed(1)} cm/s ${nextParams.flowMode} flow)`,
      });
    },
    [pushToast],
  );

  const handleLoadExperiment = useCallback(
    (exp: NasaPsiExperiment) => {
      const nextParams: SimulationParams = {
        o2Percent: exp.o2Percent,
        pressurePa: exp.pressurePa,
        flowVelocityMs: exp.flowVelocityMs,
        gravityMs2: exp.gravityMs2,
        materialId: exp.materialId,
        flowMode: exp.flowMode,
        specimenGeometry:
          exp.program === 'Saffire-II' ? 'sheet' : exp.program === 'FLEX' ? 'droplet' : 'rod',
        ductScale: exp.id.startsWith('SAFFIRE-') ? 'saffire-40cm' : 'msg-12cm',
      };
      setParams(nextParams);
      setMarkers([]);
      setPendingCaliperStart(null);
      setTestDuration(60);
      setPopoverResetSignal((s) => s + 1);
      setIsPlaying(true);
      setChamber(getInitialChamberForParams(nextParams));
      pushToast({
        kind: 'system',
        title: 'Preset Loaded',
        metadata: formatScenarioMetadata(nextParams),
        summary: `Loaded ${exp.id} — ${exp.title}`,
      });
    },
    [pushToast],
  );

  const handleResetParams = useCallback(() => {
    const nextParams = { ...MISSION_PRESETS[0].params };
    setParams(nextParams);
    setTestDuration(60);
    setIsPlaying(true);
    setChamber(getInitialChamberForParams(nextParams));
    pushToast({
      kind: 'system',
      title: 'Preset Loaded',
      metadata: formatScenarioMetadata(nextParams),
      summary: 'Reset chamber parameters to ISS Nominal baseline.',
    });
  }, [pushToast]);

  const handleNewSession = useCallback(() => {
    safetyOfficer.clearMessages();
    setMarkers(getInitialCadMarkers());
    setPendingCaliperStart(null);
    setIsPlaying(true);
    setChamber(getInitialChamberForParams(params));
  }, [params, safetyOfficer]);

  const handleDropMarkerPoint = useCallback(
    (xMm: number, yMm: number) => {
      if (cadTool === 'probe') {
        setMarkers((prev) => [
          ...prev,
          {
            kind: 'point',
            id: nextMarkerId(prev, 'point'),
            xMm,
            yMm,
          },
        ]);
      } else {
        if (!pendingCaliperStart) {
          setPendingCaliperStart({ xMm, yMm });
        } else {
          const start = pendingCaliperStart;
          setMarkers((prev) => [
            ...prev,
            {
              kind: 'caliper',
              id: nextMarkerId(prev, 'caliper'),
              x1Mm: start.xMm,
              y1Mm: start.yMm,
              x2Mm: xMm,
              y2Mm: yMm,
            },
          ]);
          setPendingCaliperStart(null);
        }
      }
    },
    [cadTool, pendingCaliperStart],
  );

  const handlePinCenterlineProbe = useCallback(() => {
    const xMm = params.flowMode === 'concurrent' ? 245 : 195;
    setMarkers((prev) => [
      ...prev,
      {
        kind: 'point',
        id: nextMarkerId(prev, 'point'),
        xMm,
        yMm: 0,
      },
    ]);
  }, [params.flowMode]);

  const handleChangeCadTool = useCallback((tool: CadToolMode) => {
    setCadTool(tool);
    if (tool !== 'caliper') {
      setPendingCaliperStart(null);
    }
  }, []);

  const handleToggleLeftSidebar = useCallback(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setMobileLeftOpen((o) => !o);
    } else {
      setLeftOpen((o) => !o);
    }
  }, []);

  const handleToggleRightInspector = useCallback(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setMobileRightOpen((o) => !o);
    } else {
      setRightOpen((o) => !o);
    }
  }, []);

  const handleExecuteSlashAction = useCallback(
    (action: SlashActionId) => {
      switch (action) {
        case 'ignite':
          handlePulseIgniter();
          break;
        case 'extinguish':
          handleExtinguishChamber();
          break;
        case 'diagnostic':
          safetyOfficer.analyzeSuppressionProtocol();
          break;
        case 'preset-orion':
          handleSelectPreset(MISSION_PRESETS[1]);
          break;
        case 'preset-quench':
          handleSelectPreset(MISSION_PRESETS[2]);
          break;
        case 'reset':
          handleResetParams();
          break;
      }
    },
    [
      handleExtinguishChamber,
      handlePulseIgniter,
      handleResetParams,
      handleSelectPreset,
      safetyOfficer,
    ],
  );

  const handleAnalyzeRunInAI = useCallback(
    (verdictOverride?: TestVerdict) => {
      const targetVerdict = verdictOverride ?? chamber.testVerdict;
      if (!targetVerdict) return;
      if (viewportMode === 'fullscreen') setViewportMode('split');
      const mat = MATERIALS[params.materialId];
      const prompt = `Analyze completed NASA-STD-6001 run: Verdict ${targetVerdict.headline}, burn length ${targetVerdict.burnLengthMm.toFixed(1)} mm in ${targetVerdict.elapsedTimeS.toFixed(1)}s on ${mat.shortName} (${params.o2Percent.toFixed(1)}% O2, ${(params.flowVelocityMs * 100).toFixed(1)} cm/s ${params.flowMode}).`;
      safetyOfficer.sendChatMessage(prompt);
    },
    [chamber.testVerdict, params, safetyOfficer, viewportMode],
  );

  const handleExportJson = useCallback(() => {
    const payload = {
      exportedAt: new Date().toISOString(),
      unitSystem,
      chamberParamsSI: params,
      telemetrySI: telemetry,
      matchedNasaPsiRun: matchedExperiment,
      cadMarkers: markers,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `flame-telemetry-${matchedExperiment.experiment.id.toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [markers, matchedExperiment, params, telemetry, unitSystem]);

  const handleExportCsv = useCallback(() => {
    const rows = [
      ['metric', 'value', 'unit'],
      ['o2_percent', params.o2Percent.toFixed(2), '%'],
      ['pressure_pa', params.pressurePa.toFixed(0), 'Pa'],
      ['flow_velocity_ms', params.flowVelocityMs.toFixed(4), 'm/s'],
      ['gravity_ms2', params.gravityMs2.toFixed(5), 'm/s2'],
      ['material_id', params.materialId, '-'],
      ['flow_mode', params.flowMode, '-'],
      ['regime', telemetry.regime, '-'],
      ['flame_spread_rate_ms', telemetry.flameSpreadRateMs.toFixed(6), 'm/s'],
      ['effective_loi_percent', telemetry.effectiveLoiPercent.toFixed(2), '%'],
      ['loi_margin_percent', telemetry.loiMarginPercent.toFixed(2), '%'],
      ['damkohler_number', telemetry.damkohlerNumber.toFixed(3), '-'],
      ['peak_flame_temp_k', telemetry.peakFlameTempK.toFixed(1), 'K'],
      ['radiative_heat_flux_wm2', telemetry.radiativeHeatFluxWm2.toFixed(1), 'W/m2'],
      ['convective_heat_flux_wm2', telemetry.convectiveHeatFluxWm2.toFixed(1), 'W/m2'],
      ['matched_nasa_psi_id', matchedExperiment.experiment.id, '-'],
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `flame-telemetry-${matchedExperiment.experiment.id.toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [matchedExperiment, params, telemetry]);

  const handleCopyShareUrl = useCallback(async () => {
    if (typeof window === 'undefined') return false;
    const url = window.location.href;
    let copied = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        copied = true;
      }
    } catch {
      copied = false;
    }
    pushToast({
      kind: 'system',
      title: 'Telemetry Link Copied',
      metadata: formatScenarioMetadata(params),
      summary: 'Shareable chamber state URL copied to clipboard.',
    });
    return copied;
  }, [params, pushToast]);

  const handleClearMarkers = useCallback(() => {
    setMarkers([]);
    setPendingCaliperStart(null);
    pushToast({
      kind: 'system',
      title: 'Markers Cleared',
      metadata: formatScenarioMetadata(params),
      summary: 'Removed all pinned duct probes and caliper spans.',
    });
  }, [params, pushToast]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#09090B] text-[#F4F4F5]">
      {/* 1. Left Navigation & Reference Sidebar (w-60 collapsible desktop + mobile drawer) */}
      {viewportMode !== 'fullscreen' && (
        <LeftSidebar
          experiments={NASA_PSI_EXPERIMENTS}
          activePresetId={activePreset?.id ?? null}
          activeMaterialId={params.materialId}
          matched={matchedExperiment}
          unitSystem={unitSystem}
          diagnosticMessages={diagnosticMessages}
          desktopOpen={leftOpen}
          mobileOpen={mobileLeftOpen}
          onCloseMobile={() => setMobileLeftOpen(false)}
          onNewSession={handleNewSession}
          onSelectPreset={handleSelectPreset}
          onLoadExperiment={handleLoadExperiment}
          onRestoreDiagnostic={handleRestoreDiagnostic}
          onClearDiagnostics={safetyOfficer.clearDiagnosticHistory}
        />
      )}

      {/* 2. Center Full-Width Workspace: Top Header + Sticky Sim Stage + Clean AI Stream + Floating Composer */}
      <div className="relative flex flex-1 min-w-0 flex-col h-screen overflow-hidden bg-[#09090B]">
        {/* Top-Right 3D-Stacked Toast Notification System */}
        <ToastStack
          toasts={toasts}
          isHovered={toastsHovered}
          isFullscreen={viewportMode === 'fullscreen'}
          onHoverChange={setToastsHovered}
          onDismiss={(id) => setToasts((prev) => dismissToastById(prev, id))}
          onResetSpecimen={(id) => {
            handleResetSpecimen();
            setToasts((prev) => dismissToastById(prev, id));
          }}
          onAnalyzeRun={(toast) => {
            handleAnalyzeRunInAI(toast.verdict);
            setToasts((prev) => dismissToastById(prev, toast.id));
          }}
        />

        <div ref={centerStreamRef} className="flex-1 overflow-y-auto relative">
          <SimulationStage
            viewportMode={viewportMode}
            params={params}
            telemetry={telemetry}
            unitSystem={unitSystem}
            activeScenarioLabel={activePreset?.shortLabel ?? 'Custom Chamber'}
            matchedProgram={matchedExperiment.experiment.program}
            leftSidebarOpen={leftOpen}
            rightInspectorOpen={rightOpen}
            isPlaying={isPlaying}
            showStreamlines={showStreamlines}
            showVectors={showVectors}
            showContours={showContours}
            showThermocouples={showThermocouples}
            showCrosshair={showCrosshair}
            show1gOverlay={show1gOverlay}
            testDuration={testDuration}
            cadTool={cadTool}
            markers={markers}
            pendingCaliperStart={pendingCaliperStart}
            selectedBackend={safetyOfficer.selectedBackend}
            llmStatus={safetyOfficer.status}
            onToggleLeftSidebar={handleToggleLeftSidebar}
            onToggleRightInspector={handleToggleRightInspector}
            onSetViewportMode={setViewportMode}
            onChangeCadTool={handleChangeCadTool}
            onDropMarkerPoint={handleDropMarkerPoint}
            onTogglePlay={() => setIsPlaying((p) => !p)}
            onToggleCombustion={handleToggleCombustion}
            onDischargeN2={handleDischargeN2}
            onToggleStreamlines={() => setShowStreamlines((s) => !s)}
            onToggleVectors={() => setShowVectors((v) => !v)}
            onToggleContours={() => setShowContours((c) => !c)}
            onToggleThermocouples={() => setShowThermocouples((t) => !t)}
            onToggleCrosshair={() => setShowCrosshair((c) => !c)}
            onToggle1gOverlay={() => setShow1gOverlay((o) => !o)}
            onResetParams={handleResetParams}
            onExportJson={handleExportJson}
            onExportCsv={handleExportCsv}
            onCopyShareUrl={handleCopyShareUrl}
            onSelectBackend={safetyOfficer.selectBackend}
          />

          {viewportMode !== 'fullscreen' && (
            <SafetyResponseStream
              messages={safetyOfficer.messages}
              matched={matchedExperiment}
              unitSystem={unitSystem}
              verifiedSnapshot={safetyOfficer.verifiedSnapshot}
              isGenerating={safetyOfficer.isGenerating}
              activeThinking={safetyOfficer.activeThinking}
              regeneratingMessageId={safetyOfficer.regeneratingMessageId}
              highlightedMessageId={highlightedMessageId}
              tierStatusLabel={safetyOfficer.tierStatusLabel}
              auditPassCount={safetyOfficer.auditPassCount}
              auditFailCount={safetyOfficer.auditFailCount}
              onSendMessage={safetyOfficer.sendChatMessage}
              onRegenerateMessage={safetyOfficer.regenerateMessage}
              onLoadExperiment={handleLoadExperiment}
              onRunDiagnostic={safetyOfficer.analyzeSuppressionProtocol}
            />
          )}
        </div>

        {viewportMode !== 'fullscreen' && (
          <CommandComposer
            params={params}
            telemetry={telemetry}
            matched={matchedExperiment}
            unitSystem={unitSystem}
            activePresetId={activePreset?.id ?? null}
            activePresetLabel={activePreset?.shortLabel ?? 'Custom Chamber'}
            testDuration={testDuration}
            viewportMode={viewportMode}
            markers={markers}
            selectedBackend={safetyOfficer.selectedBackend}
            webGpuPhase={safetyOfficer.webGpuPhase}
            webGpuUnavailableNote={safetyOfficer.webGpuUnavailableNote}
            llmProgress={safetyOfficer.loadProgress}
            isGenerating={safetyOfficer.isGenerating}
            tierStatusLabel={safetyOfficer.tierStatusLabel}
            activeModelFamily={safetyOfficer.hardwareProfile?.modelFamily}
            activeModelId={safetyOfficer.activeModelId ?? safetyOfficer.hardwareProfile?.modelId ?? null}
            onSelectPreset={handleSelectPreset}
            onChangeParams={handleChangeParams}
            onChangeTestDuration={handleChangeTestDuration}
            onChangeUnitSystem={setUnitSystem}
            onToggleCombustion={handleToggleCombustion}
            onRunDiagnostic={safetyOfficer.analyzeSuppressionProtocol}
            onToggleCollapseSim={() =>
              setViewportMode((m) => (m === 'collapsed' ? 'split' : 'collapsed'))
            }
            onSendMessage={safetyOfficer.sendChatMessage}
            onStopGenerating={safetyOfficer.stopGenerating}
            onExecuteSlashAction={handleExecuteSlashAction}
            onSelectBackend={safetyOfficer.selectBackend}
            popoverResetSignal={popoverResetSignal}
          />
        )}
      </div>

      {/* 3. Right Telemetry & Diagnostic Inspector Sidebar (w-80 xl:w-[344px] collapsible desktop + mobile drawer) */}
      {viewportMode !== 'fullscreen' && (
        <RightInspector
          params={params}
          telemetry={telemetry}
          matched={matchedExperiment}
          unitSystem={unitSystem}
          markers={markers}
          pendingCaliperStart={pendingCaliperStart}
          desktopOpen={rightOpen}
          mobileOpen={mobileRightOpen}
          onCloseMobile={() => setMobileRightOpen(false)}
          onLoadExperiment={handleLoadExperiment}
          onPinCenterlineProbe={handlePinCenterlineProbe}
          onRemoveMarker={(id) => setMarkers((prev) => prev.filter((m) => m.id !== id))}
          onClearMarkers={handleClearMarkers}
          onCiteMarkerInChat={(id) =>
            safetyOfficer.sendChatMessage(`Analyze local telemetry at @${id}`)
          }
        />
      )}

      <OfflineIndicator />
    </div>
  );
}
