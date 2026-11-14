import React, { useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Copy01Icon,
  RotateLeft01Icon,
  Tick01Icon,
} from '@hugeicons/core-free-icons';
import {
  QUICK_SAFETY_QUESTIONS,
  tokenizeInlineMetricPills,
  type SafetyRecommendation,
} from '../engine/safetyAdvisor';
import {
  MATERIALS,
  type MatchedExperimentResult,
  type NasaPsiExperiment,
} from '../engine/thermoCore';
import {
  formatLength,
  formatPressure,
  formatSpreadRate,
  formatVelocity,
  type UnitSystem,
} from '../engine/units';
import type { ActiveSafetyThinking, SafetyChatMessage } from '../hooks/useSafetyOfficerLLM';
import { ThoughtLine } from './ThoughtLine';

interface SafetyResponseStreamProps {
  messages: SafetyChatMessage[];
  matched: MatchedExperimentResult;
  unitSystem: UnitSystem;
  verifiedSnapshot: SafetyRecommendation;
  isGenerating: boolean;
  activeThinking: ActiveSafetyThinking | null;
  regeneratingMessageId: string | null;
  highlightedMessageId?: string | null;
  tierStatusLabel?: string;
  auditPassCount?: number;
  auditFailCount?: number;
  onSendMessage: (msg: string) => void;
  onRegenerateMessage: (msgId: string) => void;
  onLoadExperiment: (exp: NasaPsiExperiment) => void;
  onRunDiagnostic: () => void;
}

function renderInlinePills(text: string): React.ReactNode {
  const segments = tokenizeInlineMetricPills(text);
  return segments.map((seg, idx) =>
    seg.isMetricPill ? (
      <code
        key={idx}
        className="mx-0.5 inline-block rounded border border-[#27272A] bg-[#18181C] px-1.5 py-0.5 font-mono text-xs tabular-nums text-[#E4E4E7]"
      >
        {seg.text}
      </code>
    ) : (
      <React.Fragment key={idx}>{seg.text}</React.Fragment>
    ),
  );
}

function renderStructuredAssistantBody(content: string): React.ReactNode {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let bulletBuffer: string[] = [];

  const flushBullets = (keyPrefix: string) => {
    if (bulletBuffer.length === 0) return;
    elements.push(
      <ul key={keyPrefix} className="my-2 flex flex-col gap-1.5 pl-4 list-disc marker:text-[#52525B]">
        {bulletBuffer.map((item, i) => (
          <li key={i} className="text-sm leading-relaxed text-[#A1A1AA]">
            {renderInlinePills(item)}
          </li>
        ))}
      </ul>,
    );
    bulletBuffer = [];
  };

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (!line) {
      flushBullets(`b-${idx}`);
      return;
    }

    const boldHeading = line.match(/^\*\*(.+?)\*\*$/);
    if (boldHeading) {
      flushBullets(`b-${idx}`);
      elements.push(
        <h3 key={`h-${idx}`} className="mt-3 first:mt-0 text-sm font-semibold text-[#F4F4F5]">
          {boldHeading[1]}
        </h3>,
      );
      return;
    }

    const labeled = line.match(
      /^(STATUS|DIAGNOSIS|HVAC|ATMOS|SUPPRESSION|NASA PSI CITATION|Cited Run):\s*(.+)$/,
    );
    if (labeled) {
      flushBullets(`b-${idx}`);
      elements.push(
        <div key={`lbl-${idx}`} className="mt-2 first:mt-0 flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-2">
          <span className="shrink-0 font-mono text-[11px] font-semibold uppercase tracking-wider text-[#F4F4F5]">
            {labeled[1]}
          </span>
          <span className="text-sm leading-relaxed text-[#A1A1AA]">{renderInlinePills(labeled[2])}</span>
        </div>,
      );
      return;
    }

    const bulletMatch = line.match(/^(?:-|\*|\d+\.)\s+(.+)$/);
    if (bulletMatch) {
      bulletBuffer.push(bulletMatch[1]);
      return;
    }

    flushBullets(`b-${idx}`);
    elements.push(
      <p key={`p-${idx}`} className="mt-2 first:mt-0 text-sm leading-relaxed text-[#A1A1AA]">
        {renderInlinePills(line)}
      </p>,
    );
  });

  flushBullets('b-end');
  return elements;
}

function getHazardDot(hazard: SafetyRecommendation['hazardLevel']): string {
  if (hazard === 'CRITICAL') return 'bg-rose-300';
  if (hazard === 'ELEVATED') return 'bg-amber-300';
  if (hazard === 'EXTINGUISHED') return 'bg-cyan-300';
  return 'bg-zinc-400';
}

