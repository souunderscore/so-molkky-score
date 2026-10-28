import { verifyPassword } from './password.mjs';
// Isolated benchmark only: no DB connection, application writes or real admin
// sessions. Do not point the production application at this worker.
export default {
  async fetch(request, env) {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers });
    const url = new URL(request.url);
    if (url.pathname !== '/probe/password' || request.method !== 'POST') return json({ error: 'NOT_FOUND' }, 404);
    if (!env.PROBE_TOKEN || !env.PROBE_VERIFIER) return json({ error: 'PROBE_NOT_CONFIGURED' }, 503);
    if (request.headers.get('Authorization') !== `Bearer ${env.PROBE_TOKEN}`) return json({ error: 'UNAUTHORIZED' }, 401);
    if (Number(request.headers.get('Content-Length')) > 2048) return json({ error: 'TOO_LARGE' }, 413);
    let bytes = 0, chunks = [], reader = request.body?.getReader();
    if (!reader) return json({ error: 'INVALID_BODY' }, 400);
    for (;;) { const {done,value} = await reader.read(); if (done) break; bytes += value.length; if (bytes > 2048) { await reader.cancel(); return json({ error: 'TOO_LARGE' }, 413); } chunks.push(value); }
    let body;
    try { const buffer = new Uint8Array(bytes); let offset=0; for (const chunk of chunks) { buffer.set(chunk,offset); offset+=chunk.length; } body = JSON.parse(new TextDecoder().decode(buffer)); }
    catch { return json({ error: 'INVALID_BODY' }, 400); }
    const started = Date.now();
    try {
      const valid = await verifyPassword(body.password, JSON.parse(env.PROBE_VERIFIER));
      return json({ valid, elapsedWallMs: Date.now() - started, note: 'Wall time is NOT billable CPU time. Check Cloudflare metrics.' });
    } catch {
      // In particular, report unsupported work factors instead of weakening them.
      return json({ error: 'VERIFICATION_UNAVAILABLE', note: 'Inspect runtime compatibility before adopting this candidate.' }, 503);
    }
  }
};
