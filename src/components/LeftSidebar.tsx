import React, { useEffect, useMemo, useRef, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Clock01Icon,
} from '@hugeicons/core-free-icons';
import {
  MATERIALS,
  MISSION_PRESETS,
  type MaterialId,
  type MatchedExperimentResult,
  type MissionPreset,
  type NasaPsiExperiment,
} from '../engine/thermoCore';
import { formatTemperature, formatVelocity, ms2ToG, type UnitSystem } from '../engine/units';
import { useOnlineStatus } from '../hooks/usePWAInstall';
import type { SafetyChatMessage } from '../hooks/useSafetyOfficerLLM';
import { PWAInstallButton } from './PWAInstallButton';

interface LeftSidebarProps {
  experiments: NasaPsiExperiment[];
  activePresetId: string | null;
  activeMaterialId: MaterialId;
  matched: MatchedExperimentResult;
  unitSystem: UnitSystem;
  diagnosticMessages: SafetyChatMessage[];
  desktopOpen: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onNewSession: () => void;
  onSelectPreset: (preset: MissionPreset) => void;
  onLoadExperiment: (exp: NasaPsiExperiment) => void;
  onRestoreDiagnostic: (msg: SafetyChatMessage) => void;
  onClearDiagnostics: () => void;
}

const PROGRAM_ORDER = ['Saffire-II', 'BASS-II', 'FLEX', 'NASA-STD-6001'] as const;
const MATERIAL_ORDER: MaterialId[] = ['pmma', 'nomex', 'silicone', 'cellulose'];

function getExperimentGeometryBadge(exp: NasaPsiExperiment): string {
  if (exp.program === 'Saffire-II') return 'Thin Sheet';
  if (exp.program === 'FLEX') return 'Droplet';
  return 'Rod';
}

function getDiagnosticTitle(msg: SafetyChatMessage): string {
  if (msg.kind === 'diagnostic') {
    const expId = msg.snapshot?.experiment.id;
    return expId ? `Protocol Diagnostic · ${expId}` : 'Protocol Diagnostic';
  }
  const source = msg.promptForRegenerate ?? msg.content;
  const firstLine = source.split('\n')[0]?.trim() ?? 'Safety Officer Query';
  return firstLine.length > 34 ? `${firstLine.slice(0, 34)}...` : firstLine;
}

function getHazardDot(hazard?: string): string {
  if (hazard === 'CRITICAL') return 'bg-rose-300';
  if (hazard === 'ELEVATED') return 'bg-amber-300';
  if (hazard === 'EXTINGUISHED') return 'bg-cyan-300';
  return 'bg-zinc-400';
}

