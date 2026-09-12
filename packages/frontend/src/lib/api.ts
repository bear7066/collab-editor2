import { notifyUnauthorized } from './authEvents';

/** Same-origin fetch that turns a 401 into the app-wide signed-out signal. */
export async function apiFetch(path: string, init: RequestInit = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...init });
  if (response.status === 401) notifyUnauthorized();
  return response;
}
