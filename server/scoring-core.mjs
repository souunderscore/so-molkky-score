import {digest,randomToken,HOME_LINK_ID,PUBLIC_HOME_KEY} from './management-core.mjs';
const fail=code=>{throw Error(code);};
const uuid=v=>typeof v==='string'&&/^[0-9a-f-]{36}$/.test(v);
const secret=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const clone=v=>structuredClone(v);
function room(value,generation){
  if(!value)return {generation,revision:0,current:null,owner:null,transfer:null,index:{}};
  const r={...value,index:value.index||{}};
  if(r.generation!==generation){r.generation=generation;r.owner=null;r.transfer=null;}
  return r;
}
function owned(r,hash,epoch){if(!r.owner||r.owner.hash!==hash||r.owner.epoch!==epoch)fail('INPUT_OWNER_LOST');}
function validateSnapshot(json,viewJson){
  if(typeof json!=='string'||typeof viewJson!=='string'||new TextEncoder().encode(json).length>350000||new TextEncoder().encode(viewJson).length>100000)fail('SCORE_TOO_LARGE');
  let s,v;try{s=JSON.parse(json);v=JSON.parse(viewJson);}catch{fail('INVALID_SCORE');}
  if(!s||!['setup','playing','set_finished','finished'].includes(s.phase)||!s.settings||!Array.isArray(s.teams)||s.teams.length>6||!Array.isArray(s.history)||s.history.length>50||!Array.isArray(s.setResults))fail('INVALID_SCORE');
  if(!v||v.phase!==s.phase||!Array.isArray(v.teams)||v.teams.length!==s.teams.length)fail('INVALID_SCORE');
  for(let i=0;i<s.teams.length;i++){
    const t=s.teams[i],p=v.teams[i];
    if(typeof t.name!=='string'||t.name.length>200||!Number.isFinite(t.score)||t.score<0||!Array.isArray(t.history)||p.name!==t.name||p.score!==t.score)fail('INVALID_SCORE');
  }
  return s;
}
function summary(r,hash){return {revision:r.revision,generation:r.generation,isOwner:!!r.owner&&r.owner.hash===hash,ownerEpoch:r.owner?.hash===hash?r.owner.epoch:null,hasOwner:!!r.owner,current:r.current||null,transfer:r.transfer?{id:r.transfer.id,requestedAt:r.transfer.requestedAt,isRequester:r.transfer.hash===hash}:null,history:Object.values(r.index||{}).sort((a,b)=>b.at-a.at)};}

