import React from 'react';
import { Github } from 'lucide-react';

interface LoginPageProps {
  variant: 'signedOut' | 'denied' | 'error';
  onRetry: () => void;
}

const signIn = () => {
  const returnTo = window.location.pathname + window.location.search;
  window.location.href = `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
};

export const LoginPage: React.FC<LoginPageProps> = ({ variant, onRetry }) => (
  <main className="flex min-h-screen items-center justify-center bg-paper px-6 text-ink">
    <div className="w-full max-w-sm text-center">
      <h1 className="mb-3 flex items-center justify-center gap-3 font-serif text-3xl font-semibold tracking-wide">
        <span className="h-2.5 w-2.5 rounded-full bg-kaki" aria-hidden="true" />
        CollabEditor
      </h1>

      {variant === 'signedOut' && (
        <p className="mb-10 text-sm leading-6 text-stone">A quiet place for your boards and notes.</p>
      )}
      {variant === 'denied' && (
        <p className="mb-10 text-sm leading-6 text-shu">
          This GitHub account does not have access.
          <br />
          <span className="text-stone">Sign out of GitHub first to use a different account.</span>
        </p>
      )}
      {variant === 'error' && (
        <p className="mb-10 text-sm leading-6 text-stone">Could not reach the server. Check your connection.</p>
      )}

      {variant === 'error' ? (
        <button
          type="button"
          onClick={onRetry}
          className="w-full rounded-lg border border-line-strong bg-surface px-4 py-3 text-sm font-medium text-ink-soft transition hover:border-stone hover:text-ink cursor-pointer"
        >
          Try again
        </button>
      ) : (
        <button
          type="button"
          onClick={signIn}
          className="flex w-full items-center justify-center gap-2.5 rounded-lg bg-moss-deep px-4 py-3 text-sm font-medium text-on-moss transition hover:bg-moss cursor-pointer"
        >
          <Github size={17} />
          Sign in with GitHub
        </button>
      )}
    </div>
  </main>
);
