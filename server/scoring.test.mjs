import test from 'node:test';
import assert from 'node:assert/strict';
import {Scoring} from './scoring-core.mjs';
import {digest,randomToken} from './management-core.mjs';
class Memory{
  constructor(){this.values=new Map();this.path='control';}
  at(path){const s=new Memory();s.values=this.values;s.path=path;s.hook=this.hook;return s;}
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
async function start(f){const claimed=await f.s.edit(f.id,f.key,f.a,'claim');const input={...snap(),opId:crypto.randomUUID(),matchId:crypto.randomUUID(),version:null,ownerEpoch:claimed.ownerEpoch};return {input,result:await f.s.edit(f.id,f.key,f.a,'new',input)};}
test('only one device can claim; link knowledge does not permit an overwrite',async()=>{
  const f=await fixture();const results=await Promise.allSettled([f.s.edit(f.id,f.key,f.a,'claim'),f.s.edit(f.id,f.key,f.b,'claim')]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  const other=(await f.s.inspect(f.id,f.key,f.b)).isOwner?f.a:f.b;
  await assert.rejects(f.s.edit(f.id,f.key,other,'save',{...snap(),opId:crypto.randomUUID(),matchId:crypto.randomUUID()}),/INPUT_OWNER_LOST/);
});
test('save retries are idempotent; stale versions cannot undo a confirmed score',async()=>{
  const f=await fixture(),{input,result}=await start(f);
  const update={...input,...snap(8),opId:crypto.randomUUID(),version:result.current.version};
  const saved=await f.s.edit(f.id,f.key,f.a,'save',update),retried=await f.s.edit(f.id,f.key,f.a,'save',update);
  assert.equal(saved.current.version,retried.current.version);
  await assert.rejects(f.s.edit(f.id,f.key,f.a,'save',{...update,opId:crypto.randomUUID()}),/SCORE_CONFLICT/);
  assert.equal(JSON.parse((await f.s.inspect(f.id,f.key,f.a)).current.json).teams[0].score,8);
});
test('normal handoff requires current owner approval and excludes the old owner',async()=>{
  const f=await fixture(),{input,result}=await start(f);await f.s.edit(f.id,f.key,f.b,'request');
  const status=await f.s.inspect(f.id,f.key,f.a);await f.s.edit(f.id,f.key,f.a,'approve',{ownerEpoch:input.ownerEpoch,requestId:status.transfer.id,version:result.current.version});
  assert.equal((await f.s.inspect(f.id,f.key,f.b)).isOwner,true);
  await assert.rejects(f.s.edit(f.id,f.key,f.a,'save',{...input,opId:crypto.randomUUID(),version:1}),/INPUT_OWNER_LOST/);
});
test('force handoff requires management session and only transfers confirmed data',async()=>{
  const f=await fixture();await start(f);const request=await f.s.edit(f.id,f.key,f.b,'request');
  await assert.rejects(f.s.force('wrong',f.id,request.transfer.id),/MANAGEMENT_LOGIN_REQUIRED/);
  await f.s.force('manager',f.id,request.transfer.id);const status=await f.s.inspect(f.id,f.key,f.b);assert.equal(status.isOwner,true);assert.equal(JSON.parse(status.current.json).teams[0].score,0);
});
test('disable and discard block writes, re-enable revokes the old owner epoch',async()=>{
  const f=await fixture(),{input}=await start(f);const l=f.db.values.get('control').links[f.id];l.enabled=false;l.generation++;
  await assert.rejects(f.s.inspect(f.id,f.key,f.a),/LINK_DISABLED/);l.enabled=true;l.generation++;
  await assert.rejects(f.s.edit(f.id,f.key,f.a,'save',{...input,version:1,opId:crypto.randomUUID()}),/INPUT_OWNER_LOST/);
  assert.equal((await f.s.inspect(f.id,f.key,f.a)).hasOwner,false);l.discarded=true;l.enabled=false;
  await assert.rejects(f.s.edit(f.id,f.key,f.b,'claim'),/LINK_DISCARDED/);
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
