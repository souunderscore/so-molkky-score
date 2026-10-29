const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
  const {Scoring}=await import('./scoring-core.mjs'),{digest,randomToken}=await import('./management-core.mjs');
  const values=new Map(),db={path:'control',at(p){return{...this,path:p}},async read(){return structuredClone(values.get(this.path)||null)},async mutate(fn){const r=fn(await this.read());values.set(this.path,structuredClone(r.state));return r.reply;}};
  const id=crypto.randomUUID(),key=randomToken();values.set('control',{links:{[id]:{name:'test',enabled:true,discarded:false,generation:1,capabilityHash:await digest(key)}}});
  const core=new Scoring(db,{async authorized(t){assert.equal(t,'manager')}}),browser=await chromium.launch({executablePath:'/tmp/chromium',args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']});
  const offline=new Set(),dropReply=new Set(),holdInspect=new Set(),releaseInspect=new Map(),contexts=[],errors=[];
  async function page(width,managed=true){
    const context=await browser.newContext({viewport:{width,height:844}});contexts.push(context);const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    await page.route('https://score.test/**',route=>{const file=new URL(route.request().url()).pathname.endsWith('.js')?'stream-client.js':'index.html';return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':'text/html',body:fs.readFileSync(path.join(__dirname,'..',file),'utf8')});});
    await page.route('https://so-molkky-score-api.sou-underscore.workers.dev/api/input/**',async route=>{
      if(offline.has(page))return route.abort('internetdisconnected');const req=route.request(),b=JSON.parse(req.postData()),op=new URL(req.url()).pathname.split('/').at(-1);try{const data=op==='inspect'?await core.inspect(id,b.key,b.device):await core.edit(id,b.key,b.device,op,b);if(op==='inspect'&&holdInspect.has(page)){holdInspect.delete(page);await new Promise(resolve=>releaseInspect.set(page,resolve));}if(op==='save'&&dropReply.has(page)){dropReply.delete(page);return route.abort('failed');}return route.fulfill({headers:{'Access-Control-Allow-Origin':'https://score.test'},contentType:'application/json',body:JSON.stringify(data)});}catch(e){return route.fulfill({status:400,headers:{'Access-Control-Allow-Origin':'https://score.test'},contentType:'application/json',body:JSON.stringify({error:e.message})});}
    });
    await page.goto('https://score.test/index.html'+(managed?'?input='+id+'#key='+key:''));return page;
  }
  const state=()=>values.get('rooms/'+id),score=()=>JSON.parse(state().current.json);
  const settled=p=>p.waitForFunction(()=>stream.ready&&!stream.busy&&!stream.hasPending());
  try{
    const home=await page(390,false);assert.equal(await home.evaluate(()=>typeof window._fbSet),'undefined');assert.equal(values.has('rooms/'+id),false);
    const a=await page(390);await a.getByRole('button',{name:'この端末で入力する',exact:true}).click();await a.locator('#team-name-0').fill('Draft A');await settled(a);assert.equal(score().teams[0].name,'Draft A');const draftId=state().current.id;await a.getByRole('button',{name:'試合開始 🎯',exact:true}).click();await settled(a);assert.equal(score().phase,'playing');assert.equal(state().current.id,draftId);assert.equal(Object.keys(state().index||{}).length,0);
    await a.getByRole('button',{name:'8',exact:true}).click();await settled(a);assert.equal(score().teams[0].score,8);
    const b=await page(768);await b.waitForFunction(()=>stream.ready);assert.equal(await b.getByRole('button',{name:'8',exact:true}).isDisabled(),true);
    await b.getByRole('button',{name:'入力交代を申請',exact:true}).click();await a.evaluate(()=>stream.refresh());await a.getByRole('button',{name:'交代を承認する',exact:true}).click();await b.evaluate(()=>stream.refresh());await b.waitForFunction(()=>stream.canEdit());await b.getByRole('button',{name:'4',exact:true}).click();await settled(b);assert.equal(score().teams[1].score,4);
    await a.evaluate(()=>stream.refresh());assert.equal(await a.getByRole('button',{name:'8',exact:true}).isDisabled(),true);
    // Return ownership, then lose the network, reload, and force a handoff.
    await a.getByRole('button',{name:'入力交代を申請',exact:true}).click();await b.evaluate(()=>stream.refresh());await b.getByRole('button',{name:'交代を承認する',exact:true}).click();await a.evaluate(()=>stream.refresh());
    offline.add(a);await a.getByRole('button',{name:'2',exact:true}).click();await a.waitForFunction(()=>stream.hasPending()&&!stream.busy);await a.reload();await a.waitForFunction(()=>stream.canEdit());assert.equal(await a.evaluate(()=>S.teams[0].score),10);assert.equal(score().teams[0].score,8);
    const deviceB=await b.evaluate(()=>stream.device);const req=await core.edit(id,key,deviceB,'request');await core.force('manager',id,req.transfer.id);await b.evaluate(()=>stream.refresh());
    offline.delete(a);await a.evaluate(()=>stream.refresh());assert.equal(await a.evaluate(()=>stream.canEdit()),false);assert.equal(await a.evaluate(()=>stream.hasPending()),true);assert.equal(score().teams[0].score,8);
    await b.getByRole('button',{name:'3',exact:true}).click();await settled(b);assert.equal(score().teams[0].score,11);
    offline.add(b);await b.getByRole('button',{name:'1',exact:true}).click();await b.waitForFunction(()=>stream.hasPending()&&!stream.busy);const oldId=state().current.id;await b.evaluate(()=>resetGame());assert.equal(state().current.id,oldId);
    offline.delete(b);await b.evaluate(()=>stream.refresh());await settled(b);await b.evaluate(()=>resetGame());await settled(b);assert.notEqual(state().current.id,oldId);assert.ok(Object.keys(state().index).length>=1);
    const version=state().current.version;dropReply.add(b);await b.evaluate(()=>{S.settings.gameName='retry test';saveState();render();});await b.waitForFunction(()=>stream.hasPending()&&!stream.busy);assert.equal(state().current.version,version+1);await b.evaluate(()=>stream.refresh());await settled(b);assert.equal(state().current.version,version+1);
    holdInspect.add(b);await b.evaluate(()=>{window.staleRefresh=stream.refresh();});for(let i=0;i<100&&!releaseInspect.has(b);i++)await new Promise(resolve=>setTimeout(resolve,20));assert.ok(releaseInspect.has(b));await b.evaluate(()=>{S.settings.gameName='latest draft';saveState();render();});await settled(b);const latestVersion=state().current.version;releaseInspect.get(b)();await b.evaluate(()=>window.staleRefresh);assert.equal(await b.evaluate(()=>S.settings.gameName),'latest draft');assert.equal(await b.evaluate(()=>stream.cache.version),latestVersion);
    for(const p of [home,a,b])assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    assert.deepEqual(errors,[]);console.log('score UI passed: local home, explicit claim, viewer, normal/forced handoff, offline reload, stale outbox retention, new match archive, 390/768px');
  }finally{for(const c of contexts)await c.close();await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
