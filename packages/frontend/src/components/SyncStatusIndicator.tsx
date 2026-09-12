import React from 'react';
import type { SyncStatus } from '../lib/HttpSyncProvider';

const LABELS: Record<SyncStatus, string> = {
  loading: 'Loading',
  saving: 'Saving…',
  saved: 'Saved',
  offline: 'Offline — retrying',
  unauthorized: 'Signed out',
};

const DOTS: Record<SyncStatus, string> = {
  loading: 'bg-stone-light animate-pulse',
  saving: 'bg-ai animate-pulse',
  saved: 'bg-moss',
  offline: 'bg-kaki animate-pulse',
  unauthorized: 'bg-shu',
};

export const SyncStatusIndicator: React.FC<{ status: SyncStatus }> = ({ status }) => (
  <>
    <span className={`w-2 h-2 rounded-full ${DOTS[status]}`} />
    <span className="text-[11px] text-stone">{LABELS[status]}</span>
  </>
);
