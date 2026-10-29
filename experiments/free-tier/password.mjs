// Verification candidate, NOT yet selected for the production authentication service.
// Never lower the work factor merely to make a Free CPU quota pass.
const ITERATIONS = 600000;
const enc = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('');
export async function hashPassword(password, salt = crypto.getRandomValues(new Uint8Array(16))) {
  if (typeof password !== 'string' || !password.length || enc.encode(password).length > 1024) throw Error('INVALID_PASSWORD');
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const hash = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256);
  return { algorithm: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: hex(salt), hash: hex(hash) };
}
export async function verifyPassword(password, verifier) {
  if (verifier?.algorithm !== 'PBKDF2-SHA256' || verifier.iterations !== ITERATIONS ||
      !/^[0-9a-f]{32}$/.test(verifier.salt) || !/^[0-9a-f]{64}$/.test(verifier.hash)) throw Error('INVALID_VERIFIER');
  const salt = Uint8Array.from(verifier.salt.match(/../g), x => parseInt(x, 16));
  const actual = await hashPassword(password, salt);
  let difference = 0;
  for (let i = 0; i < actual.hash.length; i++) difference |= actual.hash.charCodeAt(i) ^ verifier.hash.charCodeAt(i);
  return difference === 0;
}
