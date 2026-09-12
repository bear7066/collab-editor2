import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Eye, Code } from 'lucide-react';
import { MilkdownProvider } from '@milkdown/react';
import MilkdownEditor, { MilkdownEditorRef } from './MilkdownEditor';
import MarkdownEditor from './MarkdownEditor';
import { SyncStatusIndicator } from './SyncStatusIndicator';
import { apiFetch } from '../lib/api';
import { useSyncedDoc } from '../lib/useSyncedDoc';

type EditorMode = 'wysiwyg' | 'markdown';

export const EditorContainer: React.FC = () => {
  const { projectName } = useParams<{ projectName: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isIframe = searchParams.get('iframe') === 'true';
  const allowMarkdownInIframe = searchParams.get('markdown') === 'true';

  const { doc: yjsDoc, provider: syncProvider, status: syncStatus } = useSyncedDoc('project', projectName);
  const [markdown, setMarkdown] = useState('');
  const [editorMode, setEditorMode] = useState<EditorMode>('wysiwyg');

  const milkdownRef = useRef<MilkdownEditorRef>(null);

  // Refs used inside callbacks to avoid stale closures
  const editorModeRef = useRef<EditorMode>('wysiwyg');
  const hasLocalMarkdownEditsRef = useRef(false);
  const markdownSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the ref in sync with state
  useEffect(() => {
    editorModeRef.current = editorMode;
  }, [editorMode]);

  // Debounced save of the plain markdown text used for the dashboard preview.
  // The document itself is synced by the provider; this copy is best-effort.
  useEffect(() => {
    if (!projectName || !markdown) return;
    const timer = setTimeout(() => {
      apiFetch(`/api/markdown?name=${encodeURIComponent(projectName)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown }),
      }).catch((error) => console.warn('Could not save markdown preview:', error));
    }, 2000);
    return () => clearTimeout(timer);
  }, [markdown, projectName]);

  /**
   * When in markdown mode, listen directly to the Yjs document for remote updates.
   * The sync provider applies remote updates with itself as the Yjs transaction
   * origin, so we can filter to remote-only changes cleanly. y-prosemirror registers its
   * own observer first (at editor creation), so by the time ours fires, ProseMirror already
   * has the merged content — getContent() is safe to call immediately.
   *
   * We skip updates while the user is actively typing (debounce pending) to avoid
   * overwriting characters that haven't been pushed to Yjs yet.
   */
  useEffect(() => {
    if (!yjsDoc || !syncProvider || editorMode !== 'markdown') return;

    const handleRemoteUpdate = (_update: Uint8Array, origin: unknown) => {
      if (origin !== syncProvider) return; // skip our own replaceContent calls
      if (hasLocalMarkdownEditsRef.current) return; // skip while user is actively typing
      const content = milkdownRef.current?.getContent();
      if (content !== undefined) setMarkdown(content);
    };

    yjsDoc.on('update', handleRemoteUpdate);
    return () => yjsDoc.off('update', handleRemoteUpdate);
  }, [yjsDoc, syncProvider, editorMode]);

  /**
   * Called by Milkdown whenever the document content changes (local or via Yjs sync).
   * In markdown mode the textarea is the source of truth, so we block all Milkdown-driven
   * updates. Remote updates reach the textarea via the direct Yjs observer below instead.
   */
  const handleMilkdownMarkdownChange = useCallback((md: string) => {
    if (editorModeRef.current === 'markdown') return;
    setMarkdown(md);
  }, []);

  /** Called when the user types in the raw-markdown textarea. Debounces a Yjs sync. */
  const handleTextareaChange = useCallback((val: string) => {
    hasLocalMarkdownEditsRef.current = true;
    setMarkdown(val);

    if (markdownSyncTimeoutRef.current) clearTimeout(markdownSyncTimeoutRef.current);
    markdownSyncTimeoutRef.current = setTimeout(() => {
      // replaceContent triggers onMarkdownChange synchronously (ProseMirror transaction),
      // so the echo is still blocked by the flag here, then we clear it so remote
      // Yjs updates can flow through to the textarea afterwards.
      milkdownRef.current?.replaceContent(val);
      hasLocalMarkdownEditsRef.current = false;
    }, 300);
  }, []);

  /**
   * Toggle between WYSIWYG and raw-markdown modes.
   *
   * WYSIWYG → Markdown: snapshot the *current* ProseMirror state (not React state,
   * which can lag a render behind fast Yjs updates from other collaborators).
   *
   * Markdown → WYSIWYG: if the user typed locally, push those changes into the
   * Yjs document via replaceContent so all collaborators see them.
   */
  const handleEditorModeToggle = (mode: EditorMode) => {
    if (mode === editorMode) return;

    // Cancel any pending debounced sync before switching modes
    if (markdownSyncTimeoutRef.current) {
      clearTimeout(markdownSyncTimeoutRef.current);
      markdownSyncTimeoutRef.current = null;
    }

    if (mode === 'markdown') {
      // Always snapshot fresh content from ProseMirror to avoid stale React state
      const fresh = milkdownRef.current?.getContent();
      if (fresh !== undefined) setMarkdown(fresh);
      hasLocalMarkdownEditsRef.current = false;
    }

    if (mode === 'wysiwyg' && hasLocalMarkdownEditsRef.current) {
      milkdownRef.current?.replaceContent(markdown);
      hasLocalMarkdownEditsRef.current = false;
    }

    setEditorMode(mode);
  };

  if (!yjsDoc || !syncProvider) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper">
        <div className="flex flex-col items-center gap-4 text-stone">
          <Loader2 size={36} className="animate-spin text-moss" />
          <span className="text-sm font-medium tracking-wide">Initializing collaborative session…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col relative bg-paper text-ink">
      {!isIframe && (
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-6 py-4 border-b border-line bg-paper/85 backdrop-blur-md sticky top-0 z-20">
          {/* Left: back + project info */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => navigate('/?tab=projects')}
              className="shrink-0 p-2 bg-surface border border-line hover:border-ai/50 hover:bg-sunken/60 rounded-xl text-stone hover:text-ink transition cursor-pointer"
            >
              <ArrowLeft size={16} />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-ai bg-ai-soft px-2 py-0.5 rounded-md">
                  Project
                </span>
                <SyncStatusIndicator status={syncStatus} />
              </div>
              <h1 className="font-serif text-lg font-semibold text-ink truncate">/project/{projectName}</h1>
            </div>
          </div>

          {/* Right: mode toggle */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Mode toggle */}
            <div className="flex bg-sunken border border-line rounded-xl p-1 gap-1 select-none">
              <button
                onClick={() => handleEditorModeToggle('wysiwyg')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  editorMode === 'wysiwyg'
                    ? 'bg-moss-deep text-white'
                    : 'text-stone hover:text-ink hover:bg-surface'
                }`}
              >
                <Eye size={13} />
                WYSIWYG
              </button>
              <button
                onClick={() => handleEditorModeToggle('markdown')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  editorMode === 'markdown'
                    ? 'bg-moss-deep text-white'
                    : 'text-stone hover:text-ink hover:bg-surface'
                }`}
              >
                <Code size={13} />
                Markdown
              </button>
            </div>
          </div>
        </header>
      )}

      {/* Minimal status + optional mode-toggle bar shown in iframe mode */}
      {isIframe && (
        <div className="sticky top-0 z-20 flex items-center justify-between px-3 py-1.5 border-b border-line bg-paper/90 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-1.5">
            <SyncStatusIndicator status={syncStatus} />
          </div>

          {/* Right: mode toggle (only when ?markdown=true) */}
          {allowMarkdownInIframe && (
            <div className="flex bg-sunken border border-line rounded-xl p-0.5 gap-0.5 select-none">
              <button
                onClick={() => handleEditorModeToggle('wysiwyg')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer ${
                  editorMode === 'wysiwyg'
                    ? 'bg-moss-deep text-white'
                    : 'text-stone hover:text-ink hover:bg-surface'
                }`}
              >
                <Eye size={11} />
                WYSIWYG
              </button>
              <button
                onClick={() => handleEditorModeToggle('markdown')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer ${
                  editorMode === 'markdown'
                    ? 'bg-moss-deep text-white'
                    : 'text-stone hover:text-ink hover:bg-surface'
                }`}
              >
                <Code size={11} />
                Markdown
              </button>
            </div>
          )}
        </div>
      )}

      {/* Editor area — full remaining viewport height */}
      <main className={`flex flex-col flex-1 ${isIframe ? 'h-[calc(100vh-38px)]' : 'h-[calc(100vh-73px)]'} ${isIframe ? '' : 'p-4 max-w-7xl w-full mx-auto'}`}>

        {/* WYSIWYG — always mounted so Yjs collab stays connected; hidden via CSS when inactive.
            overflow-y-auto here (not on the inner Milkdown div) so ProseMirror has exactly
            one scroll ancestor for posAtCoords() to compute against.
            No backdrop-filter here: it would create a new containing block for
            the position:fixed drop-cursor indicator, offsetting it from the viewport. */}
        <div className={`flex-1 bg-surface border border-line rounded-2xl overflow-y-auto ${
          editorMode === 'wysiwyg' ? 'block' : 'hidden'
        }`}>
          <MilkdownProvider>
            <MilkdownEditor
              ref={milkdownRef}
              doc={yjsDoc}
              provider={syncProvider}
              onMarkdownChange={handleMilkdownMarkdownChange}
            />
          </MilkdownProvider>
        </div>

        {/* Raw Markdown — only rendered when in markdown mode */}
        {editorMode === 'markdown' && (
          <div className="flex-1 overflow-hidden rounded-2xl">
            <MarkdownEditor
              value={markdown}
              onChange={handleTextareaChange}
              projectName={projectName}
            />
          </div>
        )}
      </main>
    </div>
  );
};

export default EditorContainer;
