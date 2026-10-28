// Explicit opt-in real-project fixture helper. All credentials are synthetic.
// stdin/stdout are machine-only: the caller MUST NOT log the fixture output.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import {prepareCredential} from './firebase-auth.mjs';
let raw='';for await(const chunk of process.stdin)raw+=chunk;
const options=JSON.parse(raw);
if(!options.apiKey || !options.projectId)throw Error('MISSING_CONFIG');
async function call(method,body){
  const child=spawn('curl',['--max-time','20','-sS','-w','\n%{http_code}',
    'https://identitytoolkit.googleapis.com/v1/accounts:'+method+'?key='+encodeURIComponent(options.apiKey),
    '-H','Content-Type: application/json','--data-binary','@-'],{stdio:['pipe','pipe','pipe']});
  let output='',error='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>error+=d);
  child.stdin.end(JSON.stringify(body));const exit=await new Promise(resolve=>child.on('close',resolve));
  if(exit!==0)throw Error('NETWORK_FAILURE');
  const split=output.lastIndexOf('\n');const status=Number(output.slice(split+1));
  let data;try{data=JSON.parse(output.slice(0,split));}catch{throw Error('INVALID_RESPONSE');}
  return {status,data};
}
async function remove(account,fixture){
  const candidates=account.role==='admin'?[fixture.newAdminInput,fixture.inputs.admin]:[fixture.inputs.recovery];
  for(const input of candidates){
    const password=await prepareCredential(account.role,input,fixture.pepper);
    const login=await call('signInWithPassword',{email:account.email,password,returnSecureToken:true});
    if(login.status!==200)continue;
    if(login.data.localId!==account.uid)throw Error('UID_MISMATCH');
    const result=await call('delete',{idToken:login.data.idToken});
    return {role:account.role,deleted:result.status===200,status:result.status};
  }
  // Initial token may still be usable if credential verification is blocked.
  const result=await call('delete',{idToken:account.initialToken});
  return {role:account.role,deleted:result.status===200,status:result.status};
}
if(options.operation==='create'){
  const random=()=>crypto.randomUUID()+crypto.randomUUID();
  const fixture={pepper:random(),inputs:{admin:random(),recovery:random()},newAdminInput:random(),authorization:random(),accounts:{}};
  const checkpoint=()=>fs.writeFileSync('.live-fixture.json',JSON.stringify(fixture),{mode:0o600});
  checkpoint();
  try{
    for(const role of ['admin','recovery']){
      const email='molkky-probe-'+role+'-'+crypto.randomUUID()+'@example.invalid';
      const password=await prepareCredential(role,fixture.inputs[role],fixture.pepper);
      const result=await call('signUp',{email,password,returnSecureToken:true});
      if(result.status!==200)throw Error('SIGNUP_FAILED_'+(result.data.error?.message||result.status));
      fixture.accounts[role]={role,email,uid:result.data.localId,initialToken:result.data.idToken};
      checkpoint();
      const claims=JSON.parse(Buffer.from(result.data.idToken.split('.')[1],'base64url').toString());
      if(claims.aud!==options.projectId || claims.iss!=='https://securetoken.google.com/'+options.projectId)throw Error('PROJECT_MISMATCH');
    }
    console.log(JSON.stringify({success:true,fixture}));
  }catch(error){
    const cleanup=[];for(const account of Object.values(fixture.accounts)){try{cleanup.push(await remove(account,fixture));}catch{cleanup.push({role:account.role,deleted:false});}}
    console.log(JSON.stringify({success:false,error:error.message,cleanup,fixture:Object.values(fixture.accounts).length?fixture:null}));
  }
}else if(options.operation==='cleanup'){
  const results=[];for(const account of Object.values(options.fixture.accounts)){
    try{results.push(await remove(account,options.fixture));}catch(error){results.push({role:account.role,deleted:false,error:error.message});}
  }
  console.log(JSON.stringify({success:results.every(x=>x.deleted),results}));
}else{throw Error('INVALID_OPERATION');}
