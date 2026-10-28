import {FirebaseControlStore} from './firebase-store.mjs';
import {Management,CredentialAccounts} from './management-core.mjs';
import {adminHtml} from './admin-ui.mjs';
import {Scoring} from './scoring-core.mjs';
import * as preview from './preview-assets.mjs';
const safeErrors=new Set(['NOT_CONFIGURED','DB_PERMISSION_DENIED','MANAGEMENT_LOGIN_REQUIRED','SETUP_NOT_ALLOWED','ALREADY_INITIALIZED','SETUP_IN_PROGRESS','NOT_INITIALIZED','RATE_LIMITED','INVALID_CREDENTIAL','AUTH_UNAVAILABLE','ACCOUNT_CREATE_FAILED','PASSCODE_FORMAT','QUESTION_FORMAT','ANSWER_FORMAT','STALE_AUTH','CONFLICT_RETRY','COMMIT_UNKNOWN','LINK_NAME_FORMAT','LINK_NOT_FOUND','LINK_DISCARDED','LINK_DISABLED','LINK_LIMIT','INPUT_NOT_READY']);
for(const code of ['INPUT_LINK_INVALID','INPUT_OWNER_LOST','INPUT_BUSY','ALREADY_INPUT_OWNER','NO_INPUT_OWNER','HANDOFF_PENDING','HANDOFF_EXPIRED','SCORE_CONFLICT','INVALID_SCORE','SCORE_TOO_LARGE','MATCH_LIMIT','MATCH_NOT_FOUND','CONTROL_TOO_LARGE'])safeErrors.add(code);
async function jsonBody(request,limit=8192){const reader=request.body?.getReader();if(!reader)throw Error('INVALID_BODY');let size=0,chunks=[];for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw Error('INVALID_BODY');}chunks.push(value);}const all=new Uint8Array(size);let at=0;for(const chunk of chunks){all.set(chunk,at);at+=chunk.length;}return JSON.parse(new TextDecoder().decode(all));}
export default{
  async fetch(request,env){
    const url=new URL(request.url),origin=request.headers.get('Origin'),allowed=new Set([url.origin,'https://souunderscore.github.io']);
    const headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
    if(origin&&allowed.has(origin)){headers['Access-Control-Allow-Origin']=origin;headers.Vary='Origin';}
    const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
    if(origin&&!allowed.has(origin))return reply({error:'ORIGIN_NOT_ALLOWED'},403);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'}});
    if(request.method==='GET'&&url.pathname.startsWith('/preview/')){
      const key=({'/preview/':'score','/preview/index.html':'score','/preview/overlay.html':'overlay','/preview/stream-client.js':'client'})[url.pathname];
      if(key)return new Response(preview[key],{headers:{...headers,'Content-Type':key==='client'?'text/javascript; charset=utf-8':'text/html; charset=utf-8'}});
    }
    if(request.method==='GET'&&url.pathname==='/database-setup')return new Response(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>接続ルール</title><style>body{font:16px system-ui;max-width:640px;margin:24px auto;padding:16px}textarea{box-sizing:border-box;width:100%;height:55vh;font:13px monospace}button{font:inherit;padding:14px;margin:12px 0}p{line-height:1.7}</style><h1>試合データの接続ルール</h1><p>「全文をコピー」を押し、Firebaseの Realtime Database → ルール の内容をすべて置き換え、「公開」を押してください。現在のスコア画面は引き続き利用できます。</p><button id="copy" disabled>全文をコピー</button><p id="message" role="status"></p><textarea id="rules" readonly aria-label="接続ルール全文"></textarea><script>let text='';fetch('/database-rules.json').then(r=>r.text()).then(t=>{text=t;document.getElementById('rules').value=t;document.getElementById('copy').disabled=false;});document.getElementById('copy').onclick=()=>{navigator.clipboard.writeText(text).then(()=>document.getElementById('message').textContent='コピーしました。Firebaseへ貼り付けて公開してください。').catch(()=>{document.getElementById('rules').select();document.getElementById('message').textContent='本文を選択しました。長押ししてコピーしてください。';});};</script></html>`,{headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
    if(request.method==='GET'&&url.pathname==='/database-rules.json')return new Response(preview.rules,{headers});
    if(url.pathname==='/'&&request.method==='GET'){const nonce=crypto.randomUUID();return new Response(adminHtml(nonce),{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'nonce-"+nonce+"'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"}});}
    if(!url.pathname.startsWith('/api/'))return reply({error:'NOT_FOUND'},404);
    try{
      const store=new FirebaseControlStore(env),credentials=new CredentialAccounts(env),management=new Management(store,credentials,{bootstrapHash:env.BOOTSTRAP_TOKEN_HASH,bootstrapExpires:Number(env.BOOTSTRAP_EXPIRES_AT),inputUrl:env.INPUT_URL||'https://souunderscore.github.io/so-molkky-score/index.html',inputReady:env.INPUT_ENABLED==='true'});
      const token=(request.headers.get('Authorization')||'').replace(/^Bearer /,'');
      const path=url.pathname.slice(5),body=request.method==='POST'?await jsonBody(request,url.pathname.startsWith('/api/input/')?480000:8192):{};
      const scoring=new Scoring(store,management);
      const inputMatch=path.match(/^input\/([0-9a-f-]{36})\/(inspect|claim|request|approve|cancel|save|new|archive)$/);
      if(request.method==='POST'&&inputMatch){
        if(env.INPUT_ENABLED!=='true')throw Error('INPUT_NOT_READY');
        const [,id,operation]=inputMatch;
        if(operation==='inspect')return reply(await scoring.inspect(id,body.key,body.device));
        if(operation==='archive')return reply(await scoring.archive(id,body.key,body.device,body.archiveKey));
        return reply(await scoring.edit(id,body.key,body.device,operation,body));
      }
      const ownerMatch=path.match(/^admin\/links\/([0-9a-f-]{36})\/(pending|force|records|archive)$/);
      if(ownerMatch){
        if(request.method==='GET'&&ownerMatch[2]==='pending')return reply(await scoring.pending(token,ownerMatch[1]));
        if(request.method==='GET'&&ownerMatch[2]==='records')return reply(await scoring.records(token,ownerMatch[1]));
        if(request.method==='POST'&&ownerMatch[2]==='archive')return reply(await scoring.adminArchive(token,ownerMatch[1],body.archiveKey));
        if(request.method==='POST'&&ownerMatch[2]==='force')return reply(await scoring.force(token,ownerMatch[1],body.requestId));
      }
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
