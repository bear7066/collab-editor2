import React from 'react';
import { Crepe } from '@milkdown/crepe';
import { EditorStatus } from '@milkdown/core';
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
  /** Stores a pasted/dropped image and returns the URL Milkdown should embed. */
  onUploadFile: (file: File) => Promise<string>;
  /** Taller layout for a notes-only section, where this editor is the whole page. */
  tall?: boolean;
}

export const MeetingLogEditor: React.FC<MeetingLogEditorProps> = ({ fragment, provider, onUploadFile, tall = false }) => {
  useEditor(
    (root) => {
      const crepe = new Crepe({
        root,
        defaultValue: '',
        features: {
          // @ts-expect-error CrepeFeature keys vary across bundled versions.
          sourceEditor: false,
        },
        featureConfigs: {
          'image-block': { onUpload: onUploadFile, inlineOnUpload: onUploadFile, blockOnUpload: onUploadFile },
        },
      });

      crepe.editor.use(collab).onStatusChange((status) => {
        if (status !== EditorStatus.Created) return;
        crepe.editor.action((ctx) => {
          // The board is rendered only after its provider has completed the
          // initial sync. Connecting at EditorStatus.Created avoids a React
          // StrictMode race where `loading` could describe a stale editor.
          ctx.get(collabServiceCtx).bindXmlFragment(fragment).setAwareness(provider.awareness).connect();
        });
      });
      return crepe;
    },
    [fragment, provider, onUploadFile]
  );

  return (
    <div
      className={`board-meeting-log ${tall ? 'h-[70vh] min-h-[24rem]' : 'h-44'} overflow-y-auto rounded-lg border border-line bg-paper px-4 py-3 transition focus-within:border-ai`}
    >
      <Milkdown />
    </div>
  );
};

export default MeetingLogEditor;
