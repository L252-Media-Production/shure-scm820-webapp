// Cloudflare Worker that distributes the SCM820 Isolated Web App.
//
// An IWA can't be served live, so the Worker hosts the *delivery* side only:
//   /update.json          update manifest Chrome polls (every ~4-6 h)
//   /scm820-<ver>.swbn    signed web bundles referenced by the manifest
//   /                     install page with the Web Bundle ID and steps
// The mixer itself runs inside Chrome and talks TCP straight to the SCM820.

const MANIFEST_PATH = '/update.json';
const BUNDLE_PATTERN = /^\/scm820-[\d.]+\.swbn$/;
const APP_ID_PATH = '/app-id.json';
const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'no-cache';

const CORS = { 'Access-Control-Allow-Origin': '*' };

function withHeaders(response, headers) {
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function installPage(request, env) {
  const res = await env.ASSETS.fetch(new URL(APP_ID_PATH, request.url));
  const info = res.ok ? await res.json() : null;
  const origin = new URL(request.url).origin;
  const bundle = info ? `${origin}/scm820-${info.version}.swbn` : null;
  const body = info ? `
    <dl>
      <dt>Version</dt><dd>${escapeHtml(info.version)}</dd>
      <dt>Web Bundle ID</dt><dd><code>${escapeHtml(info.webBundleId)}</code></dd>
      <dt>Update manifest</dt><dd><code>${escapeHtml(origin + MANIFEST_PATH)}</code></dd>
    </dl>
    <p><a class="btn" href="${escapeHtml(bundle)}" download>Download scm820-${escapeHtml(info.version)}.swbn</a></p>
    <h2>Install (Chrome, desktop)</h2>
    <ol>
      <li>Open <code>chrome://flags/#enable-isolated-web-app-dev-mode</code>, enable it, and relaunch Chrome.</li>
      <li>Open <code>chrome://web-app-internals</code> and choose <b>Install IWA from Signed Web Bundle</b>.</li>
      <li>Select the downloaded <code>.swbn</code>. Launch <b>SCM820 Virtual Mixer</b> from the app list.</li>
      <li>Enter the SCM820's IP address. Allow USB MIDI when asked to use an X-Touch.</li>
    </ol>
    <p class="muted">Installed copies check the update manifest every few hours; use <b>Update</b> in web-app-internals to force a check.</p>`
    : '<p>No bundle has been published yet.</p>';
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SCM820 Virtual Mixer — install</title>
<style>body{font:16px/1.5 system-ui;margin:2rem auto;max-width:42rem;padding:0 1rem;background:#18181b;color:#e4e4e7}
code{background:#27272a;padding:.1em .35em;border-radius:4px;word-break:break-all}dt{color:#a1a1aa;margin-top:.6rem}dd{margin:0}
.btn{display:inline-block;background:#2563eb;color:#fff;padding:.5rem 1rem;border-radius:.5rem;text-decoration:none}.muted{color:#a1a1aa}</style>
<h1>SCM820 Virtual Mixer</h1>${body}`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': REVALIDATE } });
}

export default {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS') {
      return new Response('Method not allowed', { status: 405 });
    }
    const { pathname } = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS' } });
    }
    if (pathname === '/') return installPage(request, env);

    if (pathname === MANIFEST_PATH) {
      const res = await env.ASSETS.fetch(request);
      return res.ok ? withHeaders(res, { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': REVALIDATE }) : res;
    }
    if (BUNDLE_PATTERN.test(pathname)) {
      const res = await env.ASSETS.fetch(request);
      return res.ok ? withHeaders(res, { ...CORS, 'Content-Type': 'application/octet-stream', 'Cache-Control': IMMUTABLE }) : res;
    }
    return new Response('Not found', { status: 404 });
  },
};