export const SafetyResponseStream: React.FC<SafetyResponseStreamProps> = ({
  messages,
  matched,
  unitSystem,
  verifiedSnapshot,
  isGenerating,
  activeThinking,
  regeneratingMessageId,
  highlightedMessageId,
  tierStatusLabel = 'Tier: constrained · Deterministic',
  auditPassCount = 0,
  auditFailCount = 0,
  onSendMessage,
  onRegenerateMessage,
  onLoadExperiment,
  onRunDiagnostic,
}) => {
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (id: string, text: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        setCopiedId(id);
        window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
      }
    } catch {
      // Ignore clipboard failure
    }
  };

  return (
    <main
      aria-label="AI Fire Safety Officer Stream"
      data-testid="safety-chat-history"
      className="mx-auto w-full max-w-3xl px-4 sm:px-6 pt-3 pb-44"
    >
      <div
        data-testid="safety-officer-status-bar"
        className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-[#1F1F24] pb-2"
      >
        <div className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 rounded-full ${getHazardDot(verifiedSnapshot.hazardLevel)}`} />
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#F4F4F5]">
            Onboard Fire Safety Officer · {verifiedSnapshot.hazardLevel}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] tabular-nums text-[#71717A]">
          <span
            data-testid="safety-tier-status-badge"
            className="rounded border border-[#27272A] bg-[#141418] px-1.5 py-0.5 text-[10px] text-[#A1A1AA]"
          >
            {tierStatusLabel}
          </span>
          {(auditPassCount > 0 || auditFailCount > 0) && (
            <span
              data-testid="safety-audit-counter"
              className="rounded border border-[#27272A] bg-[#141418] px-1.5 py-0.5 text-[10px] text-[#A1A1AA]"
            >
              Audit {auditPassCount}P / {auditFailCount}F
            </span>
          )}
          <span>Grounded in {matched.experiment.id}</span>
        </div>
      </div>

      {messages.length === 0 ? (
        <section className="flex flex-col gap-3 py-1">
          <p className="text-[13.5px] leading-relaxed text-[#A1A1AA]">
            {renderInlinePills(verifiedSnapshot.summary)}
          </p>

          {/* Pure-Typography Starter Prompt Triggers (zero metric cards wedged below stage) */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <button
              type="button"
              onClick={onRunDiagnostic}
              disabled={isGenerating}
              className="rounded-lg bg-[#F4F4F5] px-3 py-1.5 text-xs font-medium text-[#09090B] hover:bg-white cursor-pointer disabled:opacity-45"
            >
              Run Protocol Diagnostic
            </button>
            {QUICK_SAFETY_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => onSendMessage(q)}
                disabled={isGenerating}
                className="rounded-lg border border-[#1F1F24] bg-[#111114] px-3 py-1.5 text-xs text-[#A1A1AA] hover:border-[#27272A] hover:text-[#F4F4F5] cursor-pointer disabled:opacity-45"
              >
                {q}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <div className="flex flex-col gap-6 py-2">
          {messages.map((msg) => {
            if (msg.role === 'user') {
              return (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[82%] rounded-2xl border border-[#27272A] bg-[#18181C] px-4 py-2 text-sm text-[#F4F4F5]">
                    {msg.content}
                  </div>
                </div>
              );
            }

            const snap = msg.snapshot;
            const isInspected = Boolean(expandedCards[msg.id]);
            const exp = snap?.experiment ?? matched.experiment;
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

            return (
              <article
                key={msg.id}
                data-testid={`safety-msg-${msg.id}`}
                className={`flex flex-col gap-3 rounded-xl transition-colors duration-300 ${
                  highlightedMessageId === msg.id
                    ? 'bg-[#111114] ring-1 ring-[#3F3F46] p-3 -mx-3'
                    : ''
                }`}
              >
                {(msg.thoughtSteps?.length || regeneratingMessageId === msg.id) && (
                  <ThoughtLine
                    testId={`thought-line-${msg.id}`}
                    isThinking={regeneratingMessageId === msg.id}
                    activeLabel={
                      regeneratingMessageId === msg.id && activeThinking
                        ? activeThinking.activeLabel
                        : 'Re-evaluating chamber telemetry'
                    }
                    settledDurationS={msg.thoughtDurationS}
                    steps={
                      regeneratingMessageId === msg.id && activeThinking
                        ? activeThinking.steps
                        : msg.thoughtSteps
                    }
                    stepIntervalMs={
                      regeneratingMessageId === msg.id && activeThinking
                        ? activeThinking.stepIntervalMs
                        : 280
                    }
                    defaultExpanded={false}
                  />
                )}
                <div className="px-0.5">{renderStructuredAssistantBody(msg.content)}</div>

                {snap && (
                  <div
                    data-testid={`telemetry-match-card-${msg.id}`}
                    className="rounded-xl border border-[#1F1F24] bg-[#111114] px-3.5 py-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0 font-mono text-xs tabular-nums text-[#E4E4E7]">
                        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${getHazardDot(snap.hazardLevel)}`} />
                        <span className="truncate">
                          Matched <strong className="text-[#F4F4F5]">{snap.experiment.id}</strong> · Spread{' '}
                          {snap.spreadLabel} · LOI Margin {snap.loiMarginLabel}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedCards((prev) => ({ ...prev, [msg.id]: !prev[msg.id] }))
                          }
                          aria-expanded={isInspected}
                          className="rounded-lg border border-[#27272A] bg-[#18181C] px-2.5 py-1 text-[11px] font-medium text-[#E4E4E7] hover:border-[#3F3F46] cursor-pointer"
                        >
                          {isInspected ? 'Close' : 'Inspect'}
                        </button>
                        <button
                          type="button"
                          onClick={() => onLoadExperiment(snap.experiment)}
                          className="rounded-lg border border-[#27272A] bg-[#18181C] px-2.5 py-1 text-[11px] font-medium text-[#A1A1AA] hover:border-[#3F3F46] hover:text-[#F4F4F5] cursor-pointer"
                        >
                          Load Run
                        </button>
                      </div>
                    </div>

                    {isInspected && (
                      <div className="mt-2.5 border-t border-[#1F1F24] pt-2.5 flex flex-col gap-2 text-xs text-[#A1A1AA]">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px] tabular-nums">
                          <div className={expBurn ? '' : 'col-span-2'}>
                            <span className="text-[#71717A]">Burn </span>
                            <span className="text-[#E4E4E7]">
                              {expBurnDisplay}
                            </span>
                          </div>
                          <div>
                            <span className="text-[#71717A]">Observed </span>
                            <span className="text-[#E4E4E7]">
                              {expSpread ? `${expSpread.text} ${expSpread.unit}` : 'Criterion <= 152 mm'}
                            </span>
                          </div>
                          <div>
                            <span className="text-[#71717A]">Flow </span>
                            <span className="text-[#E4E4E7]">
                              {expVel.text} {expVel.unit}
                            </span>
                          </div>
                          <div>
                            <span className="text-[#71717A]">Pressure </span>
                            <span className="text-[#E4E4E7]">
                              {expPress.text} {expPress.unit}
                            </span>
                          </div>
                        </div>
                        <p className="leading-relaxed">
                          <span className="font-medium text-[#F4F4F5]">Flight Note: </span>
                          {exp.discrepancyNote1gVsUg}
                        </p>
                        <div className="font-mono text-[10.5px] text-[#71717A]">
                          {exp.psiInvestigationId && exp.doi
                            ? `${exp.psiInvestigationId} · DOI ${exp.doi} (${exp.license ?? 'CC0-1.0'}) · `
                            : ''}
                          {MATERIALS[exp.materialId].shortName} · {exp.sampleThicknessMm}mm
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-3 text-[11px] text-[#71717A]">
                  <button
                    type="button"
                    onClick={() => handleCopy(msg.id, msg.content)}
                    className="inline-flex items-center gap-1 hover:text-[#F4F4F5] cursor-pointer"
                  >
                    <HugeiconsIcon
                      icon={copiedId === msg.id ? Tick01Icon : Copy01Icon}
                      size={12}
                      strokeWidth={1.5}
                    />
                    <span>{copiedId === msg.id ? 'Copied' : 'Copy'}</span>
                  </button>

                  <button
                    type="button"
                    disabled={isGenerating}
                    onClick={() => onRegenerateMessage(msg.id)}
                    className="inline-flex items-center gap-1 hover:text-[#F4F4F5] disabled:opacity-40 cursor-pointer"
                  >
                    <HugeiconsIcon icon={RotateLeft01Icon} size={12} strokeWidth={1.5} />
                    <span>Regenerate</span>
                  </button>

                  <span
                    data-testid={`safety-msg-source-${msg.id}`}
                    className="rounded border border-[#27272A] bg-[#141418] px-2 py-0.5 font-mono text-[10px] text-[#A1A1AA]"
                  >
                    {msg.source}
                  </span>
                </div>
              </article>
            );
          })}

          {activeThinking && !regeneratingMessageId && (
            <article data-testid="safety-thinking-block" className="flex flex-col gap-2">
              <ThoughtLine
                testId="active-safety-thought-line"
                isThinking
                activeLabel={activeThinking.activeLabel}
                steps={activeThinking.steps}
                stepIntervalMs={activeThinking.stepIntervalMs}
              />
            </article>
          )}
        </div>
      )}
    </main>
  );
};
