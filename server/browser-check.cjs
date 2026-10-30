const{chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{
  const{Management,digest}=await import('./management-core.mjs');const worker=(await import('./worker.mjs')).default;
  const browser=await chromium.launch({executablePath:'/tmp/chromium',args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'],headless:true});
  try{for(const width of [320,390,768]){
    const state={value:null,async read(){return structuredClone(this.value)},async mutate(fn){const r=fn(structuredClone(this.value));this.value=r.state;return r.reply;}};
    state.purgeLink=async id=>{delete state.value.links[id];};
    const users=new Map(),credentials={async create(role,input){const uid=crypto.randomUUID();users.set(uid,{role,input});return{account:{uid,email:uid+'@test.invalid'},proof:{idToken:uid}};},provider(accounts){return{async verify(role,input){const uid=accounts[role].uid,u=users.get(uid);if(!u||u.input!==input||u.role!==role)throw Error('INVALID_CREDENTIAL');return{uid,role,idToken:uid};}}},async remove(p){users.delete(p.idToken);return true;}};
    const management=new Management(state,credentials,{bootstrapHash:await digest('synthetic-setup'),bootstrapExpires:Date.now()+60000,inputUrl:'https://score.test/index.html',inputReady:true});
    const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://management.test/**',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.pathname==='/'){const response=await worker.fetch(new Request(request.url()),{});return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});}
      const body=request.postData()?JSON.parse(request.postData()):{},token=(request.headers().authorization||'').replace(/^Bearer /,'');let result;
      try{
        const path=url.pathname.slice(5),match=path.match(/^admin\/links\/([^/]+)\/(.+)$/);
        if(path==='status')result=await management.status();else if(path==='setup')result=await management.setup(body.setupToken,body);
        else if(path==='login')result=await management.login(body.passcode);else if(path==='admin/links')result=await management.list(token);
        else if(path==='admin/hide')result=await management.hide(token);
        else if(path==='logout')result=await management.logout(token);
        else if(path==='admin/links/create')result=await management.editLink(token,null,'create',body);
        else if(path==='admin/question')result=await management.rotate('recovery',body.current,body.next,body.question,token);
        else if(path==='recover')result=await management.recover(body.answer,body.passcode);
        else if(match)result=match[2]==='url'?await management.linkUrl(token,match[1]):await management.editLink(token,match[1],match[2],body);
        else throw Error('NOT_FOUND');
        await route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
      }catch(error){await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:error.message})});}
    });
    await page.goto('https://management.test/#setup=synthetic-setup');
    await page.getByLabel('管理パスコード（数字6〜12桁）').fill('123456');await page.getByLabel('秘密の質問',{exact:true}).fill('test question');await page.getByLabel('秘密の回答',{exact:true}).fill('test answer');
    await page.getByRole('button',{name:'初期設定を保存',exact:true}).click();await page.getByLabel('パスコード',{exact:true}).fill('123456');await page.getByRole('button',{name:'ログイン',exact:true}).click();
    const home=page.locator('.link-card').filter({has:page.getByRole('heading',{name:'ホーム',exact:true})});await home.waitFor();assert.equal(await home.getByRole('button',{name:'無効にする',exact:true}).count(),0);assert.equal(await home.getByRole('button',{name:'廃棄',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'保存済み記録を確認',exact:true}).count(),0);
    await home.getByRole('button',{name:'リンクを表示',exact:true}).click();assert.equal(await page.getByLabel('入力用URL').inputValue(),'https://score.test/index.html');await home.getByRole('button',{name:'リンクを隠す',exact:true}).click();assert.equal(await page.getByLabel('入力用URL').count(),0);
    const regular=page.locator('.link-card').filter({has:page.getByRole('heading',{name:'<script>test</script>',exact:true})});
    await page.getByLabel('新しいリンクの管理名').fill('<script>test</script>');await page.getByRole('button',{name:'リンクを発行',exact:true}).click();await page.getByRole('heading',{name:'<script>test</script>',exact:true}).waitFor();
    await regular.getByText('その他の操作',{exact:true}).click();await regular.getByRole('button',{name:'有効にする',exact:true}).click();await regular.getByRole('button',{name:'配信対象にする',exact:true}).click();await page.getByText('現在の配信対象',{exact:true}).waitFor();
    await page.getByRole('button',{name:'配信表示を非表示',exact:true}).click();await page.getByText('配信対象（非表示）',{exact:true}).waitFor();await regular.getByRole('button',{name:'配信対象にする',exact:true}).click();await page.getByText('現在の配信対象',{exact:true}).waitFor();
    await regular.getByText('その他の操作',{exact:true}).click();await regular.getByRole('button',{name:'無効にする',exact:true}).click();await page.getByText('最後に保存されたスコアを表示します。',{exact:true}).waitFor();assert.equal(await regular.getByRole('button',{name:'配信対象にする',exact:true}).count(),0);
    await regular.getByText('その他の操作',{exact:true}).click();await regular.getByRole('button',{name:'有効にする',exact:true}).click();await page.getByText('現在の配信対象',{exact:true}).waitFor();
    await page.screenshot({path:'/tmp/molkky-admin-'+width+'.png',fullPage:true});
    await regular.getByRole('button',{name:'リンクを表示',exact:true}).click();assert.match(await page.getByLabel('入力用URL').inputValue(),/#key=[a-f0-9]{64}$/);await regular.getByRole('button',{name:'リンクを隠す',exact:true}).click();assert.equal(await page.getByLabel('入力用URL').count(),0);
    await page.getByRole('button',{name:'認証設定',exact:true}).click();await page.getByLabel('現在の秘密の回答',{exact:true}).fill('test answer');await page.getByLabel('新しい質問',{exact:true}).fill('changed question');await page.getByLabel('新しい回答',{exact:true}).fill('changed answer');await page.getByRole('button',{name:'質問・回答を変更',exact:true}).click();
    await page.getByRole('button',{name:'パスコードを忘れた',exact:true}).click();await page.getByText('changed question',{exact:true}).waitFor();await page.getByLabel('秘密の回答',{exact:true}).fill('changed answer');await page.getByLabel('新しいパスコード（数字6〜12桁）').fill('987654');await page.getByRole('button',{name:'再設定',exact:true}).click();
    await page.getByLabel('パスコード',{exact:true}).fill('987654');await page.getByRole('button',{name:'ログイン',exact:true}).click();await page.getByRole('heading',{name:'入力用リンク',exact:true}).waitFor();
    page.on('dialog',d=>d.accept());await regular.getByText('その他の操作',{exact:true}).click();await regular.getByRole('button',{name:'廃棄',exact:true}).click();await regular.waitFor({state:'detached'});assert.equal(await page.getByRole('heading',{name:'ホーム',exact:true}).count(),1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.deepEqual(errors,[]);console.log('management UI passed at '+width+'px');await context.close();
  }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
