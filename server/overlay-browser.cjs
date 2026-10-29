const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({executablePath:'/tmp/chromium',args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']});
 try{const page=await browser.newPage({viewport:{width:420,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://overlay.test/**',r=>r.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(__dirname,'..','overlay.html'),'utf8')}));
 await page.route('https://www.gstatic.com/firebasejs/**',r=>r.fulfill({contentType:'text/javascript',body:r.request().url().includes('firebase-app-')?`window.listeners={};window.send=(p,v)=>{for(const fn of (listeners[p]||[]))fn({val:()=>v});};window.firebase={initializeApp(){},database(){return{ref(p){return{on(e,fn){(listeners[p]||=[]).push(fn)},off(){listeners[p]=[]}}}}}};`:''}));
 await page.goto('https://overlay.test/overlay.html');
 const view=n=>JSON.stringify({phase:'playing',gameName:'test',teams:[{id:0,name:'A',score:n,missStreak:0,throwCount:1,histLen:1,setWins:0,setTotalScore:0},{id:1,name:'B',score:0,missStreak:0,throwCount:0,histLen:0,setWins:0,setTotalScore:0}],currentTeamIdx:0,currentSet:1,regN:2,regMode:'match',maxMiss:3,targetScore:50,recentThrows:[],setResults:[]});
 await page.evaluate(()=>{send('stream_v1/control/hidden',false);send('stream_v1/control/selectedLink','a');});await page.evaluate(v=>send('stream_v1/rooms/a/current/viewJson',v),view(8));assert.match(await page.locator('#overlay').innerText(),/8/);
 await page.evaluate(()=>send('stream_v1/control/hidden',true));assert.equal(await page.locator('#overlay').innerHTML(),'');await page.evaluate(()=>send('stream_v1/control/hidden',false));assert.match(await page.locator('#overlay').innerText(),/8/);
 await page.evaluate(()=>send('stream_v1/control/selectedLink','b'));await page.evaluate(v=>send('stream_v1/rooms/a/current/viewJson',v),view(99));assert.doesNotMatch(await page.locator('#overlay').innerText(),/99/);await page.evaluate(v=>send('stream_v1/rooms/b/current/viewJson',v),view(12));assert.match(await page.locator('#overlay').innerText(),/12/);
 await page.evaluate(()=>{const bc=new BroadcastChannel('molkky_live');bc.postMessage({type:'state',data:{phase:'setup'}});bc.close();localStorage.setItem('molkky_live_state',JSON.stringify({data:{phase:'setup'}}));});assert.match(await page.locator('#overlay').innerText(),/12/);assert.deepEqual(errors,[]);console.log('overlay passed: selection switch, hide/show, stale listener ignored, legacy channel ignored');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
