// One-time owner-authorized provisioning. Read public config on stdin.
// Machine-only stdout contains private server configuration; do not log it.
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {digest,randomToken} from './management-core.mjs';
let input='';for await(const chunk of process.stdin)input+=chunk;const config=JSON.parse(input);
if(!config.apiKey||!config.projectId||!config.databaseURL)throw Error('MISSING_CONFIG');
fs.mkdirSync('.private',{recursive:true,mode:0o700});
const checkpoint='.private/storage.json';
let storage;
if(fs.existsSync(checkpoint))storage=JSON.parse(fs.readFileSync(checkpoint,'utf8'));
else{
  storage={email:'molkky-storage-'+crypto.randomUUID()+'@example.invalid',password:randomToken()+'aA1!',uid:null,bootstrap:randomToken(),pepper:randomToken(),createdAt:Date.now()};
  fs.writeFileSync(checkpoint,JSON.stringify(storage),{mode:0o600});
}
const call=async(method,body)=>{
  const child=spawn('curl',['--max-time','20','-sS','-w','\n%{http_code}','https://identitytoolkit.googleapis.com/v1/accounts:'+method+'?key='+encodeURIComponent(config.apiKey),'-H','Content-Type: application/json','--data-binary','@-'],{stdio:['pipe','pipe','pipe']});
  let out='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',()=>{});child.stdin.end(JSON.stringify(body));const exit=await new Promise(r=>child.on('close',r));if(exit!==0)throw Error('NETWORK_FAILURE');
  const split=out.lastIndexOf('\n');return{status:Number(out.slice(split+1)),data:JSON.parse(out.slice(0,split))};
};
let result=await call('signInWithPassword',{email:storage.email,password:storage.password,returnSecureToken:true});
if(result.status!==200&&!storage.uid)result=await call('signUp',{email:storage.email,password:storage.password,returnSecureToken:true});
if(result.status!==200)throw Error('STORAGE_PROVISION_FAILED');
const claims=JSON.parse(Buffer.from(result.data.idToken.split('.')[1],'base64url').toString());
if(claims.aud!==config.projectId)throw Error('PROJECT_MISMATCH');
if(storage.uid&&storage.uid!==result.data.localId)throw Error('UID_MISMATCH');
storage.uid=result.data.localId;fs.writeFileSync(checkpoint,JSON.stringify(storage),{mode:0o600});
const rules={rules:{game:{'.read':true,'.write':true},stream_v1:{control:{'.read':"auth != null && auth.uid === '"+storage.uid+"'",'.write':"auth != null && auth.uid === '"+storage.uid+"'"}}}};
console.log(JSON.stringify({success:true,serviceUid:storage.uid,serviceEmail:storage.email,bootstrap:storage.bootstrap,rules,bindings:{FIREBASE_WEB_API_KEY:config.apiKey,FIREBASE_PROJECT_ID:config.projectId,DATABASE_URL:config.databaseURL,DB_SERVICE_CONFIG:JSON.stringify({uid:storage.uid,email:storage.email,password:storage.password}),AUTH_PEPPER:storage.pepper,BOOTSTRAP_TOKEN_HASH:await digest(storage.bootstrap),BOOTSTRAP_EXPIRES_AT:String(Date.now()+24*3600000)}}));
