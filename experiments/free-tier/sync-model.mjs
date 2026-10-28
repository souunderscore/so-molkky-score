// Pure transition model. A production adapter MUST re-run each transition inside
// an atomic compare-and-set / transaction. A check followed by an unconditional
// write is unsafe. Link capability verification and payload validation are separate.
const fail = code => { throw Error(code); };
const clone = value => structuredClone(value);
export function initialState() {
  return { links: {}, matches: {}, selectedLink: null, display: null, hidden: false };
}
const usable = (s, id) => {
  const l = s.links[id];
  if (!l || l.discarded || !l.enabled) fail('LINK_UNAVAILABLE');
  return l;
};
function publish(s, id) {
  if (s.selectedLink !== id) return;
  const match = s.matches[s.links[id].matchId];
  s.display = { matchId: match.id, revision: match.revision, record: clone(match.record) };
}
// These admin transitions require server-verified management authorization.
export function addLink(state, id, name) {
  const s = clone(state);
  if (s.links[id]) fail('LINK_EXISTS');
  s.links[id] = { name, enabled: false, discarded: false, generation: 0, owner: null, matchId: null };
  return s;
}
export function setEnabled(state, id, enabled) {
  const s = clone(state), l = s.links[id];
  if (!l || l.discarded) fail('LINK_UNAVAILABLE');
  if (l.enabled !== enabled) { l.enabled = enabled; l.generation++; l.owner = null; }
  return s;
}
export function discardLink(state, id) {
  const s = clone(state), l = s.links[id];
  if (!l) fail('LINK_UNAVAILABLE');
  l.enabled = false; l.discarded = true; l.generation++; l.owner = null;
  return s;
}
export function selectLink(state, id) {
  const s = clone(state); usable(s, id);
  if (!s.links[id].matchId) fail('NO_MATCH');
  s.selectedLink = id; s.hidden = false; publish(s, id); return s;
}
export function hideDisplay(state) { const s = clone(state); s.hidden = true; return s; }
// deviceSession is a server-issued random secret, NOT a caller-chosen device ID.
export function claim(state, id, deviceSession) {
  const s = clone(state), l = usable(s, id);
  if (!deviceSession) fail('INVALID_SESSION');
  if (l.owner && l.owner !== deviceSession) fail('OWNER_EXISTS');
  if (!l.owner) { l.owner = deviceSession; l.generation++; }
  return s;
}
function owner(l, credential) {
  if (!credential || l.owner !== credential.session || l.generation !== credential.generation) fail('STALE_OWNER');
}
// Authorized by the old owner for a normal handoff, or by management for force.
export function handoff(state, id, session, oldCredential, admin = false) {
  const s = clone(state), l = usable(s, id);
  if (!admin) owner(l, oldCredential);
  if (!session) fail('INVALID_SESSION');
  l.owner = session; l.generation++; return s;
}
export function beginMatch(state, id, credential, matchId, record) {
  const s = clone(state), l = usable(s, id); owner(l, credential);
  if (s.matches[matchId]) fail('MATCH_EXISTS');
  if (l.matchId && !s.matches[l.matchId].ended) fail('MATCH_NOT_ENDED');
  s.matches[matchId] = { id: matchId, linkId: id, revision: 0, record: clone(record), ended: false, lastRequest: null };
  l.matchId = matchId; publish(s, id); return s;
}
// payloadHash must be computed by the server from the full validated change.
// Proof uses snapshots; production must also validate the score state and derive
// public display data rather than expose arbitrary private record fields.
export function update(state, id, credential, change) {
  const s = clone(state), l = usable(s, id); owner(l, credential);
  const m = s.matches[l.matchId];
  if (!m || change.matchId !== m.id) fail('STALE_MATCH');
  if (!change.requestId || !change.payloadHash) fail('INVALID_CHANGE');
  if (m.lastRequest?.id === change.requestId) {
    if (m.lastRequest.hash !== change.payloadHash) fail('REQUEST_ID_REUSED');
    return s;
  }
  if (change.baseRevision !== m.revision) fail('REVISION_CONFLICT');
  m.record = clone(change.record); m.ended = !!change.ended; m.revision++;
  m.lastRequest = { id: change.requestId, hash: change.payloadHash };
  publish(s, id); return s;
}
