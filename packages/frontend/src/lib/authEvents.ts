/** App-wide signal that the server rejected our session (HTTP 401). */
const UNAUTHORIZED_EVENT = 'collab-editor:unauthorized';

export const notifyUnauthorized = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
};

export const onUnauthorized = (listener: () => void) => {
  window.addEventListener(UNAUTHORIZED_EVENT, listener);
  return () => window.removeEventListener(UNAUTHORIZED_EVENT, listener);
};
