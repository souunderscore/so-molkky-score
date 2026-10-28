import {FirebasePasswordProvider} from './firebase-auth.mjs';
// Temporary, authorized synthetic fixture only. No management or score API.
export default {
  async fetch(request,env){
    const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    if(new URL(request.url).pathname!=='/probe/live-auth'||request.method!=='POST')return reply({error:'NOT_FOUND'},404);
    if(!env.LIVE_AUTH_FIXTURE)return reply({error:'NOT_CONFIGURED'},503);
    const f=JSON.parse(env.LIVE_AUTH_FIXTURE),enc=new TextEncoder();
    const actual=enc.encode(request.headers.get('Authorization')||''),expected=enc.encode('Bearer '+f.authorization);
    if(actual.length!==expected.length||!crypto.subtle.timingSafeEqual(actual,expected))return reply({error:'UNAUTHORIZED'},401);
    const p=new FirebasePasswordProvider({apiKey:f.apiKey,pepper:f.pepper,accounts:f.accounts});
    const checks=[];
    try{
      const admin=await p.verify('admin',f.inputs.admin);checks.push({name:'admin-correct',passed:admin.uid===f.accounts.admin.uid});
      try{await p.verify('admin',f.inputs.admin+'-wrong');checks.push({name:'admin-wrong-rejected',passed:false});}
      catch(error){checks.push({name:'admin-wrong-rejected',passed:error.message==='INVALID_CREDENTIAL'});}
      const recovery=await p.verify('recovery',f.inputs.recovery);checks.push({name:'recovery-correct',passed:recovery.uid===f.accounts.recovery.uid});
      try{await p.verify('recovery',f.inputs.recovery+'-wrong');checks.push({name:'recovery-wrong-rejected',passed:false});}
      catch(error){checks.push({name:'recovery-wrong-rejected',passed:error.message==='INVALID_CREDENTIAL'});}
      await p.changeWithProof(admin,f.newAdminInput);
      const changed=await p.verify('admin',f.newAdminInput);checks.push({name:'changed-admin-accepted',passed:changed.uid===f.accounts.admin.uid});
      try{await p.verify('admin',f.inputs.admin);checks.push({name:'old-admin-rejected',passed:false});}
      catch(error){checks.push({name:'old-admin-rejected',passed:error.message==='INVALID_CREDENTIAL'});}
      return reply({ok:checks.every(x=>x.passed),checks});
    }catch(error){return reply({ok:false,checks,error:error.message,diagnostic:error.cause},503);}
  }
};
