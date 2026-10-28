import {FirebaseControlStore} from './firebase-store.mjs';
import {Management,CredentialAccounts} from './management-core.mjs';
import {adminHtml} from './admin-ui.mjs';
const safeErrors=new Set(['NOT_CONFIGURED','DB_PERMISSION_DENIED','MANAGEMENT_LOGIN_REQUIRED','SETUP_NOT_ALLOWED','ALREADY_INITIALIZED','SETUP_IN_PROGRESS','NOT_INITIALIZED','RATE_LIMITED','INVALID_CREDENTIAL','AUTH_UNAVAILABLE','ACCOUNT_CREATE_FAILED','PASSCODE_FORMAT','QUESTION_FORMAT','ANSWER_FORMAT','STALE_AUTH','CONFLICT_RETRY','COMMIT_UNKNOWN','LINK_NAME_FORMAT','LINK_NOT_FOUND','LINK_DISCARDED','LINK_DISABLED','LINK_LIMIT','INPUT_NOT_READY']);
async function jsonBody(request){const reader=request.body?.getReader();if(!reader)throw Error('INVALID_BODY');let size=0,chunks=[];for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();throw Error('INVALID_BODY');}chunks.push(value);}const all=new Uint8Array(size);let at=0;for(const chunk of chunks){all.set(chunk,at);at+=chunk.length;}return JSON.parse(new TextDecoder().decode(all));}
export default{
  async fetch(request,env){
    const url=new URL(request.url),origin=request.headers.get('Origin'),allowed=new Set([url.origin,'https://souunderscore.github.io']);
    const headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
    if(origin&&allowed.has(origin)){headers['Access-Control-Allow-Origin']=origin;headers.Vary='Origin';}
    const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
    if(origin&&!allowed.has(origin))return reply({error:'ORIGIN_NOT_ALLOWED'},403);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'}});
    if(url.pathname==='/'&&request.method==='GET'){const nonce=crypto.randomUUID();return new Response(adminHtml(nonce),{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'nonce-"+nonce+"'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"}});}
    if(!url.pathname.startsWith('/api/'))return reply({error:'NOT_FOUND'},404);
    try{
      const store=new FirebaseControlStore(env),credentials=new CredentialAccounts(env),management=new Management(store,credentials,{bootstrapHash:env.BOOTSTRAP_TOKEN_HASH,bootstrapExpires:Number(env.BOOTSTRAP_EXPIRES_AT),inputUrl:'https://souunderscore.github.io/so-molkky-score/index.html',inputReady:env.INPUT_ENABLED==='true'});
      const token=(request.headers.get('Authorization')||'').replace(/^Bearer /,'');
      const path=url.pathname.slice(5),body=request.method==='POST'?await jsonBody(request):{};
      if(request.method==='GET'&&path==='status')return reply(await management.status());
      if(request.method==='POST'&&path==='setup')return reply(await management.setup(body.setupToken,body));
      if(request.method==='POST'&&path==='login')return reply(await management.login(body.passcode));
      if(request.method==='POST'&&path==='recover')return reply(await management.recover(body.answer,body.passcode));
      if(request.method==='POST'&&path==='logout')return reply(await management.logout(token));
      if(request.method==='GET'&&path==='admin/links')return reply(await management.list(token));
      if(request.method==='POST'&&path==='admin/links/create')return reply(await management.editLink(token,null,'create',body));
      if(request.method==='POST'&&path==='admin/hide')return reply(await management.hide(token));
      if(request.method==='POST'&&path==='admin/password')return reply(await management.rotate('admin',body.current,body.next,null,token));
      if(request.method==='POST'&&path==='admin/question')return reply(await management.rotate('recovery',body.current,body.next,body.question,token));
      const match=path.match(/^admin\/links\/([0-9a-f-]{36})\/(url|enable|disable|discard|select|rename)$/);
      if(match){if(request.method==='GET'&&match[2]==='url')return reply(await management.linkUrl(token,match[1]));if(request.method==='POST'&&match[2]!=='url')return reply(await management.editLink(token,match[1],match[2],body));}
      return reply({error:'NOT_FOUND'},404);
    }catch(error){const code=safeErrors.has(error.message)?error.message:'SERVICE_UNAVAILABLE';return reply({error:code},code==='MANAGEMENT_LOGIN_REQUIRED'||code==='INVALID_CREDENTIAL'?401:code==='RATE_LIMITED'?429:code==='SERVICE_UNAVAILABLE'||code==='DB_PERMISSION_DENIED'||code==='NOT_CONFIGURED'||code==='COMMIT_UNKNOWN'?503:400);}
  }
};
