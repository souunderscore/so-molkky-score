import {FirebasePasswordProvider,prepareCredential} from '../experiments/firebase-auth/firebase-auth.mjs';
const enc=new TextEncoder(),HOUR=3600000;
const fail=code=>{throw Error(code);};
export const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
export async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(value))),x=>x.toString(16).padStart(2,'0')).join('');}
const fresh=()=>({version:1,initialized:false,revision:0,epoch:0,blocked:false,accounts:null,question:'',sessions:{},attempts:{},links:{},selectedLink:null,hidden:false,retiredAccounts:[]});
const state=current=>current||fresh();
function clean(s,now){s.sessions=Object.fromEntries(Object.entries(s.sessions||{}).filter(([,v])=>v.expires>now&&v.epoch===s.epoch));}
function session(s,hash,now){clean(s,now);if(!s.initialized||s.blocked||!s.sessions[hash])fail('MANAGEMENT_LOGIN_REQUIRED');}
function passcode(input){if(typeof input!=='string'||!/^\d{6,12}$/.test(input))fail('PASSCODE_FORMAT');}
function question(input){if(typeof input!=='string'||!input.trim()||input.trim().length>120)fail('QUESTION_FORMAT');}
function answer(input){if(typeof input!=='string'||!input.length||enc.encode(input).length>512)fail('ANSWER_FORMAT');}
const publicLink=(id,l)=>({id,name:l.name,enabled:l.enabled,discarded:l.discarded,createdAt:l.createdAt,hasInputOwner:!!l.owner});

export class CredentialAccounts{
  constructor(env,fetchImpl=(...args)=>fetch(...args)){this.env=env;this.fetch=fetchImpl;}
  provider(accounts){return new FirebasePasswordProvider({apiKey:this.env.FIREBASE_WEB_API_KEY,pepper:this.env.AUTH_PEPPER,accounts,fetchImpl:this.fetch});}
  async create(role,input){
    const email='molkky-'+role+'-'+crypto.randomUUID()+'@example.invalid';
    const password=await prepareCredential(role,input,this.env.AUTH_PEPPER);
    const response=await this.fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key='+encodeURIComponent(this.env.FIREBASE_WEB_API_KEY),{
      method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(12000),body:JSON.stringify({email,password,returnSecureToken:true})});
    if(!response.ok){await response.body?.cancel();fail('ACCOUNT_CREATE_FAILED');}
    const {readJson}=await import('./firebase-store.mjs');const data=await readJson(response,32768);
    if(!data.localId||!data.idToken)fail('ACCOUNT_CREATE_FAILED');
    return {account:{uid:data.localId,email},proof:{idToken:data.idToken}};
  }
  async remove(proof){
    if(!proof?.idToken)return false;
    const r=await this.fetch('https://identitytoolkit.googleapis.com/v1/accounts:delete?key='+encodeURIComponent(this.env.FIREBASE_WEB_API_KEY),{
      method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(12000),body:JSON.stringify({idToken:proof.idToken})});
    await r.body?.cancel();return r.ok;
  }
}