export function formatRelativeTimestamp(createdAtMs?: number, nowMs = Date.now()): string {
  if (!createdAtMs || !Number.isFinite(createdAtMs)) return 'Just now';
  const diffS = Math.max(0, Math.floor((nowMs - createdAtMs) / 1000));
  if (diffS < 10) return 'Just now';
  if (diffS < 60) return `${diffS}s ago`;
  const diffM = Math.floor(diffS / 60);
  if (diffM < 60) return `${diffM}m ago`;
  const diffH = Math.floor(diffM / 60);
  return `${diffH}h ago`;
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  experiments,
  activePresetId,
  activeMaterialId,
  matched,
  unitSystem,
  diagnosticMessages,
  desktopOpen,
  mobileOpen,
  onCloseMobile,
  onNewSession,
  onSelectPreset,
  onLoadExperiment,
  onRestoreDiagnostic,
  onClearDiagnostics,
}) => {
  const isOnline = useOnlineStatus();

  // 3 reference accordions per workspace spec (Diagnostic Sessions moved to top-left header Clock popover)
  const [scenariosOpen, setScenariosOpen] = useState(true);
  const [datasetsOpen, setDatasetsOpen] = useState(true);
  const [materialsOpen, setMaterialsOpen] = useState(false);

  const [sessionsPopoverOpen, setSessionsPopoverOpen] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const desktopPopoverRef = useRef<HTMLDivElement | null>(null);
  const mobilePopoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!sessionsPopoverOpen) return;
    setNowTick(Date.now());
    const timer = window.setInterval(() => setNowTick(Date.now()), 15000);
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const inDesktop = desktopPopoverRef.current?.contains(target) ?? false;
      const inMobile = mobilePopoverRef.current?.contains(target) ?? false;
      if (!inDesktop && !inMobile) {
        setSessionsPopoverOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSessionsPopoverOpen(false);
      }
    };
    window.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleKey);
    };
  }, [sessionsPopoverOpen]);

  const [openPrograms, setOpenPrograms] = useState<Record<string, boolean>>({
    'Saffire-II': true,
    'BASS-II': true,
    FLEX: false,
    'NASA-STD-6001': false,
  });

  const groupedExperiments = useMemo(() => {
    const groups: Record<string, NasaPsiExperiment[]> = {};
    for (const prog of PROGRAM_ORDER) {
      groups[prog] = [];
    }
    for (const exp of experiments) {
      if (!groups[exp.program]) {
        groups[exp.program] = [];
      }
      groups[exp.program].push(exp);
    }
    return groups;
  }, [experiments]);

  const toggleProgram = (prog: string) => {
    setOpenPrograms((prev) => ({ ...prev, [prog]: !prev[prog] }));
  };

  const renderSidebarBody = (isMobile: boolean) => {
    const hasDiagnostics = diagnosticMessages.length > 0;
    const containerRef = isMobile ? mobilePopoverRef : desktopPopoverRef;

    return (
      <div
        ref={containerRef}
        className="relative flex h-full flex-col bg-[#0C0C0E] text-[#F4F4F5] select-none"
      >
        {/* Top Brand Header */}
        <div className="flex h-11 items-center gap-2 border-b border-[#1F1F24] px-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
              <path d="M3 6H21M3 18H21" stroke="#52525B" strokeWidth="1.5" strokeLinecap="square" />
              <path d="M4 10H10M4 14H9" stroke="#A1A1AA" strokeWidth="1.5" strokeLinecap="round" />
              <path
                d="M14.5 8.5C17.2 8.5 19.2 10.1 20 12C19.2 13.9 17.2 15.5 14.5 15.5C12.7 15.5 11.4 13.9 11.4 12C11.4 10.1 12.7 8.5 14.5 8.5Z"
                stroke="#F4F4F5"
                strokeWidth="1.5"
              />
            </svg>
            <span className="text-xs font-semibold tracking-tight text-[#F4F4F5] truncate">
              Flame in Freefall
            </span>
          </div>

          <button
            type="button"
            data-testid="diagnostic-sessions-clock-btn"
            aria-label="Diagnostic Sessions"
            aria-expanded={sessionsPopoverOpen}
            title="Diagnostic Sessions"
            onClick={() => setSessionsPopoverOpen((o) => !o)}
            className="ml-auto relative bg-transparent border-0 text-[#A1A1AA] hover:text-[#F4F4F5] hover:bg-[#1C1C20] rounded-md p-1.5 transition-colors cursor-pointer shrink-0"
          >
            <HugeiconsIcon icon={Clock01Icon} size={14} strokeWidth={1.5} />
            {hasDiagnostics && (
              <span
                data-testid="diagnostic-sessions-indicator-dot"
                aria-hidden="true"
                className="pointer-events-none absolute top-1 right-1 h-[5px] w-[5px] rounded-full bg-[#A1A1AA]"
              />
            )}
          </button>

          {isMobile && (
            <button
              type="button"
              onClick={onCloseMobile}
              aria-label="Close navigation drawer"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#A1A1AA] hover:bg-[#18181C] hover:text-[#F4F4F5] cursor-pointer shrink-0"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={1.5} />
            </button>
          )}
        </div>

        {/* Anchored Diagnostic Sessions Popover */}
        {sessionsPopoverOpen && (
          <div
            role="dialog"
            aria-label="Diagnostic Sessions"
            data-testid="diagnostic-sessions-popover"
            className="absolute top-11 left-3 w-72 z-50 bg-[#111114]/95 backdrop-blur-xl border border-[#27272A] rounded-xl shadow-2xl p-2.5"
          >
            <div className="flex items-center justify-between gap-2 px-1.5 pb-2 border-b border-[#1F1F24]">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#71717A]">
                DIAGNOSTIC SESSIONS
              </span>
              {hasDiagnostics && (
                <button
                  type="button"
                  data-testid="diagnostic-sessions-clear-btn"
                  onClick={() => {
                    onClearDiagnostics();
                  }}
                  className="bg-transparent border-0 p-0 text-[10px] font-mono text-[#A1A1AA] hover:text-[#F4F4F5] transition-colors cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>

            {!hasDiagnostics ? (
              <div
                data-testid="diagnostic-sessions-empty"
                className="py-5 px-2 text-center text-[11px] text-[#71717A]"
              >
                No diagnostic runs in this session yet.
              </div>
            ) : (
              <div className="mt-1.5 flex max-h-64 flex-col gap-0.5 overflow-y-auto probes-hover-scroll">
                {diagnosticMessages
                  .slice()
                  .reverse()
                  .map((msg) => {
                    const title = getDiagnosticTitle(msg);
                    const snap = msg.snapshot;
                    const relTime = formatRelativeTimestamp(msg.createdAtMs, nowTick);
                    return (
                      <button
                        key={msg.id}
                        type="button"
                        data-testid={`diagnostic-session-item-${msg.id}`}
                        onClick={() => {
                          onRestoreDiagnostic(msg);
                          setSessionsPopoverOpen(false);
                          if (isMobile) onCloseMobile();
                        }}
                        className="flex w-full items-center justify-between gap-2 rounded-lg bg-transparent border-0 px-2 py-1.5 text-left transition-colors hover:bg-[#1C1C20] cursor-pointer"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            aria-hidden="true"
                            className={`h-1.5 w-1.5 rounded-full shrink-0 ${getHazardDot(
                              snap?.hazardLevel,
                            )}`}
                          />
                          <span className="text-[11px] font-medium text-[#E4E4E7] truncate">
                            {title}
                          </span>
                        </div>
                        <span className="font-mono text-[10px] tabular-nums text-[#71717A] shrink-0">
                          {relTime}
                        </span>
                      </button>
                    );
                  })}
              </div>
            )}
          </div>
        )}

        {/* Primary Flat Antigravity Sidebar Action */}
        <div className="px-2 py-2 border-b border-[#1F1F24] shrink-0">
          <button
            type="button"
            data-testid="new-diagnostic-session-btn"
            onClick={() => {
              onNewSession();
              if (isMobile) onCloseMobile();
            }}
            className="flex w-full items-center justify-start rounded-lg border-0 bg-transparent px-2.5 py-2 text-xs font-medium text-[#E4E4E7] transition-colors hover:bg-[#18181C] hover:text-[#F4F4F5] cursor-pointer"
          >
            + New Diagnostic Session
          </button>
        </div>

        {/* Scrollable 3-Accordion Navigation & Reference Inspector */}
        <nav
          aria-label="Mission Scenarios, PSI Library, and Material Reference"
          className="flex-1 min-h-0 overflow-y-auto divide-y divide-[#1F1F24]"
        >
          {/* 1. Mission Scenarios (Expanded by default) */}
          <section aria-label="Mission Scenarios" className="py-1.5 px-2">
            <button
              type="button"
              data-testid="left-acc-scenarios-btn"
              onClick={() => setScenariosOpen((o) => !o)}
              aria-expanded={scenariosOpen}
              className="flex w-full items-center justify-between gap-1.5 rounded-md px-1.5 py-1.5 text-left text-[10.5px] font-mono uppercase tracking-wider text-[#A1A1AA] hover:text-[#F4F4F5] cursor-pointer"
            >
              <span>Mission Scenarios</span>
              <HugeiconsIcon
                icon={scenariosOpen ? ArrowDown01Icon : ArrowRight01Icon}
                size={12}
                strokeWidth={1.5}
                className="text-[#71717A] shrink-0"
              />
            </button>

            <div className="accordion-content" data-open={scenariosOpen}>
              <div className="accordion-inner">
                <div className="mt-1 flex flex-col gap-0.5 pb-1">
                  {MISSION_PRESETS.map((preset) => {
                    const isActive = activePresetId === preset.id;
                    const velFmt = formatVelocity(preset.params.flowVelocityMs, unitSystem);
                    const gRatio = ms2ToG(preset.params.gravityMs2);
                    const gText = gRatio < 0.01 ? '0g' : `${gRatio.toFixed(gRatio === 1 ? 0 : 2)}g`;

                    return (
                      <button
                        key={preset.id}
                        type="button"
                        data-testid={`preset-btn-${preset.id}`}
                        onClick={() => {
                          onSelectPreset(preset);
                          if (isMobile) onCloseMobile();
                        }}
                        title={preset.description}
                        className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors cursor-pointer ${
                          isActive
                            ? 'bg-[#18181C] text-[#F4F4F5]'
                            : 'text-[#A1A1AA] hover:bg-[#111114] hover:text-[#F4F4F5]'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${
                            isActive ? 'bg-[#F4F4F5]' : 'bg-[#3F3F46]'
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium truncate leading-tight">
                            {preset.id === 'vent-shutdown'
                              ? 'Ventilation Shutdown'
                              : preset.id === 'earth-1g'
                                ? 'Earth 1g Screening'
                                : preset.label}
                          </div>
                          <div className="mt-0.5 font-mono text-[10px] tabular-nums text-[#71717A] truncate">
                            {preset.params.o2Percent.toFixed(1)}% O2 · {velFmt.text} {velFmt.unit} · {gText}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          {/* 2. NASA PSI Dataset Library (Expanded by default) */}
          <section aria-label="NASA PSI Dataset Library" className="py-1.5 px-2">
            <button
              type="button"
              data-testid="left-acc-datasets-btn"
              onClick={() => setDatasetsOpen((o) => !o)}
              aria-expanded={datasetsOpen}
              className="flex w-full items-center justify-between gap-1.5 rounded-md px-1.5 py-1.5 text-left text-[10.5px] font-mono uppercase tracking-wider text-[#A1A1AA] hover:text-[#F4F4F5] cursor-pointer"
            >
              <span>NASA PSI Dataset Library</span>
              <HugeiconsIcon
                icon={datasetsOpen ? ArrowDown01Icon : ArrowRight01Icon}
                size={12}
                strokeWidth={1.5}
                className="text-[#71717A] shrink-0"
              />
            </button>

            <div className="accordion-content" data-open={datasetsOpen}>
              <div className="accordion-inner">
                <div className="mt-1 flex flex-col gap-1 pb-1">
                  {PROGRAM_ORDER.map((prog) => {
                    const runs = groupedExperiments[prog] ?? [];
                    const isOpen = Boolean(openPrograms[prog]);
                    return (
                      <div key={prog}>
                        <button
                          type="button"
                          onClick={() => toggleProgram(prog)}
                          aria-expanded={isOpen}
                          className="flex w-full items-center justify-between gap-1.5 rounded-md px-2 py-1 text-left text-[11px] font-medium text-[#A1A1AA] hover:bg-[#111114] hover:text-[#E4E4E7] cursor-pointer"
                        >
                          <span className="flex items-center gap-1.5 min-w-0">
                            <HugeiconsIcon
                              icon={isOpen ? ArrowDown01Icon : ArrowRight01Icon}
                              size={10}
                              strokeWidth={1.5}
                              className="text-[#71717A] shrink-0"
                            />
                            <span className="truncate">{prog}</span>
                          </span>
                          <span className="font-mono text-[10px] text-[#52525B] tabular-nums">
                            {runs.length}
                          </span>
                        </button>

                        <div className="accordion-content" data-open={isOpen}>
                          <div className="accordion-inner">
                            <div className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-[#1F1F24] pl-2">
                              {runs.map((exp) => {
                                const isMatched = matched.experiment.id === exp.id;
                                const geomLabel = getExperimentGeometryBadge(exp);
                                return (
                                  <button
                                    key={exp.id}
                                    type="button"
                                    data-testid={`psi-run-${exp.id}`}
                                    onClick={() => {
                                      onLoadExperiment(exp);
                                      if (isMobile) onCloseMobile();
                                    }}
                                    title={`${exp.title} — ${exp.o2Percent}% O2, ${(exp.flowVelocityMs * 100).toFixed(1)} cm/s`}
                                    className={`flex w-full items-center justify-between gap-1.5 rounded-md px-2 py-1 text-left transition-colors cursor-pointer ${
                                      isMatched
                                        ? 'bg-[#18181C] text-[#F4F4F5]'
                                        : 'text-[#71717A] hover:bg-[#111114] hover:text-[#E4E4E7]'
                                    }`}
                                  >
                                    <span className="flex items-center gap-1.5 min-w-0">
                                      <span
                                        className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                                          isMatched ? 'bg-cyan-300' : 'bg-[#3F3F46]'
                                        }`}
                                      />
                                      <span className="font-mono text-[11px] truncate">{exp.id}</span>
                                    </span>
                                    <span className="font-mono text-[9.5px] text-[#71717A] shrink-0">
                                      {geomLabel}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          {/* 3. Material Flammability Specs (Collapsed by default) */}
          <section aria-label="Material Flammability Specs" className="py-1.5 px-2">
            <button
              type="button"
              data-testid="left-acc-materials-btn"
              onClick={() => setMaterialsOpen((o) => !o)}
              aria-expanded={materialsOpen}
              className="flex w-full items-center justify-between gap-1.5 rounded-md px-1.5 py-1.5 text-left text-[10.5px] font-mono uppercase tracking-wider text-[#A1A1AA] hover:text-[#F4F4F5] cursor-pointer"
            >
              <span>Material Flammability Specs</span>
              <HugeiconsIcon
                icon={materialsOpen ? ArrowDown01Icon : ArrowRight01Icon}
                size={12}
                strokeWidth={1.5}
                className="text-[#71717A] shrink-0"
              />
            </button>

            <div className="accordion-content" data-open={materialsOpen}>
              <div className="accordion-inner">
                <div className="mt-1 flex flex-col gap-1.5 pb-1">
                  {MATERIAL_ORDER.map((matId) => {
                    const mat = MATERIALS[matId];
                    const isCurrent = activeMaterialId === matId;
                    const ignTempFmt = formatTemperature(mat.vaporizationTempK, unitSystem);
                    const displayTitle =
                      mat.id === 'silicone'
                        ? 'Silicone Wire'
                        : mat.id === 'nomex'
                          ? 'Nomex'
                          : mat.shortName;
                    return (
                      <div
                        key={mat.id}
                        data-testid={`material-spec-card-${mat.id}`}
                        className={`rounded-lg border px-2.5 py-2 ${
                          isCurrent
                            ? 'border-[#27272A] bg-[#18181C]'
                            : 'border-[#1F1F24] bg-[#111114]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-medium text-[#F4F4F5] truncate">
                            {displayTitle}
                          </span>
                          <span className="font-mono text-[9.5px] text-[#71717A] shrink-0">
                            {mat.charForming ? 'Charring' : 'Non-charring'}
                          </span>
                        </div>

                        <div className="mt-1.5 grid grid-cols-3 gap-1 font-mono text-[10px] tabular-nums">
                          <div>
                            <div className="text-[#52525B]">1g LOI</div>
                            <div className="text-[#E4E4E7]">{mat.loi1gPercent.toFixed(1)}%</div>
                          </div>
                          <div>
                            <div className="text-[#52525B]">0g Min LOI</div>
                            <div className="text-[#E4E4E7]">{mat.loiUgMinPercent.toFixed(1)}%</div>
                          </div>
                          <div>
                            <div className="text-[#52525B]">T_ign</div>
                            <div className="text-[#E4E4E7]">
                              {ignTempFmt.text}
                              {ignTempFmt.unit}
                            </div>
                          </div>
                        </div>

                        <p className="mt-1.5 text-[10px] leading-snug text-[#71717A]">
                          {mat.notes}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        </nav>

        {/* Footer Bar: PWA Offline Status Only */}
        <div className="border-t border-[#1F1F24] px-3 py-2 flex items-center justify-between gap-2 shrink-0 bg-[#09090B]/60">
          <span
            data-testid="pwa-offline-badge"
            className="inline-flex items-center gap-1.5 text-[10.5px] font-mono text-[#71717A]"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${isOnline ? 'bg-cyan-300' : 'bg-amber-300'}`}
            />
            <span>{isOnline ? 'PWA Offline Ready' : 'Offline Active'}</span>
          </span>
          <PWAInstallButton />
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Desktop Collapsible Left Sidebar (relative without overflow-hidden so w-72 popover can extend cleanly) */}
      {desktopOpen && (
        <aside
          aria-label="Mission and Dataset Navigation"
          data-testid="left-sidebar"
          className="relative hidden lg:flex w-60 shrink-0 h-screen border-r border-[#1F1F24] flex-col z-30"
        >
          {renderSidebarBody(false)}
        </aside>
      )}

      {/* Mobile Drawer Overlay (< lg) */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 flex lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Mission and Dataset Drawer"
        >
          <div
            aria-hidden="true"
            onClick={onCloseMobile}
            className="fixed inset-0 bg-black/70 backdrop-blur-xs"
          />
          <aside className="relative z-10 flex h-full w-72 max-w-[85vw] flex-col border-r border-[#27272A] shadow-2xl">
            {renderSidebarBody(true)}
          </aside>
        </div>
      )}
    </>
  );
};
