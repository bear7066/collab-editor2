import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Check, CloudLightning, Loader2, Eye, Code, Users,
} from 'lucide-react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { MilkdownProvider } from '@milkdown/react';
import MilkdownEditor, { MilkdownEditorRef } from './MilkdownEditor';
import MarkdownEditor from './MarkdownEditor';
import { randomPresenceUser } from '../lib/presence';

type EditorMode = 'wysiwyg' | 'markdown';

export const EditorContainer: React.FC = () => {
  const { projectName } = useParams<{ projectName: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isIframe = searchParams.get('iframe') === 'true';
  const allowMarkdownInIframe = searchParams.get('markdown') === 'true';

  const [yjsDoc, setYjsDoc] = useState<Y.Doc | null>(null);
  const [wsProvider, setWsProvider] = useState<WebsocketProvider | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [activeUsers, setActiveUsers] = useState<{ name: string; color: string }[]>([]);
  const [markdown, setMarkdown] = useState('');
  const [editorMode, setEditorMode] = useState<EditorMode>('wysiwyg');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'syncing'>('saved');

  const milkdownRef = useRef<MilkdownEditorRef>(null);

  // Refs used inside callbacks to avoid stale closures
  const editorModeRef = useRef<EditorMode>('wysiwyg');
  const hasLocalMarkdownEditsRef = useRef(false);
  const markdownSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the ref in sync with state
  useEffect(() => {
    editorModeRef.current = editorMode;
  }, [editorMode]);

  // Initialize Y.Doc and WebsocketProvider
  useEffect(() => {
    if (!projectName) return;

    const doc = new Y.Doc();
    const wsHost = import.meta.env.DEV
      ? 'ws://localhost:3001'
      : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;

    const provider = new WebsocketProvider(wsHost, projectName, doc);
    setYjsDoc(doc);
    setWsProvider(provider);

    provider.on('status', (event: any) => {
      setConnectionStatus(event.status);
    });

    provider.awareness.setLocalStateField('user', randomPresenceUser());

    const handleAwarenessChange = () => {
      const users: { name: string; color: string }[] = [];
      provider.awareness.getStates().forEach((state: any) => {
        if (state.user) users.push(state.user);
      });
      setActiveUsers(users);
    };
    provider.awareness.on('change', handleAwarenessChange);

    return () => {
      provider.disconnect();
      doc.destroy();
    };
  }, [projectName]);

  // Debounced save of plain markdown text to SQLite for dashboard preview
  useEffect(() => {
    if (!projectName || !markdown) return;
    setSaveStatus('saving');
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/project/${projectName}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markdown }),
        });
        setSaveStatus(res.ok ? 'saved' : 'syncing');
      } catch {
        setSaveStatus('syncing');
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [markdown, projectName]);

  /**
   * When in markdown mode, listen directly to the Yjs document for remote updates.
   * y-websocket applies remote updates with the WebsocketProvider as the Yjs transaction
   * origin, so we can filter to remote-only changes cleanly. y-prosemirror registers its
   * own observer first (at editor creation), so by the time ours fires, ProseMirror already
   * has the merged content — getContent() is safe to call immediately.
   *
   * We skip updates while the user is actively typing (debounce pending) to avoid
   * overwriting characters that haven't been pushed to Yjs yet.
   */
  useEffect(() => {
    if (!yjsDoc || !wsProvider || editorMode !== 'markdown') return;

    const handleRemoteUpdate = (_update: Uint8Array, origin: unknown) => {
      if (origin !== wsProvider) return; // skip our own replaceContent calls
      if (hasLocalMarkdownEditsRef.current) return; // skip while user is actively typing
      const content = milkdownRef.current?.getContent();
      if (content !== undefined) setMarkdown(content);
    };

    yjsDoc.on('update', handleRemoteUpdate);
    return () => yjsDoc.off('update', handleRemoteUpdate);
  }, [yjsDoc, wsProvider, editorMode]);

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
      // Remove this user's cursor from other clients' WYSIWYG views
      wsProvider?.awareness.setLocalStateField('cursor', null);
    }

    if (mode === 'wysiwyg' && hasLocalMarkdownEditsRef.current) {
      milkdownRef.current?.replaceContent(markdown);
      hasLocalMarkdownEditsRef.current = false;
    }

    setEditorMode(mode);
  };

  if (!yjsDoc || !wsProvider) {
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
                <span className={`w-2 h-2 rounded-full ${
                  connectionStatus === 'connected' ? 'bg-moss'
                    : connectionStatus === 'connecting' ? 'bg-kaki animate-pulse'
                    : 'bg-shu'
                }`} />
                <span className="text-[11px] text-stone capitalize">{connectionStatus}</span>
              </div>
              <h1 className="font-serif text-lg font-semibold text-ink truncate">/project/{projectName}</h1>
            </div>
          </div>

          {/* Right: users + save status + mode toggle */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Active collaborators */}
            {activeUsers.length > 1 && (
              <div className="flex items-center gap-2 bg-surface border border-line rounded-xl py-1.5 px-3">
                <Users size={13} className="text-stone" />
                <span className="text-xs text-stone font-medium">{activeUsers.length} online</span>
                <div className="flex -space-x-1.5">
                  {activeUsers.slice(0, 5).map((user, idx) => (
                    <div
                      key={idx}
                      className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white border-2 border-surface uppercase select-none cursor-help"
                      style={{ backgroundColor: user.color }}
                      title={user.name}
                    >
                      {user.name.slice(0, 2)}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Save status */}
            <div className="flex items-center gap-1.5 text-xs text-stone bg-surface border border-line rounded-xl py-1.5 px-3">
              {saveStatus === 'saved' && <><Check size={13} className="text-moss" /><span>Saved</span></>}
              {saveStatus === 'saving' && <><Loader2 size={13} className="animate-spin text-ai" /><span>Saving…</span></>}
              {saveStatus === 'syncing' && <><CloudLightning size={13} className="text-kaki" /><span>Syncing…</span></>}
            </div>

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
          {/* Left: online users + save status */}
          <div className="flex items-center gap-2">
            {activeUsers.length > 1 && (
              <div className="flex items-center gap-1.5">
                <Users size={11} className="text-stone" />
                <span className="text-[11px] text-stone font-medium">{activeUsers.length}</span>
                <div className="flex -space-x-1">
                  {activeUsers.slice(0, 4).map((user, idx) => (
                    <div
                      key={idx}
                      className="w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-bold text-white border border-surface uppercase select-none"
                      style={{ backgroundColor: user.color }}
                      title={user.name}
                    >
                      {user.name.slice(0, 1)}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center gap-1 text-[11px] text-stone">
              {saveStatus === 'saved'   && <><Check size={11} className="text-moss" /><span>Saved</span></>}
              {saveStatus === 'saving'  && <><Loader2 size={11} className="animate-spin text-ai" /><span>Saving…</span></>}
              {saveStatus === 'syncing' && <><CloudLightning size={11} className="text-kaki" /><span>Syncing…</span></>}
            </div>
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
              provider={wsProvider}
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
