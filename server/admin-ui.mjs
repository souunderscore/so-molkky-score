export function adminHtml(nonce){return `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SÖスコア 管理者メニュー</title>
<style>
:root{--c-orange:#FF5500;--c-orange-light:#FFF0E8;--c-blue:#2B9DC8;--c-bg:#F4F7FA;--c-surface:#fff;--c-border:#E2E8F0;--c-text:#1A2332;--c-muted:#6B7A8D;--c-red:#dc2626;}
*{box-sizing:border-box}body{font:13px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI','Hiragino Sans',sans-serif;background:var(--c-bg);color:var(--c-text);margin:0}main{max-width:520px;margin:auto;padding:18px 8px max(40px,env(safe-area-inset-bottom))}.app-header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 2px 10px}.app-header h1{font-size:22px;line-height:1.2;margin:0;font-weight:800}.app-header p{margin:4px 0 0;color:var(--c-muted);font-size:12px}.home-link{white-space:nowrap;border:1px solid var(--c-border);border-radius:10px;padding:8px 10px;background:var(--c-surface);color:var(--c-text);text-decoration:none;font-size:12px}h2{font-size:15px;line-height:1.5;margin:0 0 12px;font-weight:700;overflow-wrap:anywhere}p{margin:8px 0}section{background:var(--c-surface);border:1px solid var(--c-border);border-radius:12px;padding:14px;margin:10px 0;box-shadow:0 1px 3px #0000000d}label{display:block;font-size:12px;font-weight:600;margin:12px 0 6px}input{width:100%;min-width:0;padding:11px 12px;font:inherit;font-size:16px;border:1.5px solid var(--c-border);border-radius:10px;background:#F8FAFC;color:var(--c-text)}input:focus{outline:2px solid #FF550033;outline-offset:1px;border-color:var(--c-orange)}button{font:inherit;font-size:13px;font-weight:500;min-height:44px;padding:8px 12px;border:1.5px solid var(--c-border);border-radius:10px;background:var(--c-surface);color:var(--c-text);margin:8px 6px 0 0;cursor:pointer;transition:transform .12s,filter .12s}button.primary{background:var(--c-orange);color:#fff;border-color:var(--c-orange)}button.danger{color:var(--c-red)}button:active,.home-link:active{transform:scale(.96);filter:brightness(.94)}button:disabled{opacity:.4;cursor:default;transform:none}button:focus-visible,summary:focus-visible,a:focus-visible{outline:2px solid var(--c-orange);outline-offset:3px}#status{white-space:pre-wrap;color:#9a3412;background:#fff7ed;border-radius:9px;padding:8px 10px;font-size:12px;overflow-wrap:anywhere}#status:empty{display:none}small,.muted{color:var(--c-muted);font-size:12px}pre{white-space:pre-wrap;word-break:break-all}a{color:var(--c-blue)}.toolbar{display:flex;flex-wrap:wrap;gap:8px}.toolbar button{margin:0}.top-actions{justify-content:flex-end;margin:0 0 12px}.top-actions button{min-height:36px;font-size:12px;padding:6px 10px}.section-title{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}.section-title h2{margin:0}.badge-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.badge{display:inline-flex;align-items:center;min-height:23px;padding:2px 8px;border-radius:999px;background:#edf1f5;color:var(--c-muted);font-size:11px;font-weight:600;white-space:nowrap}.badge.enabled{background:#e9f5ee;color:#28784e}.badge.selected{background:var(--c-orange-light);color:#b83e00}.broadcast-name{font-size:16px;font-weight:700;margin:10px 0;overflow-wrap:anywhere}.create-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center}.create-row button{margin:0;white-space:nowrap}.create-box label{margin-top:0}.list-title{margin:22px 2px 8px}.link-card.is-selected{border-color:#ffb58d}.link-card.is-retired{background:#FAFBFC}.link-card .link-title{margin-bottom:8px}.link-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-top:14px}.link-actions button{margin:0}.link-options{margin-top:12px;border-top:1px solid var(--c-border)}.link-options>summary{display:flex;align-items:center;gap:6px;list-style:none;min-height:44px;width:max-content;color:var(--c-muted);cursor:pointer;font-size:12px}.link-options>summary::-webkit-details-marker{display:none}.link-options>summary:after{content:'⌄'}.link-options[open]>summary:after{transform:rotate(180deg)}.secondary-actions{display:grid;grid-template-columns:1fr;gap:8px}.secondary-actions button{margin:0;text-align:left}.maintenance-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid var(--c-border)}.maintenance-actions button{margin:0}.url-panel,.detail-panel:not(:empty){margin-top:12px;padding:12px;background:#F8FAFC;border:1px solid var(--c-border);border-radius:10px}.url-panel label{margin-top:0}.url-row{display:flex;gap:8px;align-items:center}.url-row input{font:12px/1.5 ui-monospace,monospace;background:var(--c-surface)}.url-row button{margin:0;flex-shrink:0}.detail-panel p:first-child{margin-top:0}.detail-panel button{max-width:100%;overflow-wrap:anywhere}.empty-state{padding:20px 14px;text-align:center;color:var(--c-muted)}@media(max-width:350px){.create-row{grid-template-columns:1fr}.create-row button{width:100%}}@media(prefers-reduced-motion:reduce){button{transition:none}}
</style>
<main><header class="app-header"><div><h1>SÖスコア</h1><p>管理者メニュー</p></div><a class="home-link" href="https://souunderscore.github.io/so-molkky-score/index.html">スコア画面へ</a></header><p id="status" role="status"></p><div id="app"></div></main>
<script nonce="${nonce}">
const app=document.getElementById('app'),status=document.getElementById('status');
const saved={get:k=>{try{return sessionStorage.getItem(k)||'';}catch{return '';}},set:(k,v)=>{try{sessionStorage.setItem(k,v);}catch{}},remove:k=>{try{sessionStorage.removeItem(k);}catch{}}};
const boot=new URLSearchParams(location.hash.slice(1)).get('setup');let setupToken=boot||saved.get('molkky_setup');if(boot){saved.set('molkky_setup',boot);history.replaceState(null,'',location.pathname);}
let token=saved.get('molkky_manager'),busy=false;
const messages={HOME_LINK_FIXED:'ホームの固定リンクは変更・無効化・廃棄できません。',DB_PERMISSION_DENIED:'接続設定の完了待ちです。今は設定を開始できません。',NOT_CONFIGURED:'初期設定の準備中です。',INVALID_CREDENTIAL:'入力内容を確認してください。',RATE_LIMITED:'試行回数が多いため、1分ほど待ってからお試しください。',MANAGEMENT_LOGIN_REQUIRED:'管理者ログインが必要です。',SETUP_NOT_ALLOWED:'初回設定用の案内から開いてください。有効期限が切れた場合は再発行が必要です。',ALREADY_INITIALIZED:'初期設定は完了しています。ログインしてください。',PASSCODE_FORMAT:'パスコードは数字6〜12桁で入力してください。',ANSWER_FORMAT:'秘密の回答を入力してください。',QUESTION_FORMAT:'秘密の質問を120文字以内で入力してください。',LINK_NAME_FORMAT:'管理名を80文字以内で入力してください。',LINK_DISCARDED:'廃棄したリンクは利用できません。',LINK_DISABLED:'先にリンクを有効にしてください。',COMMIT_UNKNOWN:'保存結果を確認できませんでした。再読み込みして状態を確認してください。',AUTH_UNAVAILABLE:'認証に接続できませんでした。時間を置いてお試しください。',ACCOUNT_CREATE_FAILED:'認証設定を保存できませんでした。接続設定を確認してください。',STALE_AUTH:'認証設定が変更されました。ログインし直してください。',CONFLICT_RETRY:'ほかの操作と重なりました。再度お試しください。'};
function node(tag,text,parent=app){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;parent.append(n);return n;}
let fieldId=0;
function field(parent,label,type='text'){const l=node('label',label,parent),i=node('input',undefined,parent);i.id='field-'+(++fieldId);l.htmlFor=i.id;i.type=type;i.autocomplete='off';return i;}
function button(parent,text,fn,cls=''){const b=node('button',text,parent);b.type='button';b.className=cls;b.onclick=async()=>{if(busy)return;busy=true;b.disabled=true;status.textContent='';try{await fn();}catch(e){status.textContent=messages[e.message]||'処理できませんでした。時間を置いてお試しください。';}finally{busy=false;b.disabled=false;}};return b;}
async function api(path,body){const r=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();if(!r.ok)throw Error(data.error||'FAILED');return data;}
function clear(){app.replaceChildren();}
function forget(){token='';saved.remove('molkky_manager');}
async function signedOut(){forget();await start();}
async function start(){clear();try{const s=await api('status');if(!s.initialized){setup();return;}if(token){try{await dashboard();return;}catch(e){forget();}}login(s.question);}catch(e){status.textContent=messages[e.message]||'接続できません。時間を置いてお試しください。';}}
function setup(){clear();const box=node('section'),p=field(box,'管理パスコード（数字6〜12桁）','password');p.inputMode='numeric';const q=field(box,'秘密の質問'),a=field(box,'秘密の回答','password');node('p','回答は前後の空白や全角・半角も区別します。自分だけが覚えられる長めの内容にしてください。',box);button(box,'初期設定を保存',async()=>{await api('setup',{setupToken,passcode:p.value,question:q.value,answer:a.value});setupToken='';saved.remove('molkky_setup');await start();status.textContent='初期設定を保存しました。パスコードでログインしてください。';},'primary');}
function login(question){clear();const box=node('section');node('h2','管理者ログイン',box);const p=field(box,'パスコード','password');p.inputMode='numeric';button(box,'ログイン',async()=>{const s=await api('login',{passcode:p.value});token=s.token;saved.set('molkky_manager',token);await dashboard();},'primary');button(box,'パスコードを忘れた',()=>recovery(question));}
function recovery(question){clear();const box=node('section');node('h2','パスコードの再設定',box);node('p',question,box);const a=field(box,'秘密の回答','password'),p=field(box,'新しいパスコード（数字6〜12桁）','password');p.inputMode='numeric';button(box,'再設定',async()=>{await api('recover',{answer:a.value,passcode:p.value});await signedOut();status.textContent='変更しました。新しいパスコードでログインしてください。';},'primary');button(box,'戻る',start);}
async function dashboard(){
  const data=await api('admin/links');clear();
  const top=node('nav');top.className='toolbar top-actions';top.setAttribute('aria-label','管理者操作');
  button(top,'認証設定',settings);button(top,'ログアウト',async()=>{await api('logout',{});await signedOut();});
  const selected=data.links.find(l=>l.id===data.selectedLink),broadcast=node('section');
  const broadcastHead=node('div',undefined,broadcast);broadcastHead.className='section-title';node('h2','配信表示',broadcastHead);
  badge(broadcastHead,data.hidden?'非表示':selected?'表示中':'未選択',data.hidden||!selected?'':'selected');
  const now=node('p',selected?selected.name:'配信対象が選択されていません',broadcast);now.className='broadcast-name';
  if(!data.hidden&&selected&&(!selected.enabled||selected.discarded)){const note=node('p','最後に保存されたスコアを表示します。',broadcast);note.className='muted';}
  if(!data.hidden&&selected)button(broadcast,'配信表示を非表示',async()=>{await api('admin/hide',{});await dashboard();});
  const create=node('section');create.className='create-box';const name=field(create,'新しいリンクの管理名');name.maxLength=80;
  const createRow=node('div',undefined,create);createRow.className='create-row';createRow.append(name);
  button(createRow,'リンクを発行',async()=>{await api('admin/links/create',{name:name.value});await dashboard();},'primary');
  const heading=node('h2','入力用リンク');heading.className='list-title';
  if(!data.inputReady){const note=node('p','入力用URLの共有は、スコア画面との接続確認後に利用できます。');note.className='muted';}
  if(!data.links.length){const empty=node('section','入力用リンクはまだありません。');empty.className='empty-state';}
  for(const l of data.links){
    const box=node('section');box.className='link-card'+(data.selectedLink===l.id?' is-selected':'')+(l.discarded?' is-retired':'');
    const title=node('h2',l.name,box);title.className='link-title';
    const badges=node('div',undefined,box);badges.className='badge-row';badge(badges,l.discarded?'廃棄済み':l.enabled?'有効':'無効',!l.discarded&&l.enabled?'enabled':'');
    if(l.fixed)badge(badges,'固定リンク');
    if(data.selectedLink===l.id)badge(badges,data.hidden?'配信対象（非表示）':'現在の配信対象','selected');
    if(!l.discarded){
      const main=node('div',undefined,box);main.className='link-actions';
      let share;
      if(data.inputReady){const reveal=button(main,'リンクを表示',async()=>{
        if(share){share.remove();share=null;reveal.textContent='リンクを表示';return;}
        const d=await api('admin/links/'+l.id+'/url');share=node('div',undefined,box);share.className='url-panel';
        const i=field(share,'入力用URL');i.value=d.url;i.readOnly=true;
        const row=node('div',undefined,share);row.className='url-row';row.append(i);
        button(row,'コピー',async()=>{await navigator.clipboard.writeText(d.url);status.textContent='コピーしました。';});i.select();reveal.textContent='リンクを隠す';
      });}
      if(l.enabled){const select=button(main,'配信対象にする',async()=>{await api('admin/links/'+l.id+'/select',{});await dashboard();},'primary');select.disabled=data.selectedLink===l.id&&!data.hidden;}
    }
    const options=node('details',undefined,box);options.className='link-options';node('summary','その他の操作',options);
    const secondary=node('div',undefined,options);secondary.className='secondary-actions';
    const pending=node('div',undefined,options);pending.className='detail-panel';
    button(secondary,'入力担当・交代申請を確認',async()=>{
      const p=await api('admin/links/'+l.id+'/pending');pending.replaceChildren();node('p',p.hasOwner?'入力担当あり':'入力担当なし',pending);
      if(p.requestId&&!l.discarded&&l.enabled)button(pending,'この申請端末へ強制交代',async()=>{if(confirm('引き継げるのはサーバー保存済みの記録までです。旧端末の未送信分は引き継がれません。強制交代しますか？')){await api('admin/links/'+l.id+'/force',{requestId:p.requestId});await dashboard();}},'danger');
      else node('p',p.requestId?'入力交代にはリンクを有効にしてください。':'現在、交代申請はありません。新しい端末から先に申請してください。',pending);
    });
    if(l.discarded||l.fixed)continue;
    const maintenance=node('div',undefined,options);maintenance.className='maintenance-actions';
    button(maintenance,l.enabled?'無効にする':'有効にする',async()=>{await api('admin/links/'+l.id+'/'+(l.enabled?'disable':'enable'),{});await dashboard();});
    button(maintenance,'管理名を変更',async()=>{const value=prompt('新しい管理名',l.name);if(value!==null){await api('admin/links/'+l.id+'/rename',{name:value});await dashboard();}});
    button(maintenance,'廃棄',async()=>{if(confirm('このリンクと、紐づく現在・過去の試合データを完全に削除します。配信対象の場合は表示も解除します。元には戻せません。廃棄しますか？')){await api('admin/links/'+l.id+'/discard',{});await dashboard();}},'danger');
  }
}
function badge(parent,text,kind=''){const b=node('span',text,parent);b.className='badge '+kind;return b;}
function settings(){clear();const box=node('section');node('h2','パスコード変更',box);const old=field(box,'現在のパスコード','password'),next=field(box,'新しいパスコード（数字6〜12桁）','password');old.inputMode=next.inputMode='numeric';button(box,'パスコードを変更',async()=>{await api('admin/password',{current:old.value,next:next.value});await signedOut();status.textContent='全端末の管理ログインを終了しました。新しいパスコードでログインしてください。';},'primary');const qbox=node('section');node('h2','秘密の質問・回答を変更',qbox);const answer=field(qbox,'現在の秘密の回答','password'),q=field(qbox,'新しい質問'),a=field(qbox,'新しい回答','password');button(qbox,'質問・回答を変更',async()=>{await api('admin/question',{current:answer.value,question:q.value,next:a.value});await signedOut();status.textContent='変更しました。パスコードでログインし直してください。';});button(qbox,'戻る',dashboard);}
start();
</script></html>`;}
