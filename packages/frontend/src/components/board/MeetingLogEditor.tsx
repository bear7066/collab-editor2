import React from 'react';
import { Crepe } from '@milkdown/crepe';
import { EditorStatus, editorViewCtx } from '@milkdown/core';
import { Milkdown, useEditor } from '@milkdown/react';
import { collab, collabServiceCtx } from '@milkdown/plugin-collab';
import { Fragment, Slice, type Node as ProseNode } from '@milkdown/kit/prose/model';
import { dropPoint } from '@milkdown/kit/prose/transform';
import type * as Y from 'yjs';
import type { HttpSyncProvider } from '../../lib/HttpSyncProvider';

import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';

interface MeetingLogEditorProps {
  /** Shared ProseMirror fragment holding the current section's notes. */
  fragment: Y.XmlFragment;
  /** Board sync provider; supplies the doc's sync signal and a local awareness. */
  provider: HttpSyncProvider;
  /** Stores a pasted/dropped file and returns data used to embed it in the note. */
  onUploadFile: (file: File) => Promise<{ url: string; filename: string; mimeType: string }>;
  /** Taller layout for a notes-only section, where this editor is the whole page. */
  tall?: boolean;
}

export const MeetingLogEditor: React.FC<MeetingLogEditorProps> = ({ fragment, provider, onUploadFile, tall = false }) => {
  const crepeRef = React.useRef<Crepe | null>(null);
  const [uploadError, setUploadError] = React.useState<string | null>(null);

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
          'image-block': {
            onUpload: async (file) => (await onUploadFile(file)).url,
            inlineOnUpload: async (file) => (await onUploadFile(file)).url,
            blockOnUpload: async (file) => (await onUploadFile(file)).url,
          },
        },
      });
      crepeRef.current = crepe;

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

  const insertFiles = React.useCallback(
    async (files: File[], coordinates?: { left: number; top: number }) => {
      if (files.length === 0 || !crepeRef.current) return;

      let requestedPosition: number | null = null;
      crepeRef.current.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        requestedPosition = coordinates
          ? view.posAtCoords(coordinates)?.pos ?? view.state.selection.from
          : view.state.selection.from;
      });

      setUploadError(null);
      const uploaded: Array<{ url: string; filename: string; mimeType: string }> = [];
      const failed: string[] = [];
      for (const file of files) {
        try {
          uploaded.push(await onUploadFile(file));
        } catch {
          failed.push(file.name);
        }
      }

      if (uploaded.length > 0 && crepeRef.current) {
        crepeRef.current.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const { schema } = view.state;
          const nodes: ProseNode[] = [];

          for (const file of uploaded) {
            if (file.mimeType.startsWith('image/')) {
              const imageType = schema.nodes['image-block'] ?? schema.nodes.image;
              const image = imageType?.createAndFill({ src: file.url, alt: file.filename, title: file.filename });
              if (image) nodes.push(image);
              continue;
            }

            const paragraph = schema.nodes.paragraph;
            const link = schema.marks.link;
            if (!paragraph || !link) continue;
            nodes.push(
              paragraph.create(null, [
                schema.text('\u{1F4CE} '),
                schema.text(file.filename, [link.create({ href: file.url, title: file.filename })]),
              ])
            );
          }

          if (nodes.length === 0) return;
          const slice = new Slice(Fragment.fromArray(nodes), 0, 0);
          const desired = Math.min(requestedPosition ?? view.state.doc.content.size, view.state.doc.content.size);
          const insertAt = dropPoint(view.state.doc, desired, slice) ?? view.state.doc.content.size;
          view.dispatch(view.state.tr.replaceRange(insertAt, insertAt, slice).scrollIntoView());
          view.focus();
        });
      }

      if (failed.length > 0) setUploadError(`Could not upload: ${failed.join(', ')}`);
    },
    [onUploadFile]
  );

  return (
    <div
      className={`board-meeting-log ${tall ? 'h-[70vh] min-h-[24rem]' : 'h-44'} flex flex-col overflow-hidden rounded-lg border border-line bg-paper transition focus-within:border-ai`}
      onDragOver={tall ? (event) => event.preventDefault() : undefined}
      onDropCapture={
        tall
          ? (event) => {
              if (event.dataTransfer.files.length === 0) return;
              event.preventDefault();
              event.stopPropagation();
              void insertFiles(Array.from(event.dataTransfer.files), { left: event.clientX, top: event.clientY });
            }
          : undefined
      }
    >
      {uploadError && (
        <p className="shrink-0 border-b border-line px-3 py-2 text-xs text-shu" role="alert">
          {uploadError}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <Milkdown />
      </div>
    </div>
  );
};

export default MeetingLogEditor;
