import {digest,inputName,HOME_LINK_ID,PUBLIC_HOME_KEY} from './management-core.mjs';
const fail=code=>{throw Error(code);};
const uuid=v=>typeof v==='string'&&/^[0-9a-f-]{36}$/.test(v);
const secret=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function room(value,generation){
  const {owner,transfer,...data}=value||{};
  return {...data,generation,revision:data.revision||0,current:data.current||null,index:data.index||{}};
}
function currentVersion(r,input,generation){
  if(input.generation===undefined)fail('CLIENT_UPDATE_REQUIRED');
  if(input.generation!==generation||(r.current?.version??null)!==(input.version??null))fail('SCORE_CONFLICT');
}
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
function summary(r){return {editingMode:'shared',revision:r.revision,generation:r.generation,current:r.current||null,history:Object.values(r.index||{}).sort((a,b)=>b.at-a.at)};}

// Each link has its own ETag transaction. Rules check its generation against
// control at commit time, so a concurrent disable/discard rejects late writes.
export class Scoring{
  constructor(control,management,now=()=>Date.now()){this.control=control;this.management=management;this.now=now;}
  async permit(id,key,device){
    if(typeof id!=='string'||!secret(device))fail('INPUT_LINK_INVALID');
    const named=!uuid(id);let urlName;
    if(named){try{urlName=inputName(id);}catch{fail('INPUT_LINK_INVALID');}}else if(!secret(key))fail('INPUT_LINK_INVALID');
    let s=await this.control.read();
    if(id===HOME_LINK_ID&&key===PUBLIC_HOME_KEY&&!s?.links?.[id]){await this.management.ensureHome();s=await this.control.read();}
    if(named){const entry=Object.hasOwn(s?.inputNames||{},urlName)?s.inputNames[urlName]:null;if(entry?.retired)fail('LINK_DISCARDED');if(!entry?.id)fail('INPUT_LINK_INVALID');id=entry.id;}
    const l=s?.links?.[id];
    if(!l||(named?l.inputName!==urlName:await digest(key)!==l.capabilityHash))fail('INPUT_LINK_INVALID');
    if(l.discarded||l.deleting)fail('LINK_DISCARDED');if(!l.enabled)fail('LINK_DISABLED');
    return {id,l,store:this.control.at('rooms/'+id)};
  }
  async inspect(id,key,device){const {l,store}=await this.permit(id,key,device);return {name:l.name,...summary(room(await store.read(),l.generation))};}
  async edit(link,key,device,operation,input={}){
    const {id,l,store}=await this.permit(link,key,device),now=this.now();
    if(operation!=='save'&&operation!=='new')fail('CLIENT_UPDATE_REQUIRED');
    if(operation==='save'||operation==='new'){
      if(!uuid(input.opId)||!uuid(input.matchId))fail('INVALID_SCORE');
      validateSnapshot(input.json,input.viewJson);
    }
    // Archive the last server-confirmed match before replacing it. The archive
    // is immutable and keyed by the old match id + version, so retry is safe.
    let archived=null;
    if(operation==='new'){
      const before=room(await store.read(),l.generation);
      if(before.current?.opId!==input.opId)currentVersion(before,input,l.generation);
      if(before.current&&before.current.id!==input.matchId){
        const c=before.current,archiveKey=c.id+'-'+c.version;
        await this.control.archiveLink(id,l.generation,archiveKey,{...c,at:now});
        archived={key:archiveKey,id:c.id,version:c.version,at:now};
      }
    }
    return store.mutate(value=>{
      const r=room(value,l.generation);
      if(operation==='save'||operation==='new'){
        if(r.current?.opId===input.opId){
          if(input.generation!==l.generation)fail('SCORE_CONFLICT');
          return {state:r,reply:summary(r)};
        }
        currentVersion(r,input,l.generation);
        if(operation==='save'&&r.current?.id!==input.matchId)fail('SCORE_CONFLICT');
        if(operation==='new'&&r.current?.id===input.matchId)fail('SCORE_CONFLICT');
        if(operation==='new'&&r.current){
          if(!archived||archived.id!==r.current.id||archived.version!==r.current.version)fail('SCORE_CONFLICT');
          if(Object.keys(r.index).length>=1000)fail('MATCH_LIMIT');
          r.index[archived.key]=archived;
        }
        r.current={id:input.matchId,version:(r.current?.version||0)+1,opId:input.opId,json:input.json,viewJson:input.viewJson,updatedAt:now};
      }else fail('INVALID_OPERATION');
      r.revision++;return {state:r,reply:summary(r)};
    });
  }
  async records(token,id){await this.management.authorized(token);if(!uuid(id))fail('INPUT_LINK_INVALID');const r=await this.control.at('rooms/'+id).read();return {current:r?.current||null,history:Object.values(r?.index||{})};}
  async adminArchive(token,id,archiveKey){await this.management.authorized(token);if(!uuid(id)||!/^[0-9a-f-]{36}-\d+$/.test(archiveKey))fail('MATCH_NOT_FOUND');const r=await this.control.at('archives/'+id+'/'+archiveKey).read();if(!r)fail('MATCH_NOT_FOUND');return r;}
  async archive(id,key,device,archiveKey){
    const {id:canonicalId}=await this.permit(id,key,device);if(!/^[0-9a-f-]{36}-\d+$/.test(archiveKey))fail('MATCH_NOT_FOUND');
    const value=await this.control.at('archives/'+canonicalId+'/'+archiveKey).read();if(!value)fail('MATCH_NOT_FOUND');return value;
  }
}