export class Management{
  constructor(store,credentials,config,now=()=>Date.now()){this.store=store;this.credentials=credentials;this.config=config;this.now=now;}
  async status(){const s=state(await this.store.read());return {initialized:s.initialized,question:s.initialized?s.question:'',setupInProgress:!!s.setupLock,resetInProgress:!!s.blocked};}
  async setup(token,input){
    if(!this.config.bootstrapHash||this.now()>this.config.bootstrapExpires||await digest(token||'')!==this.config.bootstrapHash)fail('SETUP_NOT_ALLOWED');
    passcode(input.passcode);question(input.question);answer(input.answer);
    const nonce=randomToken(),now=this.now();
    await this.store.mutate(current=>{const s=state(current);if(s.initialized)fail('ALREADY_INITIALIZED');if(s.setupLock?.expires>now)fail('SETUP_IN_PROGRESS');s.setupLock={nonce,expires:now+300000};s.revision++;return {state:s,reply:true};});
    let admin,recovery,committed=false,uncertain=false;
    try{
      admin=await this.credentials.create('admin',input.passcode);recovery=await this.credentials.create('recovery',input.answer);
      await this.store.mutate(current=>{const s=state(current);if(s.initialized||s.setupLock?.nonce!==nonce)fail('SETUP_IN_PROGRESS');s.initialized=true;s.accounts={admin:admin.account,recovery:recovery.account};s.question=input.question.trim();s.epoch++;s.sessions={};s.setupLock=null;s.revision++;return{state:s,reply:true};});
      committed=true;return{initialized:true};
    }catch(error){uncertain=error.message==='COMMIT_UNKNOWN';throw error;
    }finally{
      if(!committed&&!uncertain){if(admin)await this.credentials.remove(admin.proof);if(recovery)await this.credentials.remove(recovery.proof);}
    }
  }
  async reserve(role){
    const now=this.now();return this.store.mutate(current=>{const s=state(current);if(!s.initialized)fail('NOT_INITIALIZED');const a=s.attempts[role]||{count:0,until:now+60000};if(a.until<=now){a.count=0;a.until=now+60000;}if(a.count>=6)fail('RATE_LIMITED');a.count++;s.attempts[role]=a;s.revision++;return{state:s,reply:{epoch:s.epoch,accounts:structuredClone(s.accounts)}};});
  }
  async login(input){
    const permit=await this.reserve('admin');const proof=await this.credentials.provider(permit.accounts).verify('admin',input);
    const token=randomToken(),hash=await digest(token),now=this.now();
    await this.store.mutate(current=>{const s=state(current);if(s.blocked||s.epoch!==permit.epoch||s.accounts.admin.uid!==proof.uid)fail('STALE_AUTH');clean(s,now);s.sessions[hash]={epoch:s.epoch,expires:now+HOUR};s.attempts.admin={count:0,until:now+60000};s.revision++;return{state:s,reply:true};});
    return{token,expires:now+HOUR};
  }
  async authorized(token){const hash=await digest(token||''),s=state(await this.store.read());session(s,hash,this.now());return{hash,s};}
  async logout(token){const hash=await digest(token||'');return this.store.mutate(current=>{const s=state(current);delete s.sessions[hash];s.revision++;return{state:s,reply:{loggedOut:true}};});}
  async list(token){const {s}=await this.authorized(token);return{links:Object.entries(s.links).map(([id,l])=>publicLink(id,l)),selectedLink:s.selectedLink,hidden:s.hidden,question:s.question,inputReady:this.config.inputReady===true};}
  async editLink(token,id,operation,input={}){
    const {hash}=await this.authorized(token),now=this.now();
    // Keys are generated outside the retrying transaction and retained as
    // private control data so the manager can copy a persistent link again.
    const newId=crypto.randomUUID(),capability=randomToken(),capabilityHash=await digest(capability);
    const result=await this.store.mutate(current=>{
      const s=state(current);session(s,hash,now);let l=s.links[id];
      if(operation==='create'){
        if(typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>80)fail('LINK_NAME_FORMAT');
        if(Object.keys(s.links).length>=200)fail('LINK_LIMIT');
        id=newId;l={name:input.name.trim(),enabled:false,discarded:false,createdAt:now,capability,capabilityHash,generation:0,owner:null,matchId:null};s.links[id]=l;
      }else{
        if(!l)fail('LINK_NOT_FOUND');if(l.discarded)fail('LINK_DISCARDED');
        if(operation==='enable'||operation==='disable'){const enabled=operation==='enable';if(l.enabled!==enabled){l.enabled=enabled;l.owner=null;l.generation++;}}
        else if(operation==='discard'){l.discarded=true;l.enabled=false;l.owner=null;l.generation++;}
        else if(operation==='rename'){if(typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>80)fail('LINK_NAME_FORMAT');l.name=input.name.trim();}
        else if(operation==='select'){if(!l.enabled)fail('LINK_DISABLED');s.selectedLink=id;s.hidden=false;}
        else fail('INVALID_OPERATION');
      }
      s.revision++;return{state:s,reply:publicLink(id,l)};
    });return result;
  }
  async linkUrl(token,id){const {s}=await this.authorized(token);if(this.config.inputReady!==true)fail('INPUT_NOT_READY');const l=s.links[id];if(!l||l.discarded)fail('LINK_NOT_FOUND');const u=new URL(this.config.inputUrl);u.searchParams.set('input',id);u.hash='key='+l.capability;return{url:u.href};}
  async hide(token){const {hash}=await this.authorized(token),now=this.now();return this.store.mutate(current=>{const s=state(current);session(s,hash,now);s.hidden=true;s.revision++;return{state:s,reply:{hidden:true}};});}
  async rotate(role,currentInput,newInput,questionText=null,token=null){
    if(!token)fail('MANAGEMENT_LOGIN_REQUIRED');await this.authorized(token);
    if(role==='admin')passcode(newInput);else{question(questionText);answer(newInput);}
    const permit=await this.reserve(role),provider=this.credentials.provider(permit.accounts);
    const proof=await provider.verify(role,currentInput);
    const sessionHash=await digest(token),nonce=randomToken();let created,committed=false,uncertain=false;
    try{
      created=await this.credentials.create(role,newInput);
      await this.store.mutate(current=>{const s=state(current);if(s.epoch!==permit.epoch||s.accounts[role].uid!==proof.uid)fail('STALE_AUTH');session(s,sessionHash,this.now());s.accounts[role]=created.account;s.epoch++;s.sessions={};s.blocked=false;s.attempts[role]={count:0,until:this.now()+60000};if(role==='recovery')s.question=questionText.trim();s.revision++;return{state:s,reply:true};});
      committed=true;
      const removed=await this.credentials.remove(proof).catch(()=>false);
      if(!removed)await this.retire(proof.uid,role,nonce).catch(()=>{});
      return{changed:true,reauthenticationRequired:true};
    }catch(error){uncertain=error.message==='COMMIT_UNKNOWN';throw error;
    }finally{if(created&&!committed&&!uncertain)await this.credentials.remove(created.proof);}
  }
  async recover(secretAnswer,newPasscode){
    passcode(newPasscode);const permit=await this.reserve('recovery'),proof=await this.credentials.provider(permit.accounts).verify('recovery',secretAnswer);
    let created,committed=false,uncertain=false;
    try{
      created=await this.credentials.create('admin',newPasscode);
      await this.store.mutate(current=>{const s=state(current);if(s.epoch!==permit.epoch||s.accounts.recovery.uid!==proof.uid)fail('STALE_AUTH');s.retiredAccounts.push({uid:s.accounts.admin.uid,role:'admin',at:this.now()});s.accounts.admin=created.account;s.epoch++;s.sessions={};s.blocked=false;s.attempts.recovery={count:0,until:this.now()+60000};s.revision++;return{state:s,reply:true};});
      committed=true;return{changed:true,reauthenticationRequired:true};
    }catch(error){uncertain=error.message==='COMMIT_UNKNOWN';throw error;
    }finally{if(created&&!committed&&!uncertain)await this.credentials.remove(created.proof);}
  }
  async retire(uid,role,nonce){await this.store.mutate(current=>{const s=state(current);s.retiredAccounts.push({uid,role,at:this.now(),nonce});s.revision++;return{state:s,reply:true};});}
}
