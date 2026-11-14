import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, CpuIcon } from '@hugeicons/core-free-icons';
import {
  measureCaliperMm,
  sampleDuctFieldAtMm,
  type CadMarker,
} from '../engine/ductProbes';
import { QUICK_SAFETY_QUESTIONS } from '../engine/safetyAdvisor';
import {
  type MatchedExperimentResult,
  type MissionPreset,
  type SimulationParams,
  type TestDurationMode,
  type ThermoTelemetry,
} from '../engine/thermoCore';
import { formatTemperature, formatVelocity, type UnitSystem } from '../engine/units';
import {
  formatComposerBackendStatus,
  getSelectedEngineLabel,
  type InferenceBackendId,
  type WebGpuRuntimePhase,
} from '../engine/inferenceBackend';
import { WEBLLM_MODEL_ID } from '../hooks/useSafetyOfficerLLM';
import { CombustionTriggerButton } from './CombustionTriggerButton';
import { PresetPopover, QuickTunePopover } from './ComposerPopovers';
import type { ViewportMode } from './SimulationStage';

export type SlashActionId =
  | 'ignite'
  | 'extinguish'
  | 'diagnostic'
  | 'preset-orion'
  | 'preset-quench'
  | 'reset';

interface MentionOption {
  token: string;
  label: string;
  description: string;
}

interface SlashCommandOption {
  id: SlashActionId;
  command: string;
  description: string;
}

const STATIC_MENTION_OPTIONS: MentionOption[] = [
  { token: '@BASS-II-14', label: '@BASS-II-14', description: 'PMMA 15 cm/s ISS Nominal' },
  { token: '@SAFFIRE-II-03', label: '@SAFFIRE-II-03', description: 'Nomex HT90-40 Limit Test' },
  { token: '@FLEX', label: '@FLEX', description: 'Quiescent Microgravity Radiation' },
  { token: '@TC-3', label: '@TC-3', description: 'Flame Core Thermocouple Sensor' },
  { token: '@TC-1..6', label: '@TC-1..6', description: 'Live Thermocouple Array Readings' },
  { token: '@CurrentTelemetry', label: '@CurrentTelemetry', description: 'Live Chamber & Physics Snapshot' },
];

const SLASH_OPTIONS: SlashCommandOption[] = [
  { id: 'ignite', command: '/ignite', description: 'Pulse 80W Nichrome Igniter' },
  { id: 'extinguish', command: '/extinguish', description: 'Extinguish Chamber Flame' },
  { id: 'diagnostic', command: '/diagnostic', description: 'Run Protocol Diagnostic' },
  { id: 'preset-orion', command: '/preset-orion', description: 'Load Orion / Artemis 34% O2' },
  { id: 'preset-quench', command: '/preset-quench', description: 'Load Ventilation Shutdown (0 cm/s)' },
  { id: 'reset', command: '/reset', description: 'Reset Parameters to ISS Nominal' },
];

interface CommandComposerProps {
  params: SimulationParams;
  telemetry: ThermoTelemetry;
  matched: MatchedExperimentResult;
  unitSystem: UnitSystem;
  activePresetId: string | null;
  activePresetLabel: string;
  testDuration: TestDurationMode;
  viewportMode: ViewportMode;
  markers: CadMarker[];
  selectedBackend: InferenceBackendId;
  webGpuPhase: WebGpuRuntimePhase;
  webGpuUnavailableNote: string | null;
  llmProgress: number;
  isGenerating: boolean;
  tierStatusLabel?: string;
  onSelectPreset: (preset: MissionPreset) => void;
  onChangeParams: (patch: Partial<SimulationParams>) => void;
  onChangeTestDuration: (next: TestDurationMode) => void;
  onChangeUnitSystem: (unit: UnitSystem) => void;
  onToggleCombustion: () => void;
  onRunDiagnostic: () => void;
  onToggleCollapseSim: () => void;
  onSendMessage: (msg: string) => void;
  onStopGenerating: () => void;
  onExecuteSlashAction: (action: SlashActionId) => void;
  onSelectBackend: (backend: InferenceBackendId) => void;
  popoverResetSignal?: number;
}

