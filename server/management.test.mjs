import test from 'node:test';
import assert from 'node:assert/strict';
import {Management,digest,HOME_LINK_ID,PUBLIC_HOME_KEY} from './management-core.mjs';
import {FirebaseControlStore} from './firebase-store.mjs';
class Memory{
  value=null;
  async read(){return structuredClone(this.value);}
  async mutate(fn){const out=fn(structuredClone(this.value));this.value=out.state;return out.reply;}
}
class Credentials{
  users=new Map();removed=[];
  async create(role,input){const uid=crypto.randomUUID();this.users.set(uid,{role,input});return{account:{uid,email:uid+'@test.invalid'},proof:{idToken:uid}};}
  provider(accounts){return{verify:async(role,input)=>{const uid=accounts[role].uid,user=this.users.get(uid);if(!user||user.input!==input||user.role!==role)throw Error('INVALID_CREDENTIAL');return{role,uid,idToken:uid};}};}
  async remove(proof){this.users.delete(proof.idToken);this.removed.push(proof.idToken);return true;}
}
async function fixture(){const store=new Memory(),credentials=new Credentials();let now=1000;const config={bootstrapHash:await digest('setup-secret'),bootstrapExpires:100000,inputUrl:'https://score.test/index.html',inputReady:true};const m=new Management(store,credentials,config,()=>now);return{store,credentials,m,advance:t=>now+=t};}
async function ready(){const f=await fixture();await f.m.setup('setup-secret',{passcode:'123456',question:'合成テストの質問',answer:'test answer'});const{token}=await f.m.login('123456');return{...f,token};}
test('initial setup requires unexpired secret and can run only once',async()=>{
  const f=await fixture();await assert.rejects(f.m.setup('wrong',{passcode:'123456',question:'q',answer:'a'}),/SETUP_NOT_ALLOWED/);assert.equal(f.store.value,null);
  await f.m.setup('setup-secret',{passcode:'123456',question:'q',answer:'a'});
  await assert.rejects(f.m.setup('setup-secret',{passcode:'654321',question:'q',answer:'a'}),/ALREADY_INITIALIZED/);
  assert.equal((await f.m.status()).initialized,true);assert.ok(!JSON.stringify(f.store.value).includes('123456'));
});
test('multiple enabled links remain independent and selection is retained',async()=>{
  const{m,token}=await ready();const a=await m.editLink(token,null,'create',{name:'A'}),b=await m.editLink(token,null,'create',{name:'B'});
  assert.equal(a.enabled,false);await m.editLink(token,a.id,'enable');await m.editLink(token,b.id,'enable');await m.editLink(token,a.id,'select');
  const list=await m.list(token);assert.equal(list.links.filter(l=>l.enabled&&!l.fixed).length,2);assert.equal(list.selectedLink,a.id);
  assert.ok(!JSON.stringify(list).includes('capability'));const url=await m.linkUrl(token,a.id);assert.match(url.url,/#key=[a-f0-9]{64}$/);
});
test('disabled and discarded links preserve display selection, discard cannot be undone',async()=>{
  const{m,token}=await ready();const l=await m.editLink(token,null,'create',{name:'A'});await m.editLink(token,l.id,'enable');await m.editLink(token,l.id,'select');
  await m.editLink(token,l.id,'disable');assert.equal((await m.list(token)).selectedLink,l.id);
  await m.editLink(token,l.id,'enable');await m.editLink(token,l.id,'discard');await assert.rejects(m.editLink(token,l.id,'enable'),/LINK_DISCARDED/);
  assert.equal((await m.list(token)).selectedLink,l.id);
});
test('repeated enable does not revoke owner, actual disable invalidates generation',async()=>{
  const{m,token,store}=await ready();const l=await m.editLink(token,null,'create',{name:'A'});await m.editLink(token,l.id,'enable');
  const generation=store.value.links[l.id].generation;store.value.links[l.id].owner='input-owner';await m.editLink(token,l.id,'enable');
  assert.equal(store.value.links[l.id].owner,'input-owner');assert.equal(store.value.links[l.id].generation,generation);
  await m.editLink(token,l.id,'disable');assert.equal(store.value.links[l.id].owner,null);assert.equal(store.value.links[l.id].generation,generation+1);
});
test('unauthorized session cannot list, reveal or modify links',async()=>{
  const{m,token}=await ready();const l=await m.editLink(token,null,'create',{name:'A'});
  for(const operation of [()=>m.list('bad'),()=>m.linkUrl('bad',l.id),()=>m.editLink('bad',l.id,'enable'),()=>m.hide('bad')])await assert.rejects(operation(),/MANAGEMENT_LOGIN_REQUIRED/);
});
test('input URLs cannot be shared before scoring integration is enabled',async()=>{
  const{m,token}=await ready();const l=await m.editLink(token,null,'create',{name:'A'});m.config.inputReady=false;
  assert.equal((await m.list(token)).inputReady,false);await assert.rejects(m.linkUrl(token,l.id),/INPUT_NOT_READY/);
});
test('expiry and explicit logout revoke management access',async()=>{
  const{m,token,advance}=await ready();await m.logout(token);await assert.rejects(m.list(token),/MANAGEMENT_LOGIN_REQUIRED/);
  const next=await m.login('123456');advance(3600001);await assert.rejects(m.list(next.token),/MANAGEMENT_LOGIN_REQUIRED/);
});
test('passcode change rotates pinned account and revokes all existing sessions',async()=>{
  const{m,token,store,credentials}=await ready();const oldUid=store.value.accounts.admin.uid,second=await m.login('123456');
  await m.rotate('admin','123456','987654',null,token);
  assert.notEqual(store.value.accounts.admin.uid,oldUid);assert.ok(credentials.removed.includes(oldUid));
  await assert.rejects(m.list(token),/MANAGEMENT_LOGIN_REQUIRED/);await assert.rejects(m.list(second.token),/MANAGEMENT_LOGIN_REQUIRED/);
  await assert.rejects(m.login('123456'),/INVALID_CREDENTIAL/);assert.ok((await m.login('987654')).token);
});
test('forgotten passcode recovers without privileged Firebase Admin credentials',async()=>{
  const{m,token,store}=await ready();const old=store.value.accounts.admin.uid;
  await m.recover('test answer','222333');assert.notEqual(store.value.accounts.admin.uid,old);assert.equal(store.value.retiredAccounts[0].uid,old);
  await assert.rejects(m.list(token),/MANAGEMENT_LOGIN_REQUIRED/);await assert.rejects(m.login('123456'),/INVALID_CREDENTIAL/);assert.ok((await m.login('222333')).token);
});
test('changing secret question needs management session and current answer',async()=>{
  const{m,token,store}=await ready();await assert.rejects(m.rotate('recovery','wrong','new answer','new question',token),/INVALID_CREDENTIAL/);
  await assert.rejects(m.rotate('recovery','test answer','new answer','new question','invalid'),/MANAGEMENT_LOGIN_REQUIRED/);
  await m.rotate('recovery','test answer','new answer','new question',token);assert.equal(store.value.question,'new question');
  await assert.rejects(m.recover('test answer','333444'),/INVALID_CREDENTIAL/);await m.recover('new answer','333444');assert.ok((await m.login('333444')).token);
});
test('failed guesses are persistently limited before password verification',async()=>{
  const{m,advance}=await ready();for(let i=0;i<6;i++)await assert.rejects(m.login('bad'),/INVALID_CREDENTIAL/);
  await assert.rejects(m.login('123456'),/RATE_LIMITED/);advance(60001);assert.ok((await m.login('123456')).token);
});
test('an in-flight old login cannot issue a session after recovery changes the epoch',async()=>{
  const{m,credentials}=await ready();const original=credentials.provider.bind(credentials);let release;
  credentials.provider=accounts=>{const provider=original(accounts);return{verify:(role,input)=>role==='admin'&&input==='123456'?new Promise(resolve=>{release=()=>provider.verify(role,input).then(resolve);}):provider.verify(role,input)};};
  const pending=m.login('123456');await new Promise(resolve=>setImmediate(resolve));
  await m.recover('test answer','444555');release();await assert.rejects(pending,/STALE_AUTH/);
});
test('unknown setup commit must not delete newly active credentials',async()=>{
  const f=await fixture(),base=f.store.mutate.bind(f.store);let calls=0;
  f.store.mutate=async fn=>{const out=await base(fn);if(++calls===2)throw Error('COMMIT_UNKNOWN');return out;};
  await assert.rejects(f.m.setup('setup-secret',{passcode:'123456',question:'q',answer:'a'}),/COMMIT_UNKNOWN/);
  assert.equal(f.store.value.initialized,true);assert.equal(f.credentials.removed.length,0);assert.ok((await f.m.login('123456')).token);
});
test('Firebase REST conditional writes retry against new state instead of losing changes',async()=>{
  let value=null,version=0,conflicts=0;
  const env={FIREBASE_WEB_API_KEY:'key',FIREBASE_PROJECT_ID:'test',DATABASE_URL:'https://test.firebasedatabase.app',DB_SERVICE_CONFIG:JSON.stringify({uid:'service',email:'s@test.invalid',password:'synthetic'})};
  const fake=async(url,opts)=>{
    if(url.startsWith('https://identitytoolkit'))return Response.json({localId:'service',idToken:'synthetic-token'});
    assert.ok(url.includes('/stream_v1/control.json?auth='));
    if(opts.method==='GET'){const snapshot=structuredClone(value),etag='"'+version+'"';await new Promise(r=>setImmediate(r));return new Response(JSON.stringify(snapshot),{headers:{etag}});}
    if(opts.headers['if-match']!=='"'+version+'"'){conflicts++;return new Response('null',{status:412});}
    value=JSON.parse(opts.body);version++;return Response.json(value);
  };
  const a=new FirebaseControlStore(env,fake),b=new FirebaseControlStore(env,fake);
  const update=current=>({state:{count:(current?.count||0)+1},reply:true});
  await Promise.all([a.mutate(update),b.mutate(update)]);assert.equal(value.count,2);assert.ok(conflicts>0);
});

test('home is a persistent public link; management cannot disable, discard or rename it',async()=>{
  const {m,token,store}=await ready();
  const existing=await m.editLink(token,null,'create',{name:'Existing'});await m.editLink(token,existing.id,'enable');await m.editLink(token,existing.id,'select');
  const first=await m.list(token),home=first.links.find(l=>l.fixed);assert.equal(home.id,HOME_LINK_ID);assert.equal(home.enabled,true);assert.equal(home.discarded,false);assert.equal(first.selectedLink,existing.id);
  const revision=store.value.revision;await m.ensureHome();assert.equal(store.value.revision,revision);assert.equal(store.value.links[HOME_LINK_ID].capability,PUBLIC_HOME_KEY);
  for(const op of ['disable','discard','rename','enable'])await assert.rejects(m.editLink(token,HOME_LINK_ID,op,{name:'Changed'}),/HOME_LINK_FIXED/);
  assert.equal((await m.linkUrl(token,HOME_LINK_ID)).url,'https://score.test/index.html');await m.editLink(token,HOME_LINK_ID,'select');assert.equal((await m.list(token)).selectedLink,HOME_LINK_ID);
  assert.equal(store.value.links[existing.id].name,'Existing');
});
test('public home cannot initialize an unconfigured application',async()=>{const{m,store}=await fixture();await assert.rejects(m.ensureHome(),/INPUT_NOT_READY/);assert.equal(store.value,null);});
