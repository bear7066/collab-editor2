import { Buffer } from 'node:buffer';
/**
 * Stateless session tokens and the small request-parsing helpers the auth
 * endpoints need. Tokens are `base64url(payload).base64url(HMAC-SHA256)`.
 */

export interface SessionUser {
  id: number;
  login: string;
}

export interface Session {
  user: SessionUser;
  exp: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const SESSION_TTL_MS = 30 * DAY_MS;
const REFRESH_WINDOW_MS = 7 * DAY_MS;

const encoder = new TextEncoder();

const importKey = (secret: string) =>
  crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

export async function createSessionToken(user: SessionUser, secret: string, now = Date.now()): Promise<string> {
  const payload = Buffer.from(JSON.stringify({ id: user.id, login: user.login, exp: now + SESSION_TTL_MS })).toString('base64url');
  const signature = await crypto.subtle.sign('HMAC', await importKey(secret), encoder.encode(payload));
  return `${payload}.${Buffer.from(signature).toString('base64url')}`;
}

export async function verifySessionToken(token: string, secret: string, now = Date.now()): Promise<Session | null> {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payload, signature] = parts;

  // subtle.verify compares in constant time.
  const valid = await crypto.subtle.verify(
    'HMAC',
    await importKey(secret),
    Buffer.from(signature, 'base64url'),
    encoder.encode(payload)
  );
  if (!valid) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!Number.isInteger(data.id) || typeof data.login !== 'string' || typeof data.exp !== 'number') return null;
    if (data.exp <= now) return null;
    return { user: { id: data.id, login: data.login }, exp: data.exp };
  } catch {
    return null;
  }
}

export const needsRefresh = (exp: number, now = Date.now()) => exp - now < REFRESH_WINDOW_MS;

export function parseAllowedIds(value: string | undefined): Set<number> {
  const ids = new Set<number>();
  for (const part of (value ?? '').split(',')) {
    const trimmed = part.trim();
    if (/^\d+$/.test(trimmed)) ids.add(Number(trimmed));
  }
  return ids;
}

/** Only same-site absolute paths survive; everything else becomes `/`. */
export function sanitizeReturnTo(value: string | null): string {
  if (!value || !value.startsWith('/')) return '/';
  if (value.startsWith('//') || value.startsWith('/\\')) return '/';
  if (/[\u0000-\u001f\u007f]/.test(value)) return '/';
  return value;
}

export function parseCookies(header: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      // Malformed encoding: ignore this cookie rather than failing the request.
    }
  }
  return cookies;
}

export interface CookieOptions {
  maxAgeSeconds: number;
  secure: boolean;
}

export const serializeCookie = (name: string, value: string, { maxAgeSeconds, secure }: CookieOptions) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
