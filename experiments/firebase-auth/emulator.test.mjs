// Official Auth Emulator implementation, pinned via firebase-tools 15.34.1.
// This program starts it only on loopback and never connects to a live project.
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {prepareCredential,FirebasePasswordProvider} from './firebase-auth.mjs';
const require=createRequire(import.meta.url);
const {createApp}=require('firebase-tools/lib/emulator/auth/server.js');
const project='demo-molkky-auth-proof';
const app=await createApp(project);
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
const pepper='synthetic-only-pepper-never-used-in-production';
async function call(path,body,privileged=false){
  const response=await fetch(base+'/identitytoolkit.googleapis.com/v1/'+path+'?key=synthetic-emulator-key',{
    method:'POST',headers:{'Content-Type':'application/json',...(privileged?{Authorization:'Bearer owner'}:{})},body:JSON.stringify(body)});
  return{status:response.status,data:await response.json()};
}
async function fixture(){
  const accounts={};
  for(const role of ['admin','recovery']){
    const email=`${role}-${crypto.randomUUID()}@test.invalid`;
    const password=await prepareCredential(role,role==='admin'?'123456':'合成テスト専用の答え',pepper);
    const result=await call('accounts:signUp',{email,password,returnSecureToken:true});
    assert.equal(result.status,200,JSON.stringify(result.data));accounts[role]={email,uid:result.data.localId};
  }
  return {accounts,provider:new FirebasePasswordProvider({apiKey:'synthetic-emulator-key',pepper,accounts,emulatorBase:base})};
}
test('Auth Emulator: correct admin passcode accepted, incorrect rejected',async()=>{
  const{provider,accounts}=await fixture();
  assert.equal((await provider.verify('admin','123456')).uid,accounts.admin.uid);
  await assert.rejects(provider.verify('admin','654321'),/INVALID_CREDENTIAL/);
});
test('Auth Emulator: separate recovery account accepts only the answer',async()=>{
  const{provider,accounts}=await fixture();const proof=await provider.verify('recovery','合成テスト専用の答え');
  assert.equal(proof.uid,accounts.recovery.uid);assert.notEqual(proof.uid,accounts.admin.uid);
  await assert.rejects(provider.verify('recovery','123456'),/INVALID_CREDENTIAL/);
  await assert.rejects(provider.verify('admin','合成テスト専用の答え'),/INVALID_CREDENTIAL/);
});
test('Auth Emulator: changing passcode invalidates the old password',async()=>{
  const{provider}=await fixture();const proof=await provider.verify('admin','123456');
  await provider.changeWithProof(proof,'987654');
  await assert.rejects(provider.verify('admin','123456'),/INVALID_CREDENTIAL/);
  assert.equal((await provider.verify('admin','987654')).role,'admin');
});
test('Auth Emulator: recovery proof can change only recovery account',async()=>{
  const{provider}=await fixture();const proof=await provider.verify('recovery','合成テスト専用の答え');
  await provider.changeWithProof(proof,'変更後の合成テスト用回答');
  await assert.rejects(provider.verify('recovery','合成テスト専用の答え'),/INVALID_CREDENTIAL/);
  assert.equal((await provider.verify('admin','123456')).role,'admin');
  assert.equal((await provider.verify('recovery','変更後の合成テスト用回答')).role,'recovery');
});
test('Auth Emulator: disabled account cannot authenticate',async()=>{
  const{provider,accounts}=await fixture();
  const result=await call(`projects/${project}/accounts:update`,{localId:accounts.admin.uid,disableUser:true},true);
  assert.equal(result.status,200,JSON.stringify(result.data));
  await assert.rejects(provider.verify('admin','123456'),/INVALID_CREDENTIAL/);
});
test('Auth Emulator: privileged reset primitive can replace admin password after recovery verification',async()=>{
  const{provider,accounts}=await fixture();
  // This is a feasibility check, NOT a deployed password-reset endpoint.
  // The real coordinator must enforce throttling and invalidate all management
  // sessions before invoking a privileged Auth Admin API adapter.
  await provider.verify('recovery','合成テスト専用の答え');
  const password=await prepareCredential('admin','222333',pepper);
  const result=await call(`projects/${project}/accounts:update`,{localId:accounts.admin.uid,password},true);
  assert.equal(result.status,200,JSON.stringify(result.data));
  await assert.rejects(provider.verify('admin','123456'),/INVALID_CREDENTIAL/);
  assert.equal((await provider.verify('admin','222333')).uid,accounts.admin.uid);
});
