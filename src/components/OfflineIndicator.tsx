import React from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { WifiDisconnected01Icon } from '@hugeicons/core-free-icons';
import { useOnlineStatus } from '../hooks/usePWAInstall';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-3 left-3 z-50 flex items-center gap-2 rounded-lg border border-[#27272A] bg-[#111114]/95 px-3 py-1.5 text-xs font-mono text-[#E4E4E7]"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
      <HugeiconsIcon icon={WifiDisconnected01Icon} size={13} strokeWidth={1.5} className="text-[#A1A1AA]" />
      <span>Offline Mode — Local Physics &amp; Cached PSI Data Active</span>
    </div>
  );
};
