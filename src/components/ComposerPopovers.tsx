import React, { useEffect, useRef, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Tick01Icon } from '@hugeicons/core-free-icons';
import {
  CUSTOM_DURATION_PRESETS,
  DUCT_SCALES,
  GRAVITY_LEVELS,
  MATERIALS,
  MISSION_PRESETS,
  resolveDuctHardware,
  resolveDuctScale,
  resolveSpecimenGeometry,
  SPECIMEN_GEOMETRIES,
  TEST_DURATION_OPTIONS,
  type DuctHardwareConfig,
  type DuctScale,
  type FlowMode,
  type MaterialId,
  type MissionPreset,
  type SimulationParams,
  type SpecimenGeometry,
  type TestDurationMode,
  type ThermoTelemetry,
} from '../engine/thermoCore';
import {
  clampDurationSeconds,
  clampGravityG,
  formatGravity,
  formatPressure,
  formatVelocity,
  gToMs2,
  MAX_GRAVITY_G,
  ms2ToG,
  pressureFromDisplay,
  UNIT_SYSTEMS,
  velocityFromDisplay,
  type UnitSystem,
} from '../engine/units';

const GRAVITY_SHORT_LABELS: Record<string, string> = {
  '0g': '0g',
  moon: 'Moon',
  mars: 'Mars',
  earth: '1g',
};

interface PresetPopoverProps {
  activePresetId: string | null;
  unitSystem: UnitSystem;
  onSelectPreset: (preset: MissionPreset) => void;
  onClose: () => void;
}

