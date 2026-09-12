import React, { useEffect, useRef } from 'react';
import { Crepe } from '@milkdown/crepe';
import { Milkdown, useEditor } from '@milkdown/react';
import { collab, collabServiceCtx } from '@milkdown/plugin-collab';
import type * as Y from 'yjs';
import type { HttpSyncProvider } from '../../lib/HttpSyncProvider';

import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';

interface MeetingLogEditorProps {
  /** Shared ProseMirror fragment holding the current section's notes. */
  fragment: Y.XmlFragment;
  /** Board sync provider; supplies the doc's sync signal and a local awareness. */
  provider: HttpSyncProvider;
}

export const MeetingLogEditor: React.FC<MeetingLogEditorProps> = ({ fragment, provider }) => {
  const crepeRef = useRef<Crepe | null>(null);

  const { loading } = useEditor(
    (root) => {
      const crepe = new Crepe({
        root,
        defaultValue: '',
        features: {
          // @ts-expect-error CrepeFeature keys vary across bundled versions.
          sourceEditor: false,
        },
      });

      crepe.editor.use(collab);
      crepeRef.current = crepe;
      return crepe;
    },
    [fragment, provider]
  );

  // The collab service binds its ctx only after the editor view exists, so
  // connecting during `.config()` would throw and leave the editor dead.
  // Connect once creation and the provider's initial sync are both done.
  useEffect(() => {
    if (loading) return undefined;
    const crepe = crepeRef.current;
    if (!crepe) return undefined;

    const connectCollab = (isSynced: boolean) => {
      if (!isSynced) return;
      crepe.editor.action((ctx) => {
        // Binding the section's fragment (rather than a whole doc) lets every
        // section live in the one board document.
        ctx.get(collabServiceCtx).bindXmlFragment(fragment).setAwareness(provider.awareness).connect();
      });
    };

    if (provider.synced) connectCollab(true);
    else provider.on('sync', connectCollab);
    return () => provider.off('sync', connectCollab);
  }, [loading, fragment, provider]);

  return (
    <div className="board-meeting-log h-80 overflow-y-auto rounded-lg border border-line bg-paper px-4 py-3 transition focus-within:border-ai">
      <Milkdown />
    </div>
  );
};

export default MeetingLogEditor;
