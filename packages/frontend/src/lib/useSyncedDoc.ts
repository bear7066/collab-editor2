import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { HttpSyncProvider, type DocKind, type SyncStatus } from './HttpSyncProvider';

interface SyncedDoc {
  doc: Y.Doc | null;
  provider: HttpSyncProvider | null;
  status: SyncStatus;
  synced: boolean;
}

/** One Y.Doc per document, synced over HTTP for as long as the component is mounted. */
export function useSyncedDoc(kind: DocKind, name: string | undefined): SyncedDoc {
  const [state, setState] = useState<SyncedDoc>({ doc: null, provider: null, status: 'loading', synced: false });

  useEffect(() => {
    if (!name) return undefined;

    const doc = new Y.Doc();
    const provider = new HttpSyncProvider(doc, { kind, name });
    setState({ doc, provider, status: provider.status, synced: provider.synced });

    const handleStatus = (status: SyncStatus) => setState((prev) => ({ ...prev, status }));
    const handleSync = (synced: boolean) => setState((prev) => ({ ...prev, synced }));
    provider.on('status', handleStatus);
    provider.on('sync', handleSync);

    const warnIfUnsaved = (event: BeforeUnloadEvent) => {
      if (!provider.hasPendingChanges()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnIfUnsaved);

    return () => {
      window.removeEventListener('beforeunload', warnIfUnsaved);
      provider.destroy();
      doc.destroy();
      setState({ doc: null, provider: null, status: 'loading', synced: false });
    };
  }, [kind, name]);

  return state;
}
