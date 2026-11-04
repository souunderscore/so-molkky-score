/* Shared link editing with a persistent outbox and version/generation checks. */
(function(root){
  const API='https://so-molkky-score-api.sou-underscore.workers.dev/api/';
  const HOME_LINK_ID='00000000-0000-4000-8000-000000000001';
  // The fixed home and issued links share the same synchronization protocol.
  const PUBLIC_HOME_KEY='e94f3e189a1fc422c7aa3cfada5eb7c1bc881b442e39afa647be81de7b10d2ef';
  const errors={LINK_DISABLED:'この入力リンクは無効です。',LINK_DISCARDED:'この入力リンクは廃棄されています。',INPUT_LINK_INVALID:'入力リンクを確認してください。',CLIENT_UPDATE_REQUIRED:'画面を再読み込みしてください。未送信の記録は端末に残っています。',SCORE_CONFLICT:'別の端末で記録が更新されています。最新の記録を読み込んでから入力し直してください。',SCORE_TOO_LARGE:'記録の容量が上限に達しました。端末に記録は残っています。',CONTROL_TOO_LARGE:'記録の容量が上限に達しました。端末に記録は残っています。',MATCH_LIMIT:'このリンクの試合数が上限に達しました。',DB_PERMISSION_DENIED:'接続設定の完了待ちです。',INPUT_NOT_READY:'入力リンクの準備中です。'};
  const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
  class Client{
    constructor(){
      const u=new URL(location.href);this.id=u.searchParams.get('input')?.toLowerCase()||HOME_LINK_ID;this.isHome=this.id===HOME_LINK_ID;this.active=true;this.apiBase=API;
      this.storageKey='molkky_stream_'+this.id;this.cacheKey=this.storageKey+'_state';this.message='接続を確認しています…';this.ready=false;this.locked=true;this.offline=false;this.busy=false;this.info=null;this.lastError=null;
      try{
        this.cache=JSON.parse(localStorage.getItem(this.storageKey)||'null')||{};
        this.key=this.isHome?PUBLIC_HOME_KEY:new URLSearchParams(u.hash.slice(1)).get('key')||this.cache.key;
        this.device=this.cache.device||random();this.cache.key=this.key;this.cache.device=this.device;
        // Preserve old unsent records, including the generation they were made against.
        if(this.cache.inflight&&this.cache.inflight.generation===undefined)this.cache.inflight.generation=this.cache.generation;
        this.persist();
        if(u.hash){history.replaceState(null,'',u.pathname+u.search);}
      }catch{this.cache={};this.storageFailed=true;this.message='端末に記録を保存できません。Safariの保存設定を確認してください。';}
    }
    persist(){localStorage.setItem(this.storageKey,JSON.stringify(this.cache));}
    canEdit(){return this.active&&this.ready&&!this.locked&&!this.storageFailed;}
    changed(){this.onStatus?.();}
    async api(operation,body={}){
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
      try{const r=await fetch(this.apiBase+'input/'+this.id+'/'+operation,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:this.key,device:this.device,...body}),signal:controller.signal});const d=await r.json();if(!r.ok)throw Error(d.error||'SERVICE_UNAVAILABLE');return d;}finally{clearTimeout(timer);}
    }
    statusText(){return this.message+(this.cache?.pending||this.cache?.inflight?'（未送信の記録あり）':'');}
    applyRemote(info){this.info=info;this.cache.version=info.current?.version??null;this.cache.matchId=info.current?.id||null;this.cache.generation=info.generation;this.cache.validated=true;delete this.cache.ownerEpoch;delete this.cache.wasOwner;this.cache.lastJson=info.current?.json||null;this.persist();if(info.current){localStorage.setItem(this.cacheKey,info.current.json);this.onState?.(JSON.parse(info.current.json));}}
    hasPending(){return !!(this.cache.pending||this.cache.inflight);}
    async start(){
      if(this.storageFailed)return;
      await this.refresh(true);
      this.interval=setInterval(()=>{if(!document.hidden)this.refresh();},15000);
      addEventListener('online',()=>this.refresh());
      addEventListener('visibilitychange',()=>{if(!document.hidden)this.refresh();});
    }
    fail(e){
      this.lastError=e.message;
      if(errors[e.message]||['INVALID_SCORE','MATCH_NOT_FOUND'].includes(e.message)){
        this.locked=true;this.message=errors[e.message]||'記録を確認してください。';
      }else{this.offline=true;this.message='接続待ちです。現在の試合は端末に保存されます。';}
      this.changed();
    }
    async refresh(first=false){
      if(this.refreshing||this.busy||this.storageFailed)return;this.refreshing=true;
      const startedVersion=this.cache.version,startedJson=this.cache.lastJson;
      try{
        let info=await this.api('inspect');
        // A poll started before a local save may arrive after its confirmation.
        // Do not restore that older snapshot or roll back the confirmed version.
        if(this.busy||this.cache.version!==startedVersion||this.cache.lastJson!==startedJson)return;
        this.offline=false;this.lastError=null;
        if(this.cache.inflight&&info.current?.opId===this.cache.inflight.opId){this.cache.version=info.current.version;this.cache.matchId=info.current.id;this.cache.inflight=null;this.persist();}
        if(this.hasPending()&&((this.cache.generation!==info.generation)||(this.cache.version??null)!==(info.current?.version??null))){
          this.info=info;this.locked=true;this.ready=true;this.lastError='SCORE_CONFLICT';this.message='別の端末で記録が更新されています。未送信の記録は端末に残しました。最新の記録を読み込んでから入力し直してください。';this.changed();return;
        }
        this.info=info;this.ready=true;this.locked=false;
        if(!this.hasPending())this.applyRemote(info);
        this.message='同期済み';
        this.changed();
      }catch(e){if(first&&(this.cache.validated||this.cache.wasOwner)&&this.cache.generation!==undefined&&!errors[e.message]){this.ready=true;this.locked=false;}this.fail(e);}
      finally{this.refreshing=false;}
      if(this.canEdit())await this.flush();
    }
    publish(state,view){
      if(!this.canEdit())return;
      const json=JSON.stringify(state),v={...view};delete v.updatedAt;const viewJson=JSON.stringify(v);
      if(json===this.cache.lastJson)return;
      try{this.cache.pending={json,viewJson};this.cache.lastJson=json;this.persist();this.changed();}catch{this.storageFailed=true;this.locked=true;this.message='端末の保存容量が不足しています。記録を出力して保管してください。';this.changed();return;}
      void this.flush();
    }
    async flush(){
      if(this.flushing)return this.flushing;
      this.flushing=this.drain();
      try{return await this.flushing;}finally{this.flushing=null;}
    }
    async drain(){
      if(this.busy||!this.canEdit()||!this.hasPending())return;this.busy=true;
      try{
        while(this.canEdit()&&this.hasPending()){
          if(!this.cache.inflight){this.cache.inflight={...this.cache.pending,opId:crypto.randomUUID(),matchId:this.cache.matchId||crypto.randomUUID(),version:this.cache.version??null,generation:this.cache.generation,operation:this.cache.matchId?'save':'new'};this.cache.pending=null;this.persist();}
          const flight=this.cache.inflight;const info=await this.api(flight.operation,flight);
          this.cache.version=info.current.version;this.cache.matchId=info.current.id;this.cache.inflight=null;this.info=info;this.persist();this.offline=false;this.lastError=null;this.message='同期済み';this.changed();
        }
      }catch(e){this.fail(e);}finally{this.busy=false;}
    }
    async newMatch(state,view,continueDraft=false){
      if(!this.canEdit())throw Error('SCORE_CONFLICT');
      await this.flush();if(this.hasPending()||this.offline||this.busy)throw Error('UNSENT_RECORDS');
      const v={...view};delete v.updatedAt;
      const reuse=continueDraft&&this.cache.matchId;
      this.cache.inflight={json:JSON.stringify(state),viewJson:JSON.stringify(v),opId:crypto.randomUUID(),matchId:reuse||crypto.randomUUID(),version:this.cache.version??null,generation:this.cache.generation,operation:reuse?'save':'new'};this.persist();
      await this.flush();if(this.hasPending())throw Error('UNSENT_RECORDS');
    }
    async discardLocal(){
      if(this.busy)return;
      const info=await this.api('inspect');this.cache.pending=null;this.cache.inflight=null;this.cache.lastJson=null;this.applyRemote(info);this.locked=false;this.ready=true;this.lastError=null;this.message='サーバーに保存された記録を表示しています。';this.changed();
    }
    download(){const blob=new Blob([JSON.stringify({linkId:this.id,exportedAt:new Date().toISOString(),localState:this.getState?.()||localStorage.getItem(this.cacheKey),pending:this.cache.pending,inflight:this.cache.inflight},null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='molkky-unsent-records.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
  }
  root.MolkkyStreamClient=Client;
})(window);
