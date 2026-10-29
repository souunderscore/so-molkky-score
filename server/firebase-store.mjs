// Auth credentials are server-only. This adapter only accesses the new control
// namespace; it never reads or writes the legacy /game score.
const enc=new TextEncoder();
export async function readJson(response,limit=524288){
  if(!response.body)throw Error('INVALID_RESPONSE');
  const reader=response.body.getReader();let size=0,chunks=[];
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw Error('RESPONSE_TOO_LARGE');}chunks.push(value);}
  const all=new Uint8Array(size);let offset=0;for(const part of chunks){all.set(part,offset);offset+=part.length;}
  return JSON.parse(new TextDecoder().decode(all));
}
export class FirebaseControlStore{
  constructor(env,fetchImpl=(...args)=>fetch(...args),path='control',auth=null){
    this.env=env;this.fetch=fetchImpl;this.token=null;
    if(!env.FIREBASE_WEB_API_KEY||!env.FIREBASE_PROJECT_ID||!env.DB_SERVICE_CONFIG||!env.DATABASE_URL)throw Error('NOT_CONFIGURED');
    this.service=JSON.parse(env.DB_SERVICE_CONFIG);
    const url=new URL(env.DATABASE_URL);
    if(url.protocol!=='https:'||!url.hostname.endsWith('.firebasedatabase.app')||url.username||url.password||url.search||url.hash)throw Error('NOT_CONFIGURED');
    this.database=url.origin;this.path=path;this.auth=auth;
  }
  at(path){return new FirebaseControlStore(this.env,this.fetch,path,this);}
  async idToken(){
    if(this.auth)return this.auth.idToken();
    if(this.token)return this.token;
    const r=await this.fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+encodeURIComponent(this.env.FIREBASE_WEB_API_KEY),{
      method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(12000),body:JSON.stringify({email:this.service.email,password:this.service.password,returnSecureToken:true})});
    if(!r.ok){await r.body?.cancel();throw Error('SERVICE_AUTH_FAILED');}
    const d=await readJson(r,32768);
    if(d.localId!==this.service.uid||!d.idToken)throw Error('SERVICE_AUTH_FAILED');
    this.token=d.idToken;return this.token;
  }
  async request(method,body,etag){
    const token=await this.idToken();
    const response=await this.fetch(this.database+'/stream_v1/'+this.path+'.json?auth='+encodeURIComponent(token),{
      method,headers:{'Content-Type':'application/json','X-Firebase-ETag':'true',...(etag?{'if-match':etag}:{})},
      signal:AbortSignal.timeout(12000),...(body===undefined?{}:{body:JSON.stringify(body)})});
    if(response.status===401||response.status===403){await response.body?.cancel();throw Error('DB_PERMISSION_DENIED');}
    return response;
  }
  async read(){
    const r=await this.request('GET');if(!r.ok){await r.body?.cancel();throw Error('DB_UNAVAILABLE');}
    return await readJson(r);
  }
  async mutate(transition){
    for(let attempt=0;attempt<6;attempt++){
      const read=await this.request('GET');if(!read.ok){await read.body?.cancel();throw Error('DB_UNAVAILABLE');}
      const etag=read.headers.get('etag');if(!etag){await read.body?.cancel();throw Error('NO_ETAG');}
      const current=await readJson(read),out=transition(structuredClone(current));
      if(out instanceof Promise)throw Error('ASYNC_TRANSITION');
      const data=out.state;if(enc.encode(JSON.stringify(data)).length>524288)throw Error('CONTROL_TOO_LARGE');
      let write;try{write=await this.request('PUT',data,etag);}catch(error){if(error.message==='DB_PERMISSION_DENIED')throw error;throw Error('COMMIT_UNKNOWN');}
      if(write.status===412){await write.body?.cancel();continue;}
      if(!write.ok){await write.body?.cancel();throw Error('COMMIT_UNKNOWN');}
      await write.body?.cancel();return out.reply;
    }
    throw Error('CONFLICT_RETRY');
  }
}