export const PresetPopover: React.FC<PresetPopoverProps> = ({
  activePresetId,
  unitSystem,
  onSelectPreset,
  onClose,
}) => {
  return (
    <div
      role="menu"
      aria-label="Select NASA Mission Preset"
      data-testid="composer-preset-popover"
      style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, zIndex: 50 }}
      className="w-72 rounded-xl border border-[#27272A] bg-[#111114]/95 p-1.5 backdrop-blur-xl shadow-2xl"
    >
      <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-[#71717A]">
        NASA Mission Presets
      </div>
      <div className="flex flex-col gap-0.5">
        {MISSION_PRESETS.map((preset) => {
          const isActive = activePresetId === preset.id;
          const velFmt = formatVelocity(preset.params.flowVelocityMs, unitSystem);
          const gRatio = ms2ToG(preset.params.gravityMs2);
          const gText = gRatio < 0.01 ? '0g' : `${gRatio.toFixed(gRatio === 1 ? 0 : 2)}g`;

          return (
            <button
              key={preset.id}
              type="button"
              role="menuitemradio"
              aria-checked={isActive}
              data-testid={`composer-preset-item-${preset.id}`}
              onClick={() => {
                onSelectPreset(preset);
                onClose();
              }}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition-colors cursor-pointer ${
                isActive ? 'bg-[#18181C] text-[#F4F4F5]' : 'text-[#D4D4D8] hover:bg-[#18181C]'
              }`}
            >
              <div className="min-w-0">
                <div className="text-xs font-medium text-[#F4F4F5] truncate">{preset.label}</div>
                <div className="mt-0.5 font-mono text-[10.5px] tabular-nums text-[#71717A]">
                  {preset.params.o2Percent.toFixed(1)}% O2 · {velFmt.text} {velFmt.unit} · {gText}
                </div>
              </div>
              {isActive && (
                <HugeiconsIcon
                  icon={Tick01Icon}
                  size={13}
                  strokeWidth={1.5}
                  className="text-[#F4F4F5] shrink-0"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

interface QuickEditableValueProps {
  ariaLabel: string;
  displayText: string;
  unitText: string;
  editInitialValue: string;
  onCommit: (val: number) => void;
}

const QuickEditableValue: React.FC<QuickEditableValueProps> = ({
  ariaLabel,
  displayText,
  unitText,
  editInitialValue,
  onCommit,
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(editInitialValue);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    const parsed = Number(trimmed);
    if (trimmed !== '' && Number.isFinite(parsed)) {
      onCommit(parsed);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="inline-flex items-center gap-1 rounded-md border border-[#52525B] bg-[#09090B] px-1.5 py-0.5">
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          aria-label={ariaLabel}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setEditing(false);
            }
          }}
          className="w-12 bg-transparent text-right font-mono text-xs tabular-nums font-medium text-[#F4F4F5] focus:outline-none"
        />
        <span className="font-mono text-[11px] text-[#71717A]">{unitText}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(editInitialValue);
        setEditing(true);
      }}
      aria-label={`${ariaLabel} (click to edit)`}
      title="Click to enter exact value"
      className="rounded-md border border-transparent px-1.5 py-0.5 font-mono text-xs tabular-nums font-medium text-[#F4F4F5] hover:border-[#27272A] hover:bg-[#18181C] cursor-text"
    >
      {displayText} {unitText}
    </button>
  );
};

interface QuickTunePopoverProps {
  params: SimulationParams;
  telemetry: ThermoTelemetry;
  unitSystem: UnitSystem;
  testDuration: TestDurationMode;
  anchorLeftPx: number;
  onChangeParams: (patch: Partial<SimulationParams>) => void;
  onChangeTestDuration: (next: TestDurationMode) => void;
  onChangeUnitSystem: (unit: UnitSystem) => void;
}

export const QuickTunePopover: React.FC<QuickTunePopoverProps> = ({
  params,
  telemetry,
  unitSystem,
  testDuration,
  anchorLeftPx,
  onChangeParams,
  onChangeTestDuration,
  onChangeUnitSystem,
}) => {
  const matchedGravityPreset = GRAVITY_LEVELS.find(
    (lvl) => Math.abs(params.gravityMs2 - lvl.valueMs2) < 0.015,
  );
  const [customGravityOpen, setCustomGravityOpen] = useState(!matchedGravityPreset);

  const isStandardDuration =
    testDuration === 30 ||
    testDuration === 60 ||
    testDuration === 180 ||
    testDuration === 'Continuous';
  const [customDurationOpen, setCustomDurationOpen] = useState(!isStandardDuration);

  const gValue = ms2ToG(params.gravityMs2);
  const [customGravDraft, setCustomGravDraft] = useState(gValue.toFixed(3));
  const [customGravFocused, setCustomGravFocused] = useState(false);

  useEffect(() => {
    if (!customGravFocused) {
      setCustomGravDraft(ms2ToG(params.gravityMs2).toFixed(3));
    }
  }, [params.gravityMs2, customGravFocused]);

  const [customDurDraft, setCustomDurDraft] = useState(
    testDuration === 'Continuous' ? '60' : String(testDuration),
  );
  const [customDurFocused, setCustomDurFocused] = useState(false);

  useEffect(() => {
    if (!customDurFocused && testDuration !== 'Continuous') {
      setCustomDurDraft(String(testDuration));
    }
  }, [testDuration, customDurFocused]);

  const showCustomGravity = customGravityOpen || !matchedGravityPreset;
  const showCustomDuration = customDurationOpen || !isStandardDuration;

  const pressureFmt = formatPressure(params.pressurePa, unitSystem);
  const velocityFmt = formatVelocity(params.flowVelocityMs, unitSystem);
  const gravityFmt = formatGravity(params.gravityMs2, unitSystem);

  const pressureMin = unitSystem === 'hvac-us' ? 5.8 : 40.0;
  const pressureMax = unitSystem === 'hvac-us' ? 15.95 : 110.0;
  const pressureStep = unitSystem === 'hvac-us' ? 0.05 : 0.5;
  const pressureSliderVal =
    unitSystem === 'hvac-us'
      ? Number(pressureFmt.value.toFixed(2))
      : Number((params.pressurePa / 1000).toFixed(1));

  const velMin = 0;
  const velMax = unitSystem === 'nasa-psi' ? 50 : unitSystem === 'hvac-us' ? 98.4 : 0.5;
  const velStep = unitSystem === 'nasa-psi' ? 0.5 : unitSystem === 'hvac-us' ? 0.5 : 0.005;

  const customGravityConvertedLabel =
    unitSystem === 'nasa-psi' && gValue < 0.001
      ? `${Math.max(1.0, gValue * 1_000_000).toFixed(0)} μg`
      : `${params.gravityMs2.toFixed(3)} m/s²`;

  const durationReadout =
    testDuration === 'Continuous'
      ? 'Loop'
      : testDuration === 60
        ? '60s · NASA-STD-6001'
        : testDuration === 180
          ? '180s · Saffire'
          : `${Number.isInteger(testDuration) ? testDuration : testDuration.toFixed(1)}s`;

  return (
    <div
      role="dialog"
      aria-label="Quick-Tune Chamber Parameters"
      data-testid="composer-quick-tune-popover"
      style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: anchorLeftPx, zIndex: 50 }}
      className="w-[380px] max-w-[90vw] max-h-[min(80vh,580px)] overflow-y-auto rounded-xl border border-[#27272A] bg-[#111114]/95 p-3.5 backdrop-blur-xl shadow-2xl"
    >
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#1F1F24]">
        <span className="text-[10.5px] font-mono uppercase tracking-wider text-[#A1A1AA]">
          Quick-Tune Chamber
        </span>
        <span className="text-[10.5px] font-mono tabular-nums text-[#71717A]">
          ppO2 {(telemetry.o2PartialPressurePa / 1000).toFixed(1)} kPa
        </span>
      </div>

      <div className="mt-2.5 flex flex-col gap-2.5">
        {/* Ambient O2 % */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label htmlFor="quick-slider-o2" className="text-xs text-[#A1A1AA]">
              Ambient O2
            </label>
            <QuickEditableValue
              ariaLabel="Edit Ambient O2 percent"
              displayText={params.o2Percent.toFixed(1)}
              unitText="%"
              editInitialValue={params.o2Percent.toFixed(1)}
              onCommit={(val) =>
                onChangeParams({
                  o2Percent: Math.round(Math.max(12, Math.min(40, val)) * 10) / 10,
                })
              }
            />
          </div>
          <input
            id="quick-slider-o2"
            type="range"
            min={12}
            max={40}
            step={0.5}
            value={params.o2Percent}
            onChange={(e) => onChangeParams({ o2Percent: Number(e.target.value) })}
            className="telemetry-slider w-full"
          />
        </div>

        {/* Cabin Pressure */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label htmlFor="quick-slider-pressure" className="text-xs text-[#A1A1AA]">
              Cabin Pressure
            </label>
            <QuickEditableValue
              ariaLabel={`Edit Cabin Pressure (${pressureFmt.unit})`}
              displayText={pressureFmt.text}
              unitText={pressureFmt.unit}
              editInitialValue={pressureFmt.text}
              onCommit={(val) => {
                const pa = pressureFromDisplay(val, unitSystem);
                onChangeParams({
                  pressurePa: Math.max(40000, Math.min(110000, pa)),
                });
              }}
            />
          </div>
          <input
            id="quick-slider-pressure"
            type="range"
            min={pressureMin}
            max={pressureMax}
            step={pressureStep}
            value={pressureSliderVal}
            onChange={(e) => {
              const raw = Number(e.target.value);
              const pa =
                unitSystem === 'hvac-us'
                  ? pressureFromDisplay(raw, 'hvac-us')
                  : raw * 1000;
              onChangeParams({
                pressurePa: Math.max(40000, Math.min(110000, pa)),
              });
            }}
            className="telemetry-slider w-full"
          />
        </div>

        {/* HVAC Velocity */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label htmlFor="quick-slider-velocity" className="text-xs text-[#A1A1AA]">
              HVAC Velocity
            </label>
            <QuickEditableValue
              ariaLabel={`Edit HVAC Velocity (${velocityFmt.unit})`}
              displayText={velocityFmt.text}
              unitText={velocityFmt.unit}
              editInitialValue={velocityFmt.text}
              onCommit={(val) => {
                const ms = velocityFromDisplay(val, unitSystem);
                onChangeParams({
                  flowVelocityMs: Math.max(0, Math.min(0.5, ms)),
                });
              }}
            />
          </div>
          <input
            id="quick-slider-velocity"
            type="range"
            min={velMin}
            max={velMax}
            step={velStep}
            value={Number(velocityFmt.value.toFixed(3))}
            onChange={(e) => {
              const ms = velocityFromDisplay(Number(e.target.value), unitSystem);
              onChangeParams({
                flowVelocityMs: Math.max(0, Math.min(0.5, ms)),
              });
            }}
            className="telemetry-slider w-full"
          />
        </div>

        {/* Gravity Segmented Control */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#A1A1AA]">Gravity</span>
            <span className="font-mono text-[11px] tabular-nums text-[#A1A1AA]">
              {gravityFmt.text} {gravityFmt.unit}
            </span>
          </div>
          <div
            role="group"
            aria-label="Quick-Tune Gravity"
            className="grid grid-cols-5 gap-0.5 rounded-full border border-[#27272A] bg-[#09090B] p-0.5"
          >
            {GRAVITY_LEVELS.map((lvl) => {
              const active = !showCustomGravity && matchedGravityPreset?.id === lvl.id;
              return (
                <button
                  key={lvl.id}
                  type="button"
                  onClick={() => {
                    setCustomGravityOpen(false);
                    onChangeParams({ gravityMs2: lvl.valueMs2 });
                  }}
                  aria-pressed={active}
                  className={`rounded-full py-1 text-[10.5px] font-mono transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#27272A] text-[#F4F4F5] font-medium'
                      : 'text-[#71717A] hover:text-[#E4E4E7]'
                  }`}
                >
                  {GRAVITY_SHORT_LABELS[lvl.id]}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setCustomGravityOpen(true)}
              aria-pressed={showCustomGravity}
              className={`rounded-full py-1 text-[10.5px] font-mono transition-colors cursor-pointer ${
                showCustomGravity
                  ? 'bg-[#27272A] text-[#F4F4F5] font-medium'
                  : 'text-[#71717A] hover:text-[#E4E4E7]'
              }`}
            >
              Custom
            </button>
          </div>

          {showCustomGravity && (
            <div className="rounded-lg border border-[#27272A] bg-[#09090B]/70 px-2.5 py-2 flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex items-center gap-1 rounded-md border border-[#27272A] bg-[#18181C] px-2 py-0.5">
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label="Quick-Tune Custom Gravity in g"
                    value={customGravDraft}
                    onFocus={(e) => {
                      setCustomGravFocused(true);
                      e.currentTarget.select();
                    }}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setCustomGravDraft(raw);
                      const num = Number(raw.trim());
                      if (raw.trim() !== '' && Number.isFinite(num) && num >= 0 && num <= MAX_GRAVITY_G) {
                        onChangeParams({ gravityMs2: gToMs2(num) });
                      }
                    }}
                    onBlur={() => {
                      setCustomGravFocused(false);
                      const num = Number(customGravDraft.trim());
                      const clampedG =
                        customGravDraft.trim() !== '' && Number.isFinite(num)
                          ? clampGravityG(num)
                          : clampGravityG(gValue);
                      setCustomGravDraft(clampedG.toFixed(3));
                      onChangeParams({ gravityMs2: gToMs2(clampedG) });
                    }}
                    className="w-14 bg-transparent text-xs font-mono tabular-nums text-[#F4F4F5] focus:outline-none"
                  />
                  <span className="text-[11px] font-mono text-[#71717A]">g</span>
                </div>
                <span className="text-[11px] font-mono tabular-nums text-[#A1A1AA]">
                  {customGravityConvertedLabel}
                </span>
              </div>
              <input
                type="range"
                aria-label="Quick-Tune Custom Gravity Slider"
                min={0}
                max={MAX_GRAVITY_G}
                step={0.005}
                value={clampGravityG(gValue)}
                onChange={(e) => {
                  const nextG = clampGravityG(Number(e.target.value));
                  setCustomGravDraft(nextG.toFixed(3));
                  onChangeParams({ gravityMs2: gToMs2(nextG) });
                }}
                className="telemetry-slider w-full"
              />
            </div>
          )}
        </div>

        {/* Test Duration Segmented Control */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#A1A1AA]">Test Duration</span>
            <span className="font-mono text-[11px] tabular-nums text-[#A1A1AA]">
              {durationReadout}
            </span>
          </div>
          <div
            role="group"
            aria-label="Quick-Tune Test Duration"
            className="grid grid-cols-5 gap-0.5 rounded-full border border-[#27272A] bg-[#09090B] p-0.5"
          >
            {TEST_DURATION_OPTIONS.map((opt) => {
              const active = !showCustomDuration && testDuration === opt.value;
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => {
                    setCustomDurationOpen(false);
                    onChangeTestDuration(opt.value);
                  }}
                  aria-pressed={active}
                  className={`rounded-full py-1 text-[10.5px] font-mono transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-[#27272A] text-[#F4F4F5] font-medium'
                      : 'text-[#71717A] hover:text-[#E4E4E7]'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => {
                setCustomDurationOpen(true);
                if (testDuration === 'Continuous') {
                  onChangeTestDuration(60);
                }
              }}
              aria-pressed={showCustomDuration}
              className={`rounded-full py-1 text-[10.5px] font-mono transition-colors cursor-pointer whitespace-nowrap ${
                showCustomDuration
                  ? 'bg-[#27272A] text-[#F4F4F5] font-medium'
                  : 'text-[#71717A] hover:text-[#E4E4E7]'
              }`}
            >
              Custom
            </button>
          </div>

          {showCustomDuration && (
            <div className="rounded-lg border border-[#27272A] bg-[#09090B]/70 px-2.5 py-2 flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex items-center gap-1 rounded-md border border-[#27272A] bg-[#18181C] px-2 py-0.5">
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label="Quick-Tune Custom Duration Seconds"
                    value={customDurDraft}
                    onFocus={(e) => {
                      setCustomDurFocused(true);
                      e.currentTarget.select();
                    }}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setCustomDurDraft(raw);
                      const num = Number(raw.trim());
                      if (raw.trim() !== '' && Number.isFinite(num) && num >= 2 && num <= 600) {
                        onChangeTestDuration(clampDurationSeconds(num));
                      }
                    }}
                    onBlur={() => {
                      setCustomDurFocused(false);
                      const num = Number(customDurDraft.trim());
                      const fallback = testDuration === 'Continuous' ? 60 : testDuration;
                      const nextSec =
                        customDurDraft.trim() !== '' && Number.isFinite(num)
                          ? clampDurationSeconds(num)
                          : fallback;
                      setCustomDurDraft(String(nextSec));
                      onChangeTestDuration(nextSec);
                    }}
                    className="w-12 bg-transparent text-xs font-mono tabular-nums text-[#F4F4F5] focus:outline-none"
                  />
                  <span className="text-[11px] font-mono text-[#71717A]">s</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {CUSTOM_DURATION_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => {
                        setCustomDurationOpen(true);
                        setCustomDurDraft(String(preset.value));
                        onChangeTestDuration(preset.value);
                      }}
                      className={`rounded-md border px-1.5 py-0.5 text-[10px] font-mono tabular-nums cursor-pointer ${
                        testDuration === preset.value
                          ? 'border-[#52525B] bg-[#27272A] text-[#F4F4F5]'
                          : 'border-[#27272A] bg-[#18181C] text-[#A1A1AA] hover:text-[#F4F4F5]'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Fuel & Duct Configuration inside Quick-Tune Popover */}
        <div className="pt-2 border-t border-[#1F1F24] flex flex-col gap-2">
          <span className="text-[10.5px] font-mono uppercase tracking-wider text-[#71717A]">
            Fuel &amp; Duct Configuration
          </span>

          <div className="grid grid-cols-2 gap-1.5">
            <select
              aria-label="Quick-Tune Material"
              value={params.materialId}
              onChange={(e) => onChangeParams({ materialId: e.target.value as MaterialId })}
              className="rounded-lg border border-[#27272A] bg-[#18181C] px-2 py-1 text-[11px] font-medium text-[#F4F4F5] focus:outline-none cursor-pointer"
            >
              {Object.values(MATERIALS).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.shortName}
                </option>
              ))}
            </select>

            <div className="grid grid-cols-2 gap-0.5 rounded-lg border border-[#27272A] bg-[#09090B] p-0.5">
              {(['opposed', 'concurrent'] as FlowMode[]).map((mode) => {
                const active = params.flowMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onChangeParams({ flowMode: mode })}
                    aria-pressed={active}
                    className={`rounded-md py-0.5 text-[10px] font-mono cursor-pointer ${
                      active ? 'bg-[#27272A] text-[#F4F4F5]' : 'text-[#71717A] hover:text-[#E4E4E7]'
                    }`}
                  >
                    {mode === 'opposed' ? 'Opposed' : 'Concur'}
                  </button>
                );
              })}
            </div>
          </div>

          <div role="radiogroup" aria-label="Quick-Tune Specimen Geometry" className="grid grid-cols-2 gap-1">
            {(Object.keys(SPECIMEN_GEOMETRIES) as SpecimenGeometry[]).map((geomId) => {
              const spec = SPECIMEN_GEOMETRIES[geomId];
              const active = resolveSpecimenGeometry(params) === geomId;
              return (
                <button
                  key={geomId}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-testid={`quick-geometry-btn-${geomId}`}
                  onClick={() => onChangeParams({ specimenGeometry: geomId })}
                  className={`rounded-lg border px-2 py-1 text-left transition-colors cursor-pointer ${
                    active
                      ? 'border-[#52525B] bg-[#27272A] text-[#F4F4F5]'
                      : 'border-[#27272A] bg-[#09090B] text-[#A1A1AA] hover:text-[#E4E4E7]'
                  }`}
                >
                  <div className="text-[10.5px] font-medium leading-tight">{spec.shortLabel}</div>
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-2 pt-0.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#71717A]">
              Duct Scale
            </span>
            <div
              role="radiogroup"
              aria-label="Quick-Tune Duct Scale"
              className="grid grid-cols-2 gap-0.5 rounded-lg border border-[#27272A] bg-[#09090B] p-0.5"
            >
              {(Object.keys(DUCT_SCALES) as DuctScale[]).map((scaleId) => {
                const spec = DUCT_SCALES[scaleId];
                const active = resolveDuctScale(params) === scaleId;
                return (
                  <button
                    key={scaleId}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    data-testid={`quick-duct-scale-btn-${scaleId}`}
                    title={spec.label}
                    onClick={() => onChangeParams({ ductScale: scaleId })}
                    className={`rounded-md px-2 py-0.5 text-[10px] font-mono cursor-pointer ${
                      active ? 'bg-[#27272A] text-[#F4F4F5]' : 'text-[#71717A] hover:text-[#E4E4E7]'
                    }`}
                  >
                    {spec.shortLabel}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1 pt-0.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#71717A]">
              Hardware Add-ons
            </span>
            <div role="group" aria-label="Hardware Add-ons" className="grid grid-cols-3 gap-1">
              {(
                [
                  { key: 'wakeBaffle' as keyof DuctHardwareConfig, label: 'Wake Baffle' },
                  { key: 'flameArrestor' as keyof DuctHardwareConfig, label: 'Arrestor' },
                  { key: 'inertNozzle' as keyof DuctHardwareConfig, label: 'N2 Nozzle' },
                ] as const
              ).map((item) => {
                const hw = resolveDuctHardware(params);
                const enabled = hw[item.key];
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    data-testid={`quick-hardware-toggle-${item.key}`}
                    onClick={() =>
                      onChangeParams({
                        hardware: {
                          [item.key]: !enabled,
                        } as unknown as DuctHardwareConfig,
                      })
                    }
                    className={`relative bg-transparent border-0 px-2.5 py-1.5 text-xs font-medium transition-all cursor-pointer truncate ${
                      enabled
                        ? 'text-[#F4F4F5]'
                        : 'text-[#71717A] hover:text-[#D4D4D8]'
                    }`}
                  >
                    {enabled && (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-x-2.5 bottom-0 h-2.5 bg-[radial-gradient(50%_100%_at_50%_100%,rgba(244,244,245,0.05)_0%,transparent_100%)]"
                      />
                    )}
                    <span className="relative z-10">{item.label}</span>
                    {enabled && (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute bottom-0.5 left-1/2 -translate-x-1/2 w-3.5 h-px bg-gradient-to-r from-transparent via-[#E4E4E7]/45 to-transparent"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Unit System Switcher */}
        <div className="pt-2 border-t border-[#1F1F24] flex items-center justify-between gap-2">
          <span className="text-[10.5px] font-mono uppercase tracking-wider text-[#71717A]">
            Units
          </span>
          <div
            role="group"
            aria-label="Quick-Tune Telemetry Unit System"
            className="grid grid-cols-3 gap-0.5 rounded-lg border border-[#27272A] bg-[#09090B] p-0.5"
          >
            {UNIT_SYSTEMS.map((u) => {
              const active = unitSystem === u.id;
              const label =
                u.id === 'nasa-psi' ? 'NASA PSI' : u.id === 'si-thermo' ? 'SI' : 'HVAC US';
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => onChangeUnitSystem(u.id)}
                  aria-pressed={active}
                  className={`rounded-md px-2 py-1 text-[10px] font-mono transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-[#27272A] text-[#F4F4F5] font-medium'
                      : 'text-[#71717A] hover:text-[#E4E4E7]'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
