import { describe, expect, test } from 'bun:test';
import { ConfigurationError, createDeps, vercelHandler } from './env.js';
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

  test('configuration problems are a distinct error type', () => {
    expect(() => createDeps({})).toThrow(ConfigurationError);
  });
});

describe('vercelHandler', () => {
  const route = async () => new Response('ok');

  test('answers 503 naming the missing variables, so a misconfigured deploy is self-explaining', async () => {
    const handler = vercelHandler(route, { GITHUB_CLIENT_ID: 'id' });
    const response = await handler.fetch(new Request('https://example.com/api/boards'));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toMatch(/not configured/i);
    expect(body.detail).toContain('AUTH_SECRET');
    expect(body.detail).toContain('ALLOWED_GITHUB_IDS');
  });

  test('never echoes a configured value back to the caller', async () => {
    const handler = vercelHandler(route, { ...base, AUTH_SECRET: 'too-short-secret' });
    const body = await (await handler.fetch(new Request('https://example.com/api/boards'))).json();
    expect(JSON.stringify(body)).not.toContain('too-short-secret');
    expect(body.detail).toContain('AUTH_SECRET');
  });

  test('explains a missing database schema without leaking connection details', async () => {
    const undefinedTable = Object.assign(new Error('relation "documents" does not exist'), {
      code: '42P01',
      connectionString: 'postgresql://user:hunter2@db.neon.tech/main',
    });
    const handler = vercelHandler(
      async () => {
        throw undefinedTable;
      },
      { ...base, DATABASE_URL: 'postgresql://user:hunter2@db.neon.tech/main' }
    );

    const response = await handler.fetch(new Request('https://example.com/api/boards'));
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.detail).toMatch(/db:migrate/);
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });

  test('explains an unreachable database', async () => {
    const handler = vercelHandler(
      async () => {
        throw Object.assign(new Error('password authentication failed for user "user"'), { code: '28P01' });
      },
      { ...base, DATABASE_URL: 'postgresql://user:hunter2@db.neon.tech/main' }
    );
    const body = await (await handler.fetch(new Request('https://example.com/api/boards'))).json();
    expect(body.detail).toMatch(/DATABASE_URL/);
  });

  test('keeps other failures generic', async () => {
    const boom = async () => {
      throw new Error('secret-bearing failure');
    };
    const handler = vercelHandler(boom, { ...base, DATABASE_URL: 'postgresql://user:pw@host/db' });
    const response = await handler.fetch(new Request('https://example.com/api/boards'));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('secret-bearing');
  });

  test('serves requests once the configuration is valid', async () => {
    const handler = vercelHandler(route, { ...base, DATABASE_URL: 'postgresql://user:pw@host/db' });
    expect((await handler.fetch(new Request('https://example.com/api/boards'))).status).toBe(200);
  });
});
