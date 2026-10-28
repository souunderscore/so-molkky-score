import { hashPassword, verifyPassword } from './password.mjs';
const synthetic = 'synthetic-password-for-local-benchmark';
const verifier = await hashPassword(synthetic);
const samples=[];
for(let i=0;i<5;i++) {
  const start=performance.now(),cpu=process.cpuUsage();
  if(!await verifyPassword(synthetic,verifier))throw Error('verification failed');
  const used=process.cpuUsage(cpu);
  samples.push({wallMs:Math.round((performance.now()-start)*100)/100,processCpuMs:Math.round((used.user+used.system)/10)/100});
}
console.log(JSON.stringify({runtime:process.version,algorithm:verifier.algorithm,iterations:verifier.iterations,samples,
  limitation:'Local Node process CPU/wall measurements are NOT Cloudflare CPU measurements and do NOT establish Free-plan compatibility.'},null,2));