export const CommandComposer: React.FC<CommandComposerProps> = ({
  params,
  telemetry,
  matched,
  unitSystem,
  activePresetId,
  activePresetLabel,
  testDuration,
  viewportMode,
  markers,
  selectedBackend,
  webGpuPhase,
  webGpuUnavailableNote,
  llmProgress,
  isGenerating,
  tierStatusLabel,
  onSelectPreset,
  onChangeParams,
  onChangeTestDuration,
  onChangeUnitSystem,
  onToggleCombustion,
  onRunDiagnostic,
  onToggleCollapseSim,
  onSendMessage,
  onStopGenerating,
  onExecuteSlashAction,
  onSelectBackend,
  popoverResetSignal = 0,
}) => {
  const [input, setInput] = useState('');
  const [plusOpen, setPlusOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const [quickTuneOpen, setQuickTuneOpen] = useState(false);
  const [quickTuneLeftPx, setQuickTuneLeftPx] = useState(0);
  const [highlightedIdx, setHighlightedIdx] = useState(0);

  useEffect(() => {
    if (popoverResetSignal > 0) {
      setPlusOpen(false);
      setModelMenuOpen(false);
      setPresetMenuOpen(false);
      setQuickTuneOpen(false);
    }
  }, [popoverResetSignal]);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const quickTunePillRef = useRef<HTMLButtonElement | null>(null);

  const velFmt = formatVelocity(params.flowVelocityMs, unitSystem);
  const isCollapsed = viewportMode === 'collapsed';

  const dynamicMentions = useMemo<MentionOption[]>(() => {
    const markerOpts: MentionOption[] = markers.map((m) => {
      if (m.kind === 'point') {
        const s = sampleDuctFieldAtMm(m.xMm, m.yMm, params, telemetry);
        const tf = formatTemperature(s.localTempK, unitSystem);
        return {
          token: `@${m.id}`,
          label: `@${m.id}`,
          description: `CAD Probe X=${s.xMm.toFixed(0)}mm Y=${s.yMm.toFixed(0)}mm (${tf.text}${tf.unit})`,
        };
      }
      const span = measureCaliperMm(m);
      return {
        token: `@${m.id}`,
        label: `@${m.id}`,
        description: `CAD Caliper Span ${span.distanceMm.toFixed(1)} mm`,
      };
    });
    return [...markerOpts, ...STATIC_MENTION_OPTIONS];
  }, [markers, params, telemetry, unitSystem]);

  const slashMatch = useMemo(() => {
    const trimmedStart = input.trimStart();
    if (!trimmedStart.startsWith('/') || trimmedStart.includes(' ')) return null;
    const query = trimmedStart.toLowerCase();
    return SLASH_OPTIONS.filter((opt) => opt.command.startsWith(query));
  }, [input]);

  const mentionMatch = useMemo(() => {
    if (slashMatch !== null) return null;
    const m = input.match(/(^|\s)(@[A-Za-z0-9_.-]*)$/);
    if (!m) return null;
    const query = m[2].toLowerCase();
    return {
      tokenStart: input.length - m[2].length,
      items: dynamicMentions.filter((opt) => opt.token.toLowerCase().startsWith(query)),
    };
  }, [dynamicMentions, input, slashMatch]);

  const activePopupItems = slashMatch ?? mentionMatch?.items ?? [];

  useEffect(() => {
    setHighlightedIdx(0);
  }, [input]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(136, Math.max(36, el.scrollHeight))}px`;
  }, [input]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setPlusOpen(false);
        setModelMenuOpen(false);
        setPresetMenuOpen(false);
        setQuickTuneOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPlusOpen(false);
        setModelMenuOpen(false);
        setPresetMenuOpen(false);
        setQuickTuneOpen(false);
      }
    };
    window.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleEsc);
    };
  }, []);

  useLayoutEffect(() => {
    if (!quickTuneOpen) return;
    const container = containerRef.current;
    const pill = quickTunePillRef.current;
    if (!container || !pill) {
      setQuickTuneLeftPx(0);
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const pillRect = pill.getBoundingClientRect();
    const popoverWidth = Math.min(380, window.innerWidth * 0.9);
    const rawLeft = pillRect.left - containerRect.left;
    const maxLeft = Math.max(0, containerRect.width - popoverWidth);
    setQuickTuneLeftPx(Math.max(0, Math.min(rawLeft, maxLeft)));
  }, [quickTuneOpen]);

  const insertMention = (token: string) => {
    if (!mentionMatch) {
      setInput((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${token} `);
    } else {
      setInput((prev) => `${prev.slice(0, mentionMatch.tokenStart)}${token} `);
    }
    textareaRef.current?.focus();
  };

  const triggerSlash = (actionId: SlashActionId) => {
    setInput('');
    setPlusOpen(false);
    onExecuteSlashAction(actionId);
  };

  const handleSubmit = () => {
    if (isGenerating) {
      onStopGenerating();
      return;
    }

    const trimmed = input.trim();
    if (!trimmed) return;

    const matchedSlash = SLASH_OPTIONS.find((s) => s.command === trimmed.toLowerCase());
    if (matchedSlash) {
      triggerSlash(matchedSlash.id);
      return;
    }

    onSendMessage(trimmed);
    setInput('');
    setPlusOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (activePopupItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIdx((idx) => (idx + 1) % activePopupItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIdx((idx) => (idx - 1 + activePopupItems.length) % activePopupItems.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        if (slashMatch) {
          const item = slashMatch[highlightedIdx] ?? slashMatch[0];
          if (item) triggerSlash(item.id);
        } else if (mentionMatch) {
          const item = mentionMatch.items[highlightedIdx] ?? mentionMatch.items[0];
          if (item) insertMention(item.token);
        }
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      setPlusOpen(false);
      setModelMenuOpen(false);
      setPresetMenuOpen(false);
      setQuickTuneOpen(false);
    }
  };

  const modelLabel = getSelectedEngineLabel(selectedBackend);
  const statusDisplay = formatComposerBackendStatus(selectedBackend, webGpuPhase, llmProgress);
  const statusDotColor =
    statusDisplay.dotColor === 'cyan'
      ? 'bg-cyan-300'
      : statusDisplay.dotColor === 'amber'
        ? 'bg-amber-300'
        : 'bg-zinc-400';

  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-0 right-0 z-20 h-28 bg-gradient-to-t from-[#09090B] via-[#09090B]/85 to-transparent"
      />
      <div
        ref={containerRef}
        className="absolute bottom-3 left-1/2 z-30 -translate-x-1/2 w-[calc(100%-1.5rem)] max-w-3xl"
      >
        {/* Upward Popover: @ Mention */}
        {mentionMatch && mentionMatch.items.length > 0 && (
          <div
            role="listbox"
            aria-label="Cite NASA Run, Probe, or Telemetry"
            data-testid="mention-popup"
            className="absolute bottom-full left-0 right-0 mb-2 max-h-60 overflow-y-auto rounded-xl border border-[#27272A] bg-[#111114]/98 p-1.5 backdrop-blur-xl shadow-2xl"
          >
            <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-[#71717A]">
              Cite CAD Probe, NASA PSI Run, or Sensor Array
            </div>
            {mentionMatch.items.map((opt, idx) => (
              <button
                key={opt.token}
                type="button"
                role="option"
                aria-selected={idx === highlightedIdx}
                onClick={() => insertMention(opt.token)}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer ${
                  idx === highlightedIdx ? 'bg-[#18181C] text-[#F4F4F5]' : 'text-[#A1A1AA] hover:bg-[#18181C]'
                }`}
              >
                <span className="font-mono font-medium text-[#F4F4F5]">{opt.label}</span>
                <span className="text-[11px] text-[#71717A] truncate">{opt.description}</span>
              </button>
            ))}
          </div>
        )}

        {/* Upward Popover: / Slash Commands */}
        {slashMatch && slashMatch.length > 0 && (
          <div
            role="listbox"
            aria-label="Chamber Slash Commands"
            data-testid="slash-popup"
            className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-[#27272A] bg-[#111114]/98 p-1.5 backdrop-blur-xl shadow-2xl"
          >
            <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-[#71717A]">
              Chamber Commands
            </div>
            {slashMatch.map((opt, idx) => (
              <button
                key={opt.id}
                type="button"
                role="option"
                aria-selected={idx === highlightedIdx}
                onClick={() => triggerSlash(opt.id)}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer ${
                  idx === highlightedIdx ? 'bg-[#18181C] text-[#F4F4F5]' : 'text-[#A1A1AA] hover:bg-[#18181C]'
                }`}
              >
                <span className="font-mono font-medium text-[#F4F4F5]">{opt.command}</span>
                <span className="text-[11px] text-[#71717A] truncate">{opt.description}</span>
              </button>
            ))}
          </div>
        )}

        {/* Upward Popover: Quick-Insert Prompts (+) */}
        {plusOpen && (
          <div
            data-testid="quick-questions-popover"
            className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-[#27272A] bg-[#111114]/98 p-2 backdrop-blur-xl shadow-2xl"
          >
            <div className="mb-1.5 px-1 text-[10px] font-mono uppercase tracking-wider text-[#71717A]">
              Quick Engineering Prompts
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[
                ...QUICK_SAFETY_QUESTIONS,
                'Analyze @TC-1..6 thermal gradient',
                'Compare @SAFFIRE-II-03 with @BASS-II-14',
                ...(markers[0] ? [`Inspect @${markers[0].id} local field`] : []),
              ].map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => {
                    setPlusOpen(false);
                    onSendMessage(q);
                  }}
                  className="rounded-lg border border-[#27272A] bg-[#18181C] px-2.5 py-1 text-xs text-[#E4E4E7] hover:border-[#3F3F46] cursor-pointer"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Upward Popover: Model Selector */}
        {modelMenuOpen && (
          <div
            role="menu"
            aria-label="Select Inference Engine"
            data-testid="inference-backend-popover"
            className="absolute bottom-full left-0 mb-2 w-80 max-w-[92vw] rounded-xl border border-[#27272A] bg-[#111114]/98 p-1.5 backdrop-blur-xl shadow-2xl"
          >
            <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-[#71717A]">
              Inference Backend
            </div>
            <button
              type="button"
              role="menuitem"
              data-testid="backend-option-verified"
              aria-checked={selectedBackend === 'verified'}
              onClick={() => {
                onSelectBackend('verified');
                setModelMenuOpen(false);
              }}
              className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs text-[#F4F4F5] hover:bg-[#18181C] cursor-pointer"
            >
              <div>
                <div className="font-medium">Verified Telemetry Engine</div>
                <div className="text-[10.5px] text-[#71717A]">Zero-latency deterministic NASA PSI engine</div>
              </div>
              {selectedBackend === 'verified' && (
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shrink-0" />
              )}
            </button>

            <button
              type="button"
              role="menuitem"
              data-testid="backend-option-webgpu"
              aria-checked={selectedBackend === 'webgpu'}
              onClick={() => {
                onSelectBackend('webgpu');
                setModelMenuOpen(false);
              }}
              className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs text-[#F4F4F5] hover:bg-[#18181C] cursor-pointer"
            >
              <div className="min-w-0 pr-2">
                <div className="font-medium">Qwen2.5-1.5B Local WebGPU</div>
                <div className="text-[10.5px] font-mono text-[#71717A] truncate">
                  {WEBLLM_MODEL_ID}
                </div>
              </div>
              {selectedBackend === 'webgpu' && (
                <span
                  className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                    webGpuPhase === 'ready'
                      ? 'bg-cyan-300'
                      : webGpuPhase === 'unavailable' || webGpuPhase === 'error' || webGpuPhase === 'loading' || webGpuPhase === 'probing'
                        ? 'bg-amber-300'
                        : 'bg-cyan-300'
                  }`}
                />
              )}
            </button>

            {selectedBackend === 'webgpu' && webGpuUnavailableNote && (
              <div className="mt-1 border-t border-[#1F1F24] px-2.5 pt-1.5 pb-1 text-[10.5px] leading-snug text-[#A1A1AA]">
                {webGpuUnavailableNote}
              </div>
            )}
          </div>
        )}

        {/* Upward Popover: Preset Selector */}
        {presetMenuOpen && (
          <PresetPopover
            activePresetId={activePresetId}
            unitSystem={unitSystem}
            onSelectPreset={onSelectPreset}
            onClose={() => setPresetMenuOpen(false)}
          />
        )}

        {/* Upward Popover: Quick-Tune Chamber */}
        {quickTuneOpen && (
          <QuickTunePopover
            params={params}
            telemetry={telemetry}
            unitSystem={unitSystem}
            testDuration={testDuration}
            anchorLeftPx={quickTuneLeftPx}
            onChangeParams={onChangeParams}
            onChangeTestDuration={onChangeTestDuration}
            onChangeUnitSystem={onChangeUnitSystem}
          />
        )}

        {/* Outer Two-Tier Composer Shell */}
        <div className="rounded-2xl border border-[#222226] bg-[#111114]/96 backdrop-blur-xl shadow-2xl overflow-hidden">
          <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-2 gap-y-1 border-b border-[#1F1F24] px-3 py-1.5">
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                data-testid="composer-preset-pill"
                aria-expanded={presetMenuOpen}
                aria-haspopup="menu"
                onClick={() => {
                  setPresetMenuOpen((o) => !o);
                  setQuickTuneOpen(false);
                  setPlusOpen(false);
                  setModelMenuOpen(false);
                }}
                className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap cursor-pointer transition-colors ${
                  presetMenuOpen
                    ? 'bg-[#1C1C20] text-[#F4F4F5]'
                    : 'text-[#E4E4E7] hover:bg-[#18181C]'
                }`}
              >
                <span>{activePresetLabel}</span>
                <HugeiconsIcon icon={ArrowDown01Icon} size={11} strokeWidth={1.5} className="text-[#71717A]" />
              </button>

              <span className="text-[#27272A]">·</span>

              <button
                ref={quickTunePillRef}
                type="button"
                data-testid="composer-quick-tune-pill"
                aria-expanded={quickTuneOpen}
                aria-haspopup="dialog"
                onClick={() => {
                  setQuickTuneOpen((o) => !o);
                  setPresetMenuOpen(false);
                  setPlusOpen(false);
                  setModelMenuOpen(false);
                }}
                className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-mono tabular-nums whitespace-nowrap cursor-pointer transition-colors ${
                  quickTuneOpen
                    ? 'bg-[#1C1C20] text-[#F4F4F5]'
                    : 'text-[#A1A1AA] hover:bg-[#18181C] hover:text-[#F4F4F5]'
                }`}
              >
                <span>
                  {matched.experiment.id} · {params.o2Percent.toFixed(1)}% O2 · {velFmt.text} {velFmt.unit}
                </span>
                <HugeiconsIcon icon={ArrowDown01Icon} size={11} strokeWidth={1.5} className="text-[#71717A]" />
              </button>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <CombustionTriggerButton
                chamberState={telemetry.chamberState}
                stateElapsedS={telemetry.stateElapsedS}
                variant="ghost"
                testId="composer-combustion-btn"
                onClick={onToggleCombustion}
              />

              <button
                type="button"
                data-testid="composer-run-diagnostic-btn"
                onClick={onRunDiagnostic}
                disabled={isGenerating}
                className="rounded-md px-2 py-1 text-xs font-medium text-[#A1A1AA] hover:bg-[#1C1C20] hover:text-[#F4F4F5] disabled:opacity-45 whitespace-nowrap cursor-pointer"
              >
                Diagnostic
              </button>

              <button
                type="button"
                onClick={onToggleCollapseSim}
                className="rounded-md px-2 py-1 text-xs font-medium text-[#71717A] hover:bg-[#1C1C20] hover:text-[#F4F4F5] whitespace-nowrap cursor-pointer"
              >
                {isCollapsed ? 'Expand Sim' : 'Collapse Sim'}
              </button>
            </div>
          </div>

          <div className="m-2 rounded-xl border border-[#2A2A2F] bg-[#18181C] px-3 pt-2.5 pb-2">
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask safety officer (@ cite, / actions)"
              aria-label="Ask AI Safety Officer"
              className="w-full min-h-[38px] resize-none bg-transparent text-sm text-[#F4F4F5] placeholder:text-[#71717A] focus:outline-none leading-relaxed"
            />

            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 min-w-0">
                <button
                  type="button"
                  onClick={() => {
                    setPlusOpen((o) => !o);
                    setModelMenuOpen(false);
                    setPresetMenuOpen(false);
                    setQuickTuneOpen(false);
                  }}
                  aria-label="Insert quick safety question"
                  aria-expanded={plusOpen}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent text-[#A1A1AA] transition-colors hover:bg-[#222227]/70 hover:text-[#F4F4F5] shrink-0 cursor-pointer"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>

                <button
                  type="button"
                  data-testid="composer-model-btn"
                  onClick={() => {
                    setModelMenuOpen((o) => !o);
                    setPlusOpen(false);
                    setPresetMenuOpen(false);
                    setQuickTuneOpen(false);
                  }}
                  aria-label="Select AI engine"
                  aria-expanded={modelMenuOpen}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 text-[11px] font-medium text-[#A1A1AA] transition-colors hover:bg-[#222227]/70 hover:text-[#F4F4F5] min-w-0 cursor-pointer"
                >
                  <HugeiconsIcon icon={CpuIcon} size={12} strokeWidth={1.5} className="text-[#71717A] shrink-0" />
                  <span className="truncate max-w-[155px] sm:max-w-none">{modelLabel}</span>
                  <HugeiconsIcon icon={ArrowDown01Icon} size={11} strokeWidth={1.5} className="text-[#71717A] shrink-0" />
                </button>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {tierStatusLabel && (
                  <span
                    data-testid="composer-tier-label"
                    className="hidden sm:inline-flex items-center rounded border border-[#27272A] bg-[#141418] px-1.5 py-0.5 text-[10px] font-mono tabular-nums text-[#A1A1AA]"
                  >
                    {tierStatusLabel}
                  </span>
                )}
                <span
                  data-testid="webllm-status"
                  title={webGpuUnavailableNote ?? statusDisplay.label}
                  className="inline-flex items-center gap-1.5 border-0 bg-transparent px-1 py-0.5 text-[11px] font-mono tabular-nums text-[#A1A1AA]"
                >
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${statusDotColor}`} />
                  <span className="whitespace-nowrap">
                    {isGenerating && selectedBackend === 'webgpu' && webGpuPhase === 'ready'
                      ? 'Thinking · Local WebGPU'
                      : statusDisplay.label}
                  </span>
                </span>

                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!isGenerating && !input.trim()}
                  aria-label={isGenerating ? 'Stop response' : 'Send message'}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white text-[#09090B] transition-colors hover:bg-zinc-200 disabled:bg-[#27272A] disabled:text-[#71717A] cursor-pointer disabled:cursor-not-allowed"
                >
                  {isGenerating ? (
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                      <rect x="2" y="2" width="8" height="8" rx="1.5" />
                    </svg>
                  ) : (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M12 19V5M12 5L6 11M12 5L18 11"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {selectedBackend === 'webgpu' && webGpuUnavailableNote && (
              <div
                data-testid="webgpu-fallback-note"
                role="status"
                className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-snug text-[#A1A1AA]"
              >
                <span aria-hidden="true" className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-300 shrink-0" />
                <span>{webGpuUnavailableNote}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};
