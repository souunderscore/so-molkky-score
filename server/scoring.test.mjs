import test from 'node:test';
import assert from 'node:assert/strict';
import {Scoring} from './scoring-core.mjs';
import {digest,randomToken,Management,HOME_LINK_ID,PUBLIC_HOME_KEY} from './management-core.mjs';
class Memory{
  constructor(){this.values=new Map();this.path='control';}
  at(path){const s=new Memory();s.values=this.values;s.path=path;s.hook=this.hook;return s;}
  async archiveLink(id,generation,key,record){const l=this.values.get('control')?.links?.[id];if(!l?.enabled||l.discarded||l.generation!==generation)throw Error('DB_PERMISSION_DENIED');const p='archives/'+id+'/'+key;if(!this.values.has(p))this.values.set(p,structuredClone(record));}
  async read(){return structuredClone(this.values.get(this.path)||null);}
  async mutate(fn){
    if(this.hook)await this.hook(this.path);
    const out=fn(await this.read());
    if(this.path.startsWith('rooms/')){const l=this.values.get('control')?.links?.[this.path.split('/')[1]];if(!l?.enabled||l.discarded||l.generation!==out.state.generation)throw Error('DB_PERMISSION_DENIED');}
    this.values.set(this.path,structuredClone(out.state));return out.reply;
  }
}
const snap=(n=0)=>{const teams=[{id:0,name:'A',score:n,history:[]}];return {json:JSON.stringify({phase:'playing',settings:{},teams,history:[],setResults:[]}),viewJson:JSON.stringify({phase:'playing',teams})};};
async function fixture(){const db=new Memory(),id=crypto.randomUUID(),key=randomToken(),a=randomToken(),b=randomToken();db.values.set('control',{links:{[id]:{name:'test',enabled:true,discarded:false,generation:1,capabilityHash:await digest(key)}}});const management={async authorized(token){if(token!=='manager')throw Error('MANAGEMENT_LOGIN_REQUIRED');}};return {db,id,key,a,b,s:new Scoring(db,management)};}
async function start(f){const input={...snap(),opId:crypto.randomUUID(),matchId:crypto.randomUUID(),version:null,generation:1};return {input,result:await f.s.edit(f.id,f.key,f.a,'new',input)};}
test('any device with an enabled link can edit without claiming ownership',async()=>{
  const f=await fixture(),{input}=await start(f);
  const initial=await f.s.inspect(f.id,f.key,f.b);assert.equal(initial.editingMode,'shared');assert.equal('isOwner' in initial,false);
  await f.s.edit(f.id,f.key,f.b,'save',{...input,...snap(8),opId:crypto.randomUUID(),version:1});
  await f.s.edit(f.id,f.key,f.a,'save',{...input,...snap(12),opId:crypto.randomUUID(),version:2});
  assert.equal(JSON.parse((await f.s.inspect(f.id,f.key,f.b)).current.json).teams[0].score,12);
});
test('save retries are idempotent; stale versions cannot undo a confirmed score',async()=>{
  const f=await fixture(),{input,result}=await start(f);
  const update={...input,...snap(8),opId:crypto.randomUUID(),version:result.current.version};
  const saved=await f.s.edit(f.id,f.key,f.a,'save',update),retried=await f.s.edit(f.id,f.key,f.a,'save',update);
  assert.equal(saved.current.version,retried.current.version);
  await assert.rejects(f.s.edit(f.id,f.key,f.a,'save',{...update,opId:crypto.randomUUID()}),/SCORE_CONFLICT/);
  assert.equal(JSON.parse((await f.s.inspect(f.id,f.key,f.a)).current.json).teams[0].score,8);
});
test('old owner metadata has no authority; retired handoff operations cannot change data',async()=>{
  const f=await fixture(),{input}=await start(f),r=f.db.values.get('rooms/'+f.id);
  r.owner={hash:await digest(f.a),epoch:'old'};r.transfer={id:crypto.randomUUID(),hash:await digest(f.a)};
  await f.s.edit(f.id,f.key,f.b,'save',{...input,...snap(9),opId:crypto.randomUUID(),version:1});
  const saved=f.db.values.get('rooms/'+f.id);assert.equal(saved.owner,undefined);assert.equal(saved.transfer,undefined);
  for(const op of ['claim','request','approve','cancel'])await assert.rejects(f.s.edit(f.id,f.key,f.a,op),/CLIENT_UPDATE_REQUIRED/);
});
test('disable/discard block all devices; re-enable rejects stale generations',async()=>{
  const f=await fixture(),{input}=await start(f),l=f.db.values.get('control').links[f.id];l.enabled=false;l.generation++;
  await assert.rejects(f.s.inspect(f.id,f.key,f.a),/LINK_DISABLED/);l.enabled=true;l.generation++;
  await assert.rejects(f.s.edit(f.id,f.key,f.a,'save',{...input,version:1,opId:crypto.randomUUID()}),/SCORE_CONFLICT/);
  const info=await f.s.inspect(f.id,f.key,f.b);await f.s.edit(f.id,f.key,f.b,'save',{...input,generation:info.generation,version:1,opId:crypto.randomUUID()});
  l.discarded=true;l.enabled=false;await assert.rejects(f.s.inspect(f.id,f.key,f.a),/LINK_DISCARDED/);
});
test('stale new-match requests never create archives or replace a newer score',async()=>{
  const f=await fixture(),{input}=await start(f);await f.s.edit(f.id,f.key,f.a,'save',{...input,...snap(8),version:1,opId:crypto.randomUUID()});
  await assert.rejects(f.s.edit(f.id,f.key,f.b,'new',{...input,version:1,matchId:crypto.randomUUID(),opId:crypto.randomUUID()}),/SCORE_CONFLICT/);
  assert.equal([...f.db.values.keys()].some(k=>k.startsWith('archives/')),false);
  await assert.rejects(f.s.edit(f.id,f.key,f.b,'save',{...input,generation:undefined,version:2,opId:crypto.randomUUID()}),/CLIENT_UPDATE_REQUIRED/);
});
test('disable during a pending write is rejected at database commit time',async()=>{
  const f=await fixture(),{input}=await start(f);f.db.hook=async path=>{if(path.startsWith('rooms/')){f.db.values.get('control').links[f.id].enabled=false;}};
  await assert.rejects(f.s.edit(f.id,f.key,f.a,'save',{...input,version:1,opId:crypto.randomUUID()}),/DB_PERMISSION_DENIED/);
});
test('ten parallel matches never share state; unauthorized keys are rejected',async()=>{
  const fixtures=await Promise.all(Array.from({length:10},()=>fixture()));
  await Promise.all(fixtures.map(async(f,i)=>{const {input}=await start(f);await f.s.edit(f.id,f.key,f.a,'save',{...input,...snap(i+1),version:1,opId:crypto.randomUUID()});}));
  for(let i=0;i<fixtures.length;i++){const f=fixtures[i];assert.equal(JSON.parse((await f.s.inspect(f.id,f.key,f.a)).current.json).teams[0].score,i+1);await assert.rejects(f.s.inspect(f.id,fixtures[(i+1)%10].key,f.a),/INPUT_LINK_INVALID/);}
});
test('new match archives confirmed previous record; a retry never archives itself',async()=>{
  const f=await fixture(),{input}=await start(f),next={...input,...snap(5),matchId:crypto.randomUUID(),opId:crypto.randomUUID(),version:1};
  const n=await f.s.edit(f.id,f.key,f.a,'new',next);assert.equal(n.history.length,1);assert.equal(n.current.id,next.matchId);
  const archived=await f.s.archive(f.id,f.key,f.a,n.history[0].key);assert.equal(archived.id,input.matchId);
  const retry=await f.s.edit(f.id,f.key,f.a,'new',next);assert.equal(retry.history.length,1);assert.equal(retry.current.version,2);
});
test('malformed snapshots and mismatched public scores are rejected',async()=>{
  const f=await fixture(),{input}=await start(f);
  await assert.rejects(f.s.edit(f.id,f.key,f.a,'save',{...input,version:1,opId:crypto.randomUUID(),viewJson:snap(3).viewJson}),/INVALID_SCORE/);
});

test('public home supports immediate edits from another browser without claims',async()=>{
 const db=new Memory();db.values.set('control',{initialized:true,links:{}});const management=new Management(db,{}, {inputReady:true}),s=new Scoring(db,management),a=randomToken(),b=randomToken();
 assert.equal((await s.inspect(HOME_LINK_ID,PUBLIC_HOME_KEY,a)).editingMode,'shared');assert.equal(db.values.has('rooms/'+HOME_LINK_ID),false);
 const snapshot={...snap(7),opId:crypto.randomUUID(),matchId:crypto.randomUUID(),version:null,generation:1};await s.edit(HOME_LINK_ID,PUBLIC_HOME_KEY,a,'new',snapshot);
 await s.edit(HOME_LINK_ID,PUBLIC_HOME_KEY,b,'save',{...snapshot,...snap(9),version:1,opId:crypto.randomUUID()});
 await assert.rejects(s.edit(HOME_LINK_ID,PUBLIC_HOME_KEY,a,'save',{...snapshot,version:1,opId:crypto.randomUUID()}),/SCORE_CONFLICT/);
 assert.equal(JSON.parse((await s.inspect(HOME_LINK_ID,PUBLIC_HOME_KEY,a)).current.json).teams[0].score,9);
});
