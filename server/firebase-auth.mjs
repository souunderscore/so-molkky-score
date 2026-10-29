// Server-side candidate. Firebase does the slow password verification.
// Never return the provider's Firebase tokens to the management browser.
const enc = new TextEncoder();
const roles = new Set(['admin', 'recovery']);
export async function prepareCredential(role, input, pepper) {
  if (!roles.has(role) || typeof input !== 'string' || !input.length || enc.encode(input).length > 1024) throw Error('INVALID_INPUT');
  if (typeof pepper !== 'string' || enc.encode(pepper).length < 32) throw Error('AUTH_NOT_CONFIGURED');
  const key = await crypto.subtle.importKey('raw', enc.encode(pepper), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const result = await crypto.subtle.sign('HMAC', key, enc.encode(JSON.stringify(['molkky-auth-v1',role,input])));
  // The suffix accommodates common Firebase password-policy character classes.
  // HMAC is NOT the password verifier; Firebase stores a slow password hash.
  return Array.from(new Uint8Array(result), x=>x.toString(16).padStart(2,'0')).join('')+'aA1!';
}

export class FirebasePasswordProvider {
  constructor({apiKey,pepper,accounts,fetchImpl=fetch,emulatorBase=null}) {
    if (!apiKey || typeof apiKey!=='string') throw Error('AUTH_NOT_CONFIGURED');
    if (typeof pepper!=='string' || enc.encode(pepper).length<32) throw Error('AUTH_NOT_CONFIGURED');
    if (!accounts?.admin?.uid || !accounts?.recovery?.uid || !accounts.admin.email || !accounts.recovery.email || accounts.admin.uid===accounts.recovery.uid || accounts.admin.email===accounts.recovery.email) throw Error('AUTH_NOT_CONFIGURED');
    let base='https://identitytoolkit.googleapis.com/v1';
    if (emulatorBase!==null) {
      const url=new URL(emulatorBase);
      if(url.protocol!=='http:' || url.hostname!=='127.0.0.1' || url.username || url.password || url.search || url.hash) throw Error('INVALID_EMULATOR_URL');
      base=url.href.replace(/\/$/,'')+'/identitytoolkit.googleapis.com/v1';
    }
    // Workers' native fetch rejects a provider instance as its receiver.
    // Call the injected function without binding `this` to this class.
    this.apiKey=apiKey;this.pepper=pepper;this.accounts=structuredClone(accounts);this.fetch=(...args)=>fetchImpl(...args);this.base=base;
  }
  async call(method,body) {
    let response;
    try {
      response=await this.fetch(`${this.base}/accounts:${method}?key=${encodeURIComponent(this.apiKey)}`,{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)
      });
    } catch (error) { throw new Error('AUTH_UNAVAILABLE',{cause:{stage:'fetch',name:error.name}}); }
    // Error text may contain provider details: do not expose it to the caller.
    if(response.status===429){await response.body?.cancel();throw Error('RATE_LIMITED');}
    if(response.status>=500){await response.body?.cancel();throw new Error('AUTH_UNAVAILABLE',{cause:{stage:'upstream',status:response.status}});}
    if(!response.ok){await response.body?.cancel();throw Error('INVALID_CREDENTIAL');}
    let data;
    try {
      const reader=response.body.getReader();let size=0,chunks=[];
      for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>32768){await reader.cancel();throw Error('TOO_LARGE');}chunks.push(value);}
      const raw=new Uint8Array(size);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}
      data=JSON.parse(new TextDecoder().decode(raw));
    } catch (error) {throw new Error('AUTH_UNAVAILABLE',{cause:{stage:'response',name:error.name}});}
    return data;
  }
  async verify(role,input) {
    if(!roles.has(role))throw Error('INVALID_INPUT');
    const account=this.accounts[role];
    const password=await prepareCredential(role,input,this.pepper);
    const data=await this.call('signInWithPassword',{email:account.email,password,returnSecureToken:true});
    if(data.localId!==account.uid || typeof data.idToken!=='string' || !data.idToken)throw Error('INVALID_CREDENTIAL');
    // Only a server-internal proof. A recovery proof must NEVER issue a normal
    // management session; it is solely for the password-reset flow.
    return {role,uid:account.uid,idToken:data.idToken};
  }
  async changeWithProof(proof,newInput) {
    if(!proof || !roles.has(proof.role) || proof.uid!==this.accounts[proof.role].uid || typeof proof.idToken!=='string' || !proof.idToken)throw Error('INVALID_CREDENTIAL');
    const password=await prepareCredential(proof.role,newInput,this.pepper);
    const data=await this.call('update',{idToken:proof.idToken,password,returnSecureToken:true});
    if(data.localId!==proof.uid)throw Error('INVALID_CREDENTIAL');
    return {changed:true};
  }
}

// All state operations passed here must be server-side atomic transactions.
// The ports are deliberately not wired to a production store in this proof.
export class ManagementAuthority {
  constructor(provider,store){this.provider=provider;this.store=store;}
  async login(input) {
    const permit=await this.store.reserveAttempt();
    let proof;
    try{proof=await this.provider.verify('admin',input);}
    catch(e){await this.store.finishAttempt(permit,false);throw e;}
    await this.store.finishAttempt(permit,true);
    return this.store.issueSession(permit.epoch,proof.uid);
  }
  async changePassword(currentInput,newInput) {
    const permit=await this.store.reserveAttempt();
    let proof;
    try{proof=await this.provider.verify('admin',currentInput);}
    catch(e){await this.store.finishAttempt(permit,false);throw e;}
    await this.store.finishAttempt(permit,true);
    const change=await this.store.beginCredentialChange(permit.epoch);
    // If provider update fails, leave the change barrier in place. Do not
    // restore old sessions or silently make the old credential active again.
    await this.provider.changeWithProof(proof,newInput);
    await this.store.completeCredentialChange(change);
    return {changed:true,reauthenticationRequired:true};
  }
}
