import React, { useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Download01Icon } from '@hugeicons/core-free-icons';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#27272A] bg-[#18181C] px-2.5 py-1.5 text-xs font-medium text-[#E4E4E7] transition-colors hover:border-[#3F3F46] whitespace-nowrap shrink-0 cursor-pointer"
        aria-label="Install PWA application"
      >
        <HugeiconsIcon icon={Download01Icon} size={13} strokeWidth={1.5} className="text-[#A1A1AA]" />
        <span>Install PWA</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#27272A] bg-[#18181C] px-2.5 py-1.5 text-xs font-medium text-[#E4E4E7] transition-colors hover:border-[#3F3F46] whitespace-nowrap shrink-0 cursor-pointer"
          aria-label="Install on iOS instructions"
        >
          <HugeiconsIcon icon={Download01Icon} size={13} strokeWidth={1.5} className="text-[#A1A1AA]" />
          <span>Install App</span>
        </button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
            role="dialog"
            aria-modal="true"
            aria-label="iOS Installation Guide"
          >
            <div className="w-full max-w-sm rounded-xl border border-[#27272A] bg-[#111114] p-5">
              <h3 className="text-sm font-semibold text-[#F4F4F5]">Install on iPhone / iPad</h3>
              <p className="mt-2 text-xs leading-relaxed text-[#A1A1AA]">
                1. Open the Safari Share menu.<br />
                2. Select <span className="text-[#F4F4F5] font-medium">Add to Home Screen</span> for offline telemetry access.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-4 w-full rounded-lg border border-[#27272A] bg-[#18181C] py-2 text-xs font-medium text-[#E4E4E7] hover:border-[#3F3F46] cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
