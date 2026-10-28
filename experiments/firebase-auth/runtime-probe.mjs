import {prepareCredential} from './firebase-auth.mjs';
// Synthetic test only. This does NOT perform a real Firebase login.
export default {
  async fetch(request) {
    const reply=(data,status=200)=>new Response(JSON.stringify(data,null,2),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    if(new URL(request.url).pathname!=='/probe')return reply({message:'Synthetic credential preparation probe; no Firebase connection.'});
    const started=Date.now();
    try{
      const value=await prepareCredential('admin','123456','synthetic-pepper-for-cloud-runtime-only');
      return reply({ok:value==='9d55d9c3ba5e8b95a2e26c62896e05a188fd0e0672e2e416dda2ba3302922a4baA1!',kind:'credential-preparation-only',firebaseLoginTested:false,elapsedWallMs:Date.now()-started});
    }catch(error){return reply({ok:false,error:error.name},503);}
  }
};
