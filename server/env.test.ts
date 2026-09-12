import { describe, expect, test } from 'bun:test';
import { createDeps } from './env.js';
import { MemoryDocStore } from './memoryDocStore.js';
import { NeonDocStore } from './neonDocStore.js';

const base = {
  AUTH_SECRET: 'x'.repeat(32),
  GITHUB_CLIENT_ID: 'id',
  GITHUB_CLIENT_SECRET: 'secret',
  ALLOWED_GITHUB_IDS: '86918643',
};

describe('createDeps', () => {
  test('reads auth settings and the whitelist', () => {
    const deps = createDeps({ ...base, DATABASE_URL: 'postgresql://user:pw@host/db' });
    expect(deps.config.allowedIds).toEqual(new Set([86918643]));
    expect(deps.store).toBeInstanceOf(NeonDocStore);
  });

  test('names every missing variable', () => {
    expect(() => createDeps({})).toThrow(/AUTH_SECRET.*GITHUB_CLIENT_ID.*GITHUB_CLIENT_SECRET.*ALLOWED_GITHUB_IDS/);
  });

  test('rejects a short AUTH_SECRET', () => {
    expect(() => createDeps({ ...base, AUTH_SECRET: 'short' })).toThrow(/AUTH_SECRET/);
  });

  test('refuses to run without any whitelisted id', () => {
    expect(() => createDeps({ ...base, ALLOWED_GITHUB_IDS: 'bear7066' })).toThrow(/ALLOWED_GITHUB_IDS/);
  });

  test('falls back to an in-memory store locally without DATABASE_URL', () => {
    expect(createDeps(base).store).toBeInstanceOf(MemoryDocStore);
  });

  test('never falls back to memory on Vercel', () => {
    expect(() => createDeps({ ...base, VERCEL: '1' })).toThrow(/DATABASE_URL/);
  });
});
