// Owner-authorized live check. All test capabilities and backups stay in
// .private (0600); never print tokens, auth metadata, or full API responses.
import {readFile,writeFile,unlink} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {FirebaseControlStore} from './firebase-store.mjs';
import {digest,randomToken} from './management-core.mjs';
const base='https://so-molkky-score-api.sou-underscore.workers.dev';
const nativeFetch=globalThis.fetch;globalThis.fetch=(url,init={})=>nativeFetch(url,{...init,signal:init.signal||AbortSignal.timeout(20000)});
const secret=JSON.parse(await readFile(new URL('.private/storage.json',import.meta.url),'utf8'));
const env={FIREBASE_WEB_API_KEY:process.env.FIREBASE_WEB_API_KEY,FIREBASE_PROJECT_ID:'so-molkky-score',DATABASE_URL:'https://so-molkky-score-default-rtdb.asia-southeast1.firebasedatabase.app',DB_SERVICE_CONFIG:JSON.stringify({email:secret.email,password:secret.password,uid:secret.uid})};
const store=new FirebaseControlStore(env);
const checkpoint=new URL('.private/rollout.json',import.meta.url);
const phase=process.argv[2];
async function raw(path,method='GET',value){const token=await store.idToken();const r=await fetch(env.DATABASE_URL+path+'.json?auth='+encodeURIComponent(token),{method,headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(20000),...(value===undefined?{}:{body:JSON.stringify(value)})});const body=await r.json();return {status:r.status,body};}
async function api(path,body,manager){
  const data=JSON.stringify(body||{});const {spawn}=await import('node:child_process');
  // curl is used for Workers' public ingress; put credentials on stdin, never
  // on the command line or in its URL.
  let config; if(manager){config=new URL('.private/curl-'+crypto.randomUUID()+'.txt',import.meta.url);await writeFile(config,'header = \"Authorization: Bearer '+manager+'\"\n',{mode:0o600});}
  const args=['--max-time','30','-sS','-X','POST','-H','Content-Type: application/json',...(config?['--config',config.pathname]:[]),'--data-binary','@-','-w','\n%{http_code}',base+'/api/'+path];
  const p=spawn('curl',args,{stdio:['pipe','pipe','pipe']});let out='';p.stdout.on('data',b=>out+=b);p.stderr.resume();p.stdin.end(data);await new Promise((resolve,reject)=>{p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(Error('PUBLIC_API_UNAVAILABLE')))});
  if(config)await unlink(config).catch(()=>{});
  const i=out.lastIndexOf('\n');return{status:Number(out.slice(i+1)),body:JSON.parse(out.slice(0,i))};
}
async function fixture(){return JSON.parse(await readFile(checkpoint,'utf8'));}
async function input(f,id,op,device,body={}){return api('input/'+id+'/'+op,{key:f.links.find(x=>x.id===id).key,device,...body});}
const snapshot=n=>{const teams=[{id:0,name:'接続確認A',score:n,history:[]},{id:1,name:'接続確認B',score:0,history:[]}];return {json:JSON.stringify({phase:'playing',settings:{teamCount:2,targetScore:50,maxMiss:3,gameName:'接続確認',regMode:'match',regN:2},teams,currentTeamIdx:0,turnCount:0,currentSet:1,setResults:[],startedAt:Date.now(),finishedAt:null,winnerId:null,history:[]}),viewJson:JSON.stringify({phase:'playing',teams,currentTeamIdx:0,currentSet:1,turnCount:0,targetScore:50,maxMiss:3,gameName:'接続確認',regMode:'match',regN:2,recentThrows:[],setResults:[]})};};
if(phase==='prepare'){
  const current=await store.read();assert.equal(current.initialized,true);
  const oldGame=await fetch(env.DATABASE_URL+'/game.json').then(r=>r.json());
  await writeFile(new URL('.private/pre-cutover-backup.json',import.meta.url),JSON.stringify({at:Date.now(),control:current,legacyGame:oldGame}),{mode:0o600});
  const manager=randomToken(),hash=await digest(manager),links=[];
  for(let i=0;i<2;i++)links.push({id:crypto.randomUUID(),key:randomToken(),a:randomToken(),b:randomToken()});
  const f={links,manager,hash,createdAt:Date.now(),selectionChanged:false,originalSelected:current.selectedLink??null,originalHidden:current.hidden===true};
  await writeFile(checkpoint,JSON.stringify(f),{mode:0o600});
  const first=await raw('/stream_v1/rooms/'+links[0].id);assert.equal(first.status,200,'new room namespace must be permitted');assert.equal(first.body,null);
  await store.mutate(s=>{s.links ||= {};s.sessions ||= {};for(const l of links)s.links[l.id]={name:'接続確認（自動テスト）',enabled:true,discarded:false,generation:1,capability:l.key,capabilityHash:null,createdAt:Date.now(),internalTest:true};s.sessions[hash]={epoch:s.epoch,expires:Date.now()+600000};s.revision++;return{state:s,reply:true};});
  const hashes=await Promise.all(links.map(l=>digest(l.key)));
  await store.mutate(s=>{links.forEach((l,i)=>s.links[l.id].capabilityHash=hashes[i]);s.revision++;return{state:s,reply:true};});
  console.log(JSON.stringify({prepared:true,ruleAccess:true,backupSaved:true,fixtures:links.length}));
}else if(phase==='test'){
  const f=await fixture(),[l,other]=f.links;
  let a=await input(f,l.id,'claim',l.a);assert.equal(a.status,200,a.body.error);const epoch=a.body.ownerEpoch;
  const busy=await input(f,l.id,'claim',l.b);assert.equal(busy.body.error,'INPUT_BUSY');
  const initial={...snapshot(8),opId:crypto.randomUUID(),matchId:crypto.randomUUID(),version:null,ownerEpoch:epoch};
  let saved=await input(f,l.id,'new',l.a,initial);assert.equal(saved.status,200,saved.body.error);
  const again=await input(f,l.id,'new',l.a,initial);assert.equal(again.body.current.version,saved.body.current.version);
  const c=await input(f,other.id,'claim',other.a);assert.equal(c.status,200,c.body.error);
  const o=await input(f,other.id,'new',other.a,{...snapshot(12),opId:crypto.randomUUID(),matchId:crypto.randomUUID(),version:null,ownerEpoch:c.body.ownerEpoch});assert.equal(o.status,200,o.body.error);
  const inspect=await input(f,l.id,'inspect',l.a);assert.equal(JSON.parse(inspect.body.current.json).teams[0].score,8);
  let request=await input(f,l.id,'request',l.b);assert.equal(request.status,200,request.body.error);
  let transfer=await input(f,l.id,'approve',l.a,{ownerEpoch:epoch,requestId:request.body.transfer.id,version:1});assert.equal(transfer.status,200,transfer.body.error);
  let rejected=await input(f,l.id,'save',l.a,{...initial,opId:crypto.randomUUID(),version:1});assert.equal(rejected.body.error,'INPUT_OWNER_LOST');
  const b=await input(f,l.id,'inspect',l.b);assert.equal(b.body.isOwner,true);
  request=await input(f,l.id,'request',l.a);assert.equal(request.status,200,request.body.error);
  transfer=await api('admin/links/'+l.id+'/force',{requestId:request.body.transfer.id},f.manager);assert.equal(transfer.status,200,transfer.body.error);
  const current=await input(f,l.id,'inspect',l.a);assert.equal(current.body.isOwner,true);
  const next=await input(f,l.id,'new',l.a,{...snapshot(3),opId:crypto.randomUUID(),matchId:crypto.randomUUID(),version:1,ownerEpoch:current.body.ownerEpoch});assert.equal(next.status,200,next.body.error);assert.equal(next.body.history.length,1);
  const historical=await api('admin/links/'+l.id+'/archive',{archiveKey:next.body.history[0].key},f.manager);assert.equal(historical.status,200);assert.equal(JSON.parse(historical.body.json).teams[0].score,8);
  const denyPrivate=await fetch(env.DATABASE_URL+'/stream_v1/rooms/'+l.id+'/current/json.json');assert.equal(denyPrivate.status,401);await denyPrivate.body.cancel();
  // Select the fixture only if no user target is selected; keep it hidden and
  // restore the prior values only if our fixture is still selected.
  const selected=await store.mutate(s=>{if(s.selectedLink)return {state:s,reply:false};s.selectedLink=l.id;s.hidden=true;s.revision++;return{state:s,reply:true};});
  if(selected){f.selectionChanged=true;await writeFile(checkpoint,JSON.stringify(f),{mode:0o600});const pub=await fetch(env.DATABASE_URL+'/stream_v1/rooms/'+l.id+'/current/viewJson.json');assert.equal(pub.status,200);assert.equal(JSON.parse(await pub.json()).teams[0].score,3);}
  await store.mutate(s=>{s.links[l.id].enabled=false;s.links[l.id].generation++;s.revision++;return{state:s,reply:true};});
  rejected=await input(f,l.id,'inspect',l.a);assert.equal(rejected.body.error,'LINK_DISABLED');
  const oldRoom=await raw('/stream_v1/rooms/'+l.id);assert.equal((await raw('/stream_v1/rooms/'+l.id,'PUT',oldRoom.body)).status,401);
  if(selected){const frozen=await fetch(env.DATABASE_URL+'/stream_v1/rooms/'+l.id+'/current/viewJson.json');assert.equal(frozen.status,200);assert.equal(JSON.parse(await frozen.json()).teams[0].score,3);}
  console.log(JSON.stringify({liveChecksPassed:true,linkIsolation:true,duplicateRetry:true,normalAndForcedHandoff:true,archive:true,privateReadDenied:true,disabledWriteDenied:true,publicViewTested:selected}));
}else if(phase==='status'){
  const f=await fixture();for(const l of f.links){const room=await store.at('rooms/'+l.id).read();console.log(JSON.stringify({roomExists:!!room,version:room?.current?.version??null,hasOwner:!!room?.owner,hasTransfer:!!room?.transfer,history:Object.keys(room?.index||{}).length}));}
}else if(phase==='cleanup'){
  const f=await fixture();
  // Only these recorded synthetic IDs are touched. Null generation permits
  // deleting their whole room under the existing generation-fence rule.
  await store.mutate(s=>{for(const l of f.links){const v=s.links?.[l.id];if(v?.internalTest){v.enabled=true;v.discarded=false;v.generation=null;}}if(f.links.some(l=>l.id===s.selectedLink)){s.selectedLink=f.originalSelected;s.hidden=f.originalHidden;}s.revision++;return{state:s,reply:true};});
  for(const l of f.links){assert.equal((await raw('/stream_v1/rooms/'+l.id,'DELETE')).status,200);assert.equal((await raw('/stream_v1/archives/'+l.id,'DELETE')).status,200);}
  await store.mutate(s=>{for(const l of f.links)if(s.links?.[l.id]?.internalTest)delete s.links[l.id];if(s.sessions)delete s.sessions[f.hash];s.revision++;return{state:s,reply:true};});
  console.log(JSON.stringify({fixturesRemoved:true,temporarySessionRemoved:true,userRecordsPreserved:true}));
}else throw Error('Use prepare, test, or cleanup');
