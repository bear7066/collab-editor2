import { forwardRef, useImperativeHandle, useRef } from 'react';
import { Crepe } from '@milkdown/crepe';
import { Milkdown, useEditor } from '@milkdown/react';
import { collab, collabServiceCtx } from '@milkdown/plugin-collab';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { replaceAll, getMarkdown } from '@milkdown/kit/utils';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';

interface MilkdownEditorProps {
  doc: Y.Doc;
  provider: WebsocketProvider;
  onMarkdownChange: (markdown: string) => void;
}

export interface MilkdownEditorRef {
  /** Replace the entire editor content with the given Markdown string (updates Yjs). */
  replaceContent: (markdown: string) => void;
  /** Read the current Markdown directly from ProseMirror state (always fresh). */
  getContent: () => string;
}

export const MilkdownEditor = forwardRef<MilkdownEditorRef, MilkdownEditorProps>(
  ({ doc, provider, onMarkdownChange }, ref) => {
    const crepeRef = useRef<Crepe | null>(null);

    useEditor(
      (root) => {
        const crepe = new Crepe({
          root,
          defaultValue: '',
          // Disable the built-in source editor so our header toggle is the sole way to switch
          features: {
            // @ts-expect-error — CrepeFeature enum may vary by build; graceful no-op if key differs
            sourceEditor: false,
          },
        });

        crepe.editor
          .use(collab)
          .use(listener)
          .config((ctx) => {
            ctx.get(listenerCtx).markdownUpdated((_, markdown) => {
              onMarkdownChange(markdown);
            });

            const collabService = ctx.get(collabServiceCtx);
            const connectCollab = (isSynced: boolean) => {
              if (isSynced) {
                collabService.bindDoc(doc).setAwareness(provider.awareness).connect();
              }
            };

            if (provider.synced) {
              connectCollab(true);
            } else {
              provider.once('sync', connectCollab);
            }
          });

        crepeRef.current = crepe;
        return crepe;
      },
      [doc, provider]
    );

    useImperativeHandle(ref, () => ({
      replaceContent: (markdown: string) => {
        crepeRef.current?.editor.action(replaceAll(markdown));
      },
      getContent: () => {
        if (!crepeRef.current) return '';
        // action() is synchronous — returns the latest serialised markdown from ProseMirror
        return crepeRef.current.editor.action(getMarkdown()) ?? '';
      },
    }), []);

    return (
      // No overflow-y-auto here — let the parent card be the scroll container.
      // This ensures ProseMirror's posAtCoords() uses a single scroll origin.
      <div className="w-full h-full">
        <Milkdown />
      </div>
    );
  }
);

export default MilkdownEditor;