// Each link has its own ETag transaction. Rules check its generation against
// control at commit time, so a concurrent disable/discard rejects late writes.
export class Scoring{
  constructor(control,management,now=()=>Date.now()){this.control=control;this.management=management;this.now=now;}
  async permit(id,key,device){
    if(!uuid(id)||!secret(key)||!secret(device))fail('INPUT_LINK_INVALID');
    let s=await this.control.read();
    if(id===HOME_LINK_ID&&key===PUBLIC_HOME_KEY&&!s?.links?.[id]){await this.management.ensureHome();s=await this.control.read();}
    const l=s?.links?.[id];
    if(!l||await digest(key)!==l.capabilityHash)fail('INPUT_LINK_INVALID');
    if(l.discarded||l.deleting)fail('LINK_DISCARDED');if(!l.enabled)fail('LINK_DISABLED');
    return {l,hash:await digest(device),store:this.control.at('rooms/'+id)};
  }
  async inspect(id,key,device){const {l,hash,store}=await this.permit(id,key,device);return {name:l.name,...summary(room(await store.read(),l.generation),hash)};}
  async edit(id,key,device,operation,input={}){
    const {l,hash,store}=await this.permit(id,key,device),now=this.now();
    const epoch=randomToken(),requestId=crypto.randomUUID();
    if(operation==='save'||operation==='new'){
      if(!uuid(input.opId)||!uuid(input.matchId))fail('INVALID_SCORE');
      validateSnapshot(input.json,input.viewJson);
    }
    // Archive the last server-confirmed match before replacing it. The archive
    // is immutable and keyed by the old match id + version, so retry is safe.
    let archived=null;
    if(operation==='new'){
      const before=room(await store.read(),l.generation);owned(before,hash,input.ownerEpoch);
      if(before.current&&before.current.id!==input.matchId){
        const c=before.current,archiveKey=c.id+'-'+c.version;
        await this.control.archiveLink(id,l.generation,archiveKey,{...c,at:now});
        archived={key:archiveKey,id:c.id,version:c.version,at:now};
      }
    }
    return store.mutate(value=>{
      const r=room(value,l.generation);
      if(operation==='claim'){
        if(r.owner&&r.owner.hash!==hash)fail('INPUT_BUSY');
        if(!r.owner)r.owner={hash,epoch};
      }else if(operation==='request'){
        if(r.owner?.hash===hash)fail('ALREADY_INPUT_OWNER');
        if(!r.owner)fail('NO_INPUT_OWNER');
        if(r.transfer?.expires>now&&r.transfer.hash!==hash)fail('HANDOFF_PENDING');
        if(!r.transfer||r.transfer.expires<=now)r.transfer={id:requestId,hash,requestedAt:now,expires:now+300000};
      }else if(operation==='approve'){
        owned(r,hash,input.ownerEpoch);
        if(!r.transfer||r.transfer.id!==input.requestId||r.transfer.expires<=now)fail('HANDOFF_EXPIRED');
        if(r.current?.version!==(input.version??null))fail('SCORE_CONFLICT');
        r.owner={hash:r.transfer.hash,epoch};r.transfer=null;
      }else if(operation==='cancel'){
        if(r.transfer?.hash===hash||r.owner?.hash===hash)r.transfer=null;else fail('INPUT_OWNER_LOST');
      }else if(operation==='save'||operation==='new'){
        owned(r,hash,input.ownerEpoch);
        if(r.current?.opId===input.opId)return {state:r,reply:summary(r,hash)};
        if((r.current?.version??null)!==(input.version??null))fail('SCORE_CONFLICT');
        if(operation==='save'&&r.current?.id!==input.matchId)fail('SCORE_CONFLICT');
        if(operation==='new'&&r.current?.id===input.matchId)fail('SCORE_CONFLICT');
        if(operation==='new'&&r.current){
          if(!archived||archived.id!==r.current.id||archived.version!==r.current.version)fail('SCORE_CONFLICT');
          if(Object.keys(r.index).length>=1000)fail('MATCH_LIMIT');
          r.index[archived.key]=archived;
        }
        r.current={id:input.matchId,version:(r.current?.version||0)+1,opId:input.opId,json:input.json,viewJson:input.viewJson,updatedAt:now};
      }else fail('INVALID_OPERATION');
      r.revision++;return {state:r,reply:summary(r,hash)};
    });
  }
  async force(token,id,requestId){
    await this.management.authorized(token);
    const c=await this.control.read(),l=c?.links?.[id];if(!l||!l.enabled||l.discarded||l.deleting)fail('LINK_DISABLED');
    const epoch=randomToken(),now=this.now();
    return this.control.at('rooms/'+id).mutate(value=>{
      const r=room(value,l.generation);
      if(!r.transfer||r.transfer.id!==requestId||r.transfer.expires<=now)fail('HANDOFF_EXPIRED');
      r.owner={hash:r.transfer.hash,epoch};r.transfer=null;r.revision++;
      return{state:r,reply:{transferred:true}};
    });
  }
  async pending(token,id){await this.management.authorized(token);if(!uuid(id))fail('INPUT_LINK_INVALID');const r=await this.control.at('rooms/'+id).read();return{requestId:r?.transfer?.expires>this.now()?r.transfer.id:null,hasOwner:!!r?.owner};}
  async records(token,id){await this.management.authorized(token);if(!uuid(id))fail('INPUT_LINK_INVALID');const r=await this.control.at('rooms/'+id).read();return {current:r?.current||null,history:Object.values(r?.index||{})};}
  async adminArchive(token,id,archiveKey){await this.management.authorized(token);if(!uuid(id)||!/^[0-9a-f-]{36}-\d+$/.test(archiveKey))fail('MATCH_NOT_FOUND');const r=await this.control.at('archives/'+id+'/'+archiveKey).read();if(!r)fail('MATCH_NOT_FOUND');return r;}
  async archive(id,key,device,archiveKey){
    await this.permit(id,key,device);if(!/^[0-9a-f-]{36}-\d+$/.test(archiveKey))fail('MATCH_NOT_FOUND');
    const value=await this.control.at('archives/'+id+'/'+archiveKey).read();if(!value)fail('MATCH_NOT_FOUND');return value;
  }
}
