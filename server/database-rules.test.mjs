import test,{before,after} from 'node:test';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {FirebaseControlStore} from './firebase-store.mjs';
import {Management,digest,randomToken} from './management-core.mjs';
import {Scoring} from './scoring-core.mjs';
// Run only against a locally started official Database Emulator.
const base=process.env.MOLKKY_DATABASE_EMULATOR||'http://127.0.0.1:9005';
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base))throw Error('LOCAL_EMULATOR_REQUIRED');
let emulator;
before(async()=>{
  emulator=spawn('java',['-jar',process.env.MOLKKY_DATABASE_EMULATOR_JAR||'/tmp/firebase-database-emulator.jar','--host','127.0.0.1','--port',new URL(base).port],{stdio:['ignore','pipe','pipe']});
  let output='';emulator.stdout.on('data',b=>output+=b);emulator.stderr.on('data',b=>output+=b);
  for(let i=0;i<200;i++){try{const r=await fetch(base+'/.json?ns=demo-molkky-stream');await r.body?.cancel();return;}catch{}await new Promise(r=>setTimeout(r,100));}
  throw Error('Emulator startup failed: '+output);
});
after(()=>{emulator?.kill('SIGTERM');});
const ns='demo-molkky-stream',uid='8Noq04pxAiVZfbKKcLUGlovabKG2';
const jwt=id=>Buffer.from(JSON.stringify({alg:'none',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:id,user_id:id,aud:ns,iss:'https://securetoken.google.com/'+ns,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,firebase:{sign_in_provider:'custom'}})).toString('base64url')+'.';
async function request(path,method='GET',body,auth=null){const u=new URL(base+path+'.json');u.searchParams.set('ns',ns);if(auth)u.searchParams.set('auth',jwt(auth));return fetch(u,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});}
test('real Database rules: private control, public selection, selected display only, generation fence, ETag race',async()=>{
  const rules=JSON.parse(await readFile(new URL('database.rules.json',import.meta.url),'utf8'));
  const install=await fetch(base+'/.settings/rules.json?ns='+ns,{method:'PUT',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify(rules)});assert.equal(install.status,200,await install.text());
  await fetch(base+'/.json?ns='+ns,{method:'DELETE',headers:{Authorization:'Bearer owner'}});
  const id=crypto.randomUUID(),other=crypto.randomUUID(),key=randomToken();
  const seed={initialized:true,epoch:1,inputNames:{'test-link':{id}},links:{[id]:{inputName:'test-link',name:'a',enabled:true,discarded:false,generation:1,capabilityHash:await digest(key)},[other]:{name:'b',enabled:true,discarded:false,generation:1,capabilityHash:await digest(randomToken())}},selectedLink:id,hidden:false};
  assert.equal((await request('/stream_v1/control','PUT',seed,uid)).status,200);
  assert.equal((await request('/stream_v1/control')).status,401);assert.equal((await request('/stream_v1/control/selectedLink')).status,200);
  assert.equal((await request('/stream_v1/control','GET',undefined,'pretend-manager')).status,401);
  const localFetch=async(url,options)=>{const u=new URL(url);u.protocol='http:';u.host='127.0.0.1:9005';u.searchParams.set('ns',ns);return fetch(u,options);};
  const store=new FirebaseControlStore({FIREBASE_WEB_API_KEY:'test',FIREBASE_PROJECT_ID:ns,DATABASE_URL:'https://test.firebasedatabase.app',DB_SERVICE_CONFIG:JSON.stringify({uid})},localFetch);store.token=jwt(uid);
  // A real round trip removes empty collections; list must still work.
  const sessionHash=await digest('manager-session');await request('/stream_v1/control/sessions','PUT',{[sessionHash]:{epoch:1,expires:Date.now()+60000}},uid);
  const manager=new Management(store,{},{});assert.equal((await manager.list('manager-session')).links.length,2);
  const names=await Promise.allSettled([1,2].map(i=>manager.editLink('manager-session',null,'create',{name:'Race '+i,inputName:'race-name'})));
  assert.equal(names.filter(r=>r.status==='fulfilled').length,1);assert.equal(names.find(r=>r.status==='rejected').reason.message,'INPUT_NAME_USED');
  const namedId=names.find(r=>r.status==='fulfilled').value.id;await manager.editLink('manager-session',namedId,'discard');
  await assert.rejects(manager.editLink('manager-session',null,'create',{name:'Reuse',inputName:'race-name'}),/INPUT_NAME_USED/);
  const scoring=new Scoring(store,manager),a=randomToken(),b=randomToken();
  const device=a,info=await scoring.inspect(id,key,device);assert.equal(info.editingMode,'shared');const teams=[{id:0,name:'A',score:0,history:[]}];
  const input={generation:info.generation,opId:crypto.randomUUID(),matchId:crypto.randomUUID(),version:null,json:JSON.stringify({phase:'playing',settings:{},teams,history:[],setResults:[]}),viewJson:JSON.stringify({phase:'playing',teams})};
  const saved=await scoring.edit(id,key,device,'new',input);assert.equal(saved.current.version,1);
  const parallel=await Promise.allSettled([a,b].map((device,i)=>scoring.edit(i?'test-link':id,key,device,'save',{...input,version:1,opId:crypto.randomUUID()})));
  assert.equal(parallel.filter(r=>r.status==='fulfilled').length,1);assert.equal(parallel.find(r=>r.status==='rejected').reason.message,'SCORE_CONFLICT');
  assert.equal((await request('/stream_v1/rooms/'+id)).status,401);assert.equal((await request('/stream_v1/rooms/'+id+'/current/json')).status,401);
  assert.equal((await request('/stream_v1/rooms/'+id+'/current/viewJson')).status,200);assert.equal((await request('/stream_v1/rooms/'+other+'/current/viewJson')).status,401);
  assert.equal((await request('/stream_v1/rooms/'+id+'/current/viewJson','PUT','bad')).status,401);
  await request('/stream_v1/control/links/'+id+'/enabled','PUT',false,uid);
  const current=await store.at('rooms/'+id).read();assert.equal((await request('/stream_v1/rooms/'+id,'PUT',current,uid)).status,401);
  assert.equal((await request('/stream_v1/rooms/'+id+'/current/viewJson')).status,200);
  await request('/stream_v1/control/links/'+id+'/enabled','PUT',true,uid);await request('/stream_v1/control/links/'+id+'/generation','PUT',2,uid);
  assert.equal((await request('/stream_v1/rooms/'+id,'PUT',current,uid)).status,401);
  await assert.rejects(scoring.edit(id,key,b,'save',{...input,version:2,opId:crypto.randomUUID()}),/SCORE_CONFLICT/);
  const latest=await scoring.inspect(id,key,b);assert.equal(latest.generation,2);assert.equal(latest.editingMode,'shared');
  const resumed=await scoring.edit('test-link',undefined,b,'save',{...input,generation:2,version:2,opId:crypto.randomUUID()});assert.equal(JSON.parse(resumed.current.json).teams[0].history.length,0);
  const archiveKey=input.matchId+'-1';
  await store.archiveLink(id,2,archiveKey,saved.current);
  assert.equal((await scoring.archive('test-link',undefined,b,archiveKey)).id,input.matchId);
  const otherBefore=await store.at('rooms/'+other).read();
  await manager.editLink('manager-session',id,'discard');
  assert.equal(await store.at('rooms/'+id).read(),null);assert.equal(await store.at('archives/'+id).read(),null);
  const final=await store.read();assert.deepEqual(final.inputNames['test-link'],{retired:true});assert.equal(final.links[id],undefined);assert.equal(final.selectedLink??null,null);assert.equal(final.hidden,true);assert.equal(final.links[other].enabled,true);
  assert.deepEqual(await store.at('rooms/'+other).read(),otherBefore);
  await assert.rejects(store.archiveLink(id,2,archiveKey,saved.current),/DB_PERMISSION_DENIED/);
  assert.equal(await store.at('archives/'+id).read(),null);
  assert.equal((await request('/stream_v1/rooms/'+id,'PUT',{generation:2,...current},uid)).status,401);
  await store.purgeLink(id);assert.equal(await store.at('rooms/'+id).read(),null);
});
