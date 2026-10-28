import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCredential,FirebasePasswordProvider,ManagementAuthority} from './firebase-auth.mjs';
const pepper='synthetic-pepper-only-32-characters-minimum';
const accounts={admin:{email:'management@test.invalid',uid:'admin-uid'},recovery:{email:'recovery@test.invalid',uid:'recovery-uid'}};
const config={apiKey:'synthetic-key',pepper,accounts};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
test('same input is separated by role and server pepper; exact input retained',async()=>{
  const value=await prepareCredential('admin','123456',pepper);
  assert.equal(value,await prepareCredential('admin','123456',pepper));
  assert.notEqual(value,await prepareCredential('recovery','123456',pepper));
  assert.notEqual(value,await prepareCredential('admin','123456',pepper+'x'));
  assert.notEqual(value,await prepareCredential('admin','123456 ',pepper));
  assert.match(value,/^[0-9a-f]{64}aA1!$/);assert.ok(!value.includes('123456'));
});
test('invalid input, missing secret, role confusion and remote emulator URL fail closed',async()=>{
  await assert.rejects(prepareCredential('admin','',pepper),/INVALID_INPUT/);
  await assert.rejects(prepareCredential('admin','x','short'),/AUTH_NOT_CONFIGURED/);
  await assert.rejects(prepareCredential('member','x',pepper),/INVALID_INPUT/);
  assert.throws(()=>new FirebasePasswordProvider({...config,emulatorBase:'http://remote.invalid'}),/INVALID_EMULATOR_URL/);
  assert.throws(()=>new FirebasePasswordProvider({...config,accounts:{...accounts,recovery:accounts.admin}}),/AUTH_NOT_CONFIGURED/);
});
test('verification fixes account server-side and does not send the plaintext passcode',async()=>{
  let request;
  const p=new FirebasePasswordProvider({...config,fetchImpl:async(url,opts)=>{request={url,body:JSON.parse(opts.body)};return json({localId:'admin-uid',idToken:'synthetic-token',refreshToken:'not-returned'});}});
  const result=await p.verify('admin','123456');
  assert.equal(request.body.email,accounts.admin.email);assert.notEqual(request.body.password,'123456');
  assert.equal(request.url,'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=synthetic-key');
  assert.equal(result.uid,'admin-uid');assert.equal(result.refreshToken,undefined);
});
test('an unrelated valid Firebase user is not an administrator',async()=>{
  const p=new FirebasePasswordProvider({...config,fetchImpl:async()=>json({localId:'some-other-uid',idToken:'token'})});
  await assert.rejects(p.verify('admin','123456'),/INVALID_CREDENTIAL/);
});
test('bad credentials, disabled accounts and unexpected upstream errors do not leak details',async()=>{
  for(const status of [400,403]){
    const p=new FirebasePasswordProvider({...config,fetchImpl:async()=>json({error:{message:'USER_DISABLED internal detail'}},status)});
    await assert.rejects(p.verify('admin','123456'),/^Error: INVALID_CREDENTIAL$/);
  }
});
test('upstream limits, network failure and malformed response are not authentication success',async()=>{
  for(const [fn,error]of [[async()=>json({},429),'RATE_LIMITED'],[async()=>json({},503),'AUTH_UNAVAILABLE'],[async()=>{throw Error('network')},'AUTH_UNAVAILABLE'],[async()=>new Response('bad json'),'AUTH_UNAVAILABLE']]){
    const p=new FirebasePasswordProvider({...config,fetchImpl:fn});await assert.rejects(p.verify('admin','123456'),new RegExp(error));
  }
});
class TestStore {
  epoch=0;blocked=false;attempts=0;sessions=[];
  async reserveAttempt(){if(this.blocked)throw Error('RESET_IN_PROGRESS');if(this.attempts>=3)throw Error('RATE_LIMITED');this.attempts++;return{epoch:this.epoch};}
  async finishAttempt(_permit,success){if(success)this.attempts=0;}
  async issueSession(epoch,uid){if(this.blocked||epoch!==this.epoch)throw Error('STALE_AUTH');const s={epoch,uid};this.sessions.push(s);return s;}
  async beginCredentialChange(epoch){if(this.blocked||epoch!==this.epoch)throw Error('STALE_AUTH');this.blocked=true;this.epoch++;return{epoch:this.epoch};}
  async completeCredentialChange(change){assert.equal(change.epoch,this.epoch);this.blocked=false;}
  valid(session){return !this.blocked&&session.epoch===this.epoch;}
}
test('password change invalidates every existing management session',async()=>{
  const store=new TestStore();let current='old';
  const provider={verify:async(role,input)=>{if(input!==current)throw Error('INVALID_CREDENTIAL');return{role,uid:'admin-uid'};},changeWithProof:async(_proof,next)=>{current=next;}};
  const a=new ManagementAuthority(provider,store),s1=await a.login('old'),s2=await a.login('old');
  await a.changePassword('old','new');assert.equal(store.valid(s1),false);assert.equal(store.valid(s2),false);
  await assert.rejects(a.login('old'),/INVALID_CREDENTIAL/);assert.equal(store.valid(await a.login('new')),true);
});
test('failed provider password update leaves old sessions invalid',async()=>{
  const store=new TestStore();const p={verify:async()=>({role:'admin',uid:'admin-uid'}),changeWithProof:async()=>{throw Error('AUTH_UNAVAILABLE')}};
  const a=new ManagementAuthority(p,store),session=await a.login('old');
  await assert.rejects(a.changePassword('old','new'),/AUTH_UNAVAILABLE/);assert.equal(store.valid(session),false);
  await assert.rejects(a.login('old'),/RESET_IN_PROGRESS/);
});
test('login verified before reset cannot create a session after the reset barrier',async()=>{
  const store=new TestStore();let resolve;
  const p={verify:()=>new Promise(r=>resolve=r)};const a=new ManagementAuthority(p,store);
  const pending=a.login('old');await new Promise(r=>setImmediate(r));
  const barrier=await store.beginCredentialChange(0);await store.completeCredentialChange(barrier);
  resolve({role:'admin',uid:'admin-uid'});await assert.rejects(pending,/STALE_AUTH/);
});
test('attempt reservation limits bad guesses before provider verification',async()=>{
  const store=new TestStore();let calls=0;const p={verify:async()=>{calls++;throw Error('INVALID_CREDENTIAL')}};const a=new ManagementAuthority(p,store);
  for(let i=0;i<3;i++)await assert.rejects(a.login('wrong'),/INVALID_CREDENTIAL/);
  await assert.rejects(a.login('wrong'),/RATE_LIMITED/);assert.equal(calls,3);
});
