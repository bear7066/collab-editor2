// Local stand-in for Vercel Functions: serves the same api/*.ts handlers on
// port 3001 behind the Vite dev server's /api proxy. Bun loads .env itself.

const PORT = 3001;
const API_PATH = /^\/api\/[a-z]+(\/[a-z]+)?$/;

Bun.serve({
  port: PORT,
  async fetch(request) {
    const incoming = new URL(request.url);
    if (!API_PATH.test(incoming.pathname)) return new Response('Not found', { status: 404 });

    let handler: { fetch: (request: Request) => Promise<Response> };
    try {
      handler = (await import(`../api${incoming.pathname.slice('/api'.length)}.ts`)).default;
    } catch {
      return new Response('Not found', { status: 404 });
    }

    // Vite proxies with the browser's Host header, so rebuild the URL from it:
    // redirects, cookies and the same-origin check then see the public origin.
    const url = new URL(incoming.pathname + incoming.search, `http://${request.headers.get('host') ?? `localhost:${PORT}`}`);
    return handler.fetch(new Request(url, request));
  },
});

console.log(`[dev-api] serving api/*.ts on http://localhost:${PORT}`);
