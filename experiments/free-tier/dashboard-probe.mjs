// Temporary synthetic benchmark. No Firebase connection or real credentials.
const expected = "b276b24012d263d7608ff3e64a4dd52ec9c0afdf0c57363e29d30558a1d50768";
export default {
  async fetch(request) {
    const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
    const reply = (data, status = 200) =>
      new Response(JSON.stringify(data, null, 2), { status, headers });
    if (new URL(request.url).pathname !== "/probe") {
      return reply({ message: "Open /probe to run the synthetic test." });
    }
    const started = Date.now();
    try {
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw", enc.encode("molkky-synthetic-probe-only"),
        "PBKDF2", false, ["deriveBits"]
      );
      const bits = await crypto.subtle.deriveBits({
        name: "PBKDF2",
        salt: enc.encode("molkky-probe-salt-2026"),
        iterations: 600000,
        hash: "SHA-256"
      }, key, 256);
      const actual = Array.from(new Uint8Array(bits),
        x => x.toString(16).padStart(2, "0")).join("");
      return reply({
        ok: actual === expected,
        iterations: 600000,
        elapsedWallMs: Date.now() - started,
        note: "Wall time is NOT CPU time. Check Cloudflare CPU metrics."
      });
    } catch (error) {
      return reply({ ok: false, error: error.name, message: error.message }, 503);
    }
  }
};
