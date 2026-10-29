import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from './sync-model.mjs';
import { hashPassword, verifyPassword } from './password.mjs';
import worker from './worker.mjs';

function fixture() {
  let s = model.initialState();
  s = model.setEnabled(model.addLink(s, 'a', 'test link'), 'a', true);
  s = model.claim(s, 'a', 'server-issued-A');
  const credential = {session:'server-issued-A',generation:s.links.a.generation};
  s = model.beginMatch(s, 'a', credential, 'match-1', {scores:[0,0]});
  return {s, credential};
}
function change(overrides={}) {
  return {matchId:'match-1',baseRevision:0,requestId:'request-1',payloadHash:'server-computed-digest',record:{scores:[7,0]},...overrides};
}
test('selected display updates, nonselected record does not affect display', () => {
  let {s,credential} = fixture();
  s = model.selectLink(s,'a');
  s = model.update(s,'a',credential,change());
  assert.deepEqual(s.display.record,{scores:[7,0]});
  s = model.setEnabled(model.addLink(s,'b','second'),'b',true);
  s = model.claim(s,'b','server-issued-B');
  const b={session:'server-issued-B',generation:s.links.b.generation};
  s = model.beginMatch(s,'b',b,'match-b',{scores:[0,0]});
  s = model.update(s,'b',b,change({matchId:'match-b',record:{scores:[12,0]}}));
  assert.deepEqual(s.display.record,{scores:[7,0]});
  assert.deepEqual(s.matches['match-b'].record,{scores:[12,0]});
});
test('disabled link rejects input and retains last display; reenabling rejects old credential',()=>{
  let {s,credential}=fixture(); s=model.selectLink(s,'a');
  s=model.setEnabled(s,'a',false);
  assert.deepEqual(s.display.record,{scores:[0,0]});
  assert.throws(()=>model.update(s,'a',credential,change()),/LINK_UNAVAILABLE/);
  s=model.setEnabled(s,'a',true);
  assert.throws(()=>model.update(s,'a',credential,change()),/STALE_OWNER/);
});
test('discard cannot be reversed and does not erase match or display',()=>{
  let {s}=fixture();s=model.selectLink(s,'a');s=model.discardLink(s,'a');
  assert.throws(()=>model.setEnabled(s,'a',true),/LINK_UNAVAILABLE/);
  assert.ok(s.matches['match-1']);assert.ok(s.display);
});
test('a second device cannot steal an existing input owner',()=>{
  const {s}=fixture();assert.throws(()=>model.claim(s,'a','someone-else'),/OWNER_EXISTS/);
});
test('normal handoff needs current owner; old credential rejected after transfer',()=>{
  let {s,credential}=fixture();
  assert.throws(()=>model.handoff(s,'a','new',{session:'wrong',generation:2}),/STALE_OWNER/);
  s=model.handoff(s,'a','new',credential);
  assert.throws(()=>model.update(s,'a',credential,change()),/STALE_OWNER/);
  s=model.update(s,'a',{session:'new',generation:s.links.a.generation},change());
  assert.equal(s.matches['match-1'].revision,1);
});
test('forced transfer also rejects a previously offline owner',()=>{
  let {s,credential}=fixture();s=model.handoff(s,'a','new',null,true);
  assert.throws(()=>model.update(s,'a',credential,change()),/STALE_OWNER/);
});
test('same request retry is idempotent; changed content with reused id rejected',()=>{
  let {s,credential}=fixture();s=model.update(s,'a',credential,change());
  assert.deepEqual(model.update(s,'a',credential,change()),s);
  assert.throws(()=>model.update(s,'a',credential,change({payloadHash:'different'})),/REQUEST_ID_REUSED/);
});
test('stale revision rejected without mutating the state or client change',()=>{
  let {s,credential}=fixture();s=model.update(s,'a',credential,change());
  const before=structuredClone(s), offline=change({requestId:'offline'});
  assert.throws(()=>model.update(s,'a',credential,offline),/REVISION_CONFLICT/);
  assert.deepEqual(s,before);assert.deepEqual(offline.record,{scores:[7,0]});
});
test('next match preserves archive and selected display follows the new match',()=>{
  let {s,credential}=fixture();s=model.selectLink(s,'a');
  assert.throws(()=>model.beginMatch(s,'a',credential,'match-2',{}),/MATCH_NOT_ENDED/);
  s=model.update(s,'a',credential,change({ended:true}));
  s=model.beginMatch(s,'a',credential,'match-2',{scores:[0,0]});
  assert.equal(s.display.matchId,'match-2');assert.deepEqual(s.matches['match-1'].record,{scores:[7,0]});
  assert.throws(()=>model.update(s,'a',credential,change()),/STALE_MATCH/);
});
test('explicit hide is retained during score updates',()=>{
  let {s,credential}=fixture();s=model.hideDisplay(model.selectLink(s,'a'));
  s=model.update(s,'a',credential,change());assert.equal(s.hidden,true);
});
// A compare-and-set harness deliberately starts both requests from the same
// version, then retries the losing transition against the committed state.
async function race(initial, operations) {
  let state=structuredClone(initial), version=0;
  return {results:await Promise.allSettled(operations.map(async operation=>{
    for(let tries=0;tries<8;tries++) {
      const expected=version, next=operation(structuredClone(state));
      await new Promise(resolve=>setImmediate(resolve));
      if(expected!==version)continue;
      state=next;version++;return structuredClone(state);
    }
    throw Error('RETRY_LIMIT');
  })),get state(){return state;}};
}
test('atomic retry permits exactly one of two simultaneous owner claims',async()=>{
  const s=model.setEnabled(model.addLink(model.initialState(),'a','test'),'a',true);
  const result=await race(s,[s=>model.claim(s,'a','A'),s=>model.claim(s,'a','B')]);
  assert.equal(result.results.filter(r=>r.status==='fulfilled').length,1);
});
test('two simultaneous changes based on the same revision cannot overwrite',async()=>{
  const {s,credential}=fixture();
  const result=await race(s,[s=>model.update(s,'a',credential,change()),s=>model.update(s,'a',credential,change({requestId:'other',record:{scores:[2,0]}}))]);
  assert.equal(result.results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(result.state.matches['match-1'].revision,1);
});
test('disabling and input racing are serialized; final link is disabled',async()=>{
  const {s,credential}=fixture();
  const result=await race(s,[s=>model.setEnabled(s,'a',false),s=>model.update(s,'a',credential,change())]);
  assert.equal(result.state.links.a.enabled,false);
  assert.throws(()=>model.update(result.state,'a',credential,change()),/LINK_UNAVAILABLE/);
});
test('password hashes are salted; correct and incorrect values distinguished',async()=>{
  const p='synthetic-test-password-only';const a=await hashPassword(p),b=await hashPassword(p);
  assert.notEqual(a.hash,b.hash);assert.ok(!JSON.stringify(a).includes(p));
  assert.equal(await verifyPassword(p,a),true);assert.equal(await verifyPassword('incorrect',a),false);
  await assert.rejects(verifyPassword(p,{...a,iterations:1}),/INVALID_VERIFIER/);
});
test('probe has no usable default secret and denies unauthorized requests',async()=>{
  const req=()=>new Request('https://test.invalid/probe/password',{method:'POST',body:'{}'});
  assert.equal((await worker.fetch(req(),{})).status,503);
  assert.equal((await worker.fetch(req(),{PROBE_TOKEN:'synthetic',PROBE_VERIFIER:'{}'})).status,401);
  assert.equal((await worker.fetch(new Request('https://test.invalid/'),{})).status,404);
});
test('probe verifies only supplied synthetic password and rejects oversized body',async()=>{
  const env={PROBE_TOKEN:'synthetic',PROBE_VERIFIER:JSON.stringify(await hashPassword('synthetic-password'))};
  const req=body=>new Request('https://test.invalid/probe/password',{method:'POST',headers:{Authorization:'Bearer synthetic'},body});
  const result=await worker.fetch(req(JSON.stringify({password:'synthetic-password'})),env);
  assert.equal((await result.json()).valid,true);
  assert.equal((await worker.fetch(req('x'.repeat(2049)),env)).status,413);
});
