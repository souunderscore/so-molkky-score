/* Persistent per-link outbox. A lost owner never automatically merges its
   pending state into a match accepted from another device. */
(function(root){
  const API='https://so-molkky-score-api.sou-underscore.workers.dev/api/';
  const errors={LINK_DISABLED:'この入力リンクは無効です。',LINK_DISCARDED:'この入力リンクは廃棄されています。',INPUT_LINK_INVALID:'入力リンクを確認してください。',INPUT_OWNER_LOST:'入力担当が別の端末に交代しました。',INPUT_BUSY:'ほかの端末が入力中です。',SCORE_CONFLICT:'別の更新と重なりました。未送信の記録を確認してください。',SCORE_TOO_LARGE:'記録の容量が上限に達しました。端末に記録は残っています。',CONTROL_TOO_LARGE:'記録の容量が上限に達しました。端末に記録は残っています。',MATCH_LIMIT:'このリンクの試合数が上限に達しました。',DB_PERMISSION_DENIED:'接続設定の完了待ちです。',INPUT_NOT_READY:'入力リンクの準備中です。',HANDOFF_EXPIRED:'交代の申請が期限切れです。もう一度申請してください。'};
  const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
  class Client{
    constructor(){
      const u=new URL(location.href);this.id=u.searchParams.get('input');this.active=!!this.id;this.apiBase=API;
      if(!this.active)return;
      this.storageKey='molkky_stream_'+this.id;this.cacheKey=this.storageKey+'_state';this.message='接続を確認しています…';this.ready=false;this.locked=true;this.offline=false;this.busy=false;this.info=null;
      try{
        this.cache=JSON.parse(localStorage.getItem(this.storageKey)||'null')||{};
        this.key=new URLSearchParams(u.hash.slice(1)).get('key')||this.cache.key;
        this.device=this.cache.device||random();this.cache.key=this.key;this.cache.device=this.device;
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
    applyRemote(info){this.info=info;this.cache.version=info.current?.version??null;this.cache.matchId=info.current?.id||null;this.cache.ownerEpoch=info.ownerEpoch;this.cache.generation=info.generation;this.cache.wasOwner=info.isOwner;this.cache.lastJson=info.current?.json||null;this.persist();if(info.current){localStorage.setItem(this.cacheKey,info.current.json);this.onState?.(JSON.parse(info.current.json));}}
    hasPending(){return !!(this.cache.pending||this.cache.inflight);}
    async start(){
      if(this.storageFailed)return;
      await this.refresh(true);
      this.interval=setInterval(()=>{if(!document.hidden)this.refresh();},15000);
      addEventListener('online',()=>this.refresh());
      addEventListener('visibilitychange',()=>{if(!document.hidden)this.refresh();});
    }
    fail(e){
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
        this.offline=false;
        if(this.cache.inflight&&info.current?.opId===this.cache.inflight.opId){this.cache.version=info.current.version;this.cache.matchId=info.current.id;this.cache.inflight=null;this.persist();}
        if(this.hasPending()&&((this.cache.generation!==info.generation)||!info.isOwner||this.cache.ownerEpoch!==info.ownerEpoch||(this.cache.version??null)!==(info.current?.version??null))){
          this.info=info;this.locked=true;this.ready=true;this.message='入力権限または試合が変わっています。未送信の記録は端末に残しました。';this.changed();return;
        }
        this.info=info;this.ready=true;this.locked=!info.isOwner;
        if(!this.hasPending())this.applyRemote(info);
        this.message=info.isOwner?'入力担当：この端末':info.hasOwner?'閲覧中：ほかの端末が入力担当です。':'入力担当が未設定です。閲覧または入力を選べます。';
        if(info.transfer&&!info.transfer.isRequester)this.message+=' 交代申請が届いています。';
        this.changed();
      }catch(e){if(first&&this.cache.wasOwner&&this.cache.ownerEpoch&&!errors[e.message]){this.ready=true;this.locked=false;}this.fail(e);}
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
          if(!this.cache.inflight){this.cache.inflight={...this.cache.pending,opId:crypto.randomUUID(),matchId:this.cache.matchId||crypto.randomUUID(),version:this.cache.version??null,ownerEpoch:this.cache.ownerEpoch,operation:this.cache.matchId?'save':'new'};this.cache.pending=null;this.persist();}
          const flight=this.cache.inflight;const info=await this.api(flight.operation,flight);
          this.cache.version=info.current.version;this.cache.matchId=info.current.id;this.cache.inflight=null;this.info=info;this.persist();this.offline=false;this.message='同期済み・入力担当：この端末';this.changed();
        }
      }catch(e){this.fail(e);}finally{this.busy=false;}
    }
    async newMatch(state,view,continueDraft=false){
      if(!this.canEdit())throw Error('INPUT_OWNER_LOST');
      await this.flush();if(this.hasPending()||this.offline||this.busy)throw Error('UNSENT_RECORDS');
      const v={...view};delete v.updatedAt;
      const reuse=continueDraft&&this.cache.matchId;
      this.cache.inflight={json:JSON.stringify(state),viewJson:JSON.stringify(v),opId:crypto.randomUUID(),matchId:reuse||crypto.randomUUID(),version:this.cache.version??null,ownerEpoch:this.cache.ownerEpoch,operation:reuse?'save':'new'};this.persist();
      await this.flush();if(this.hasPending())throw Error('UNSENT_RECORDS');
    }
    async action(operation){
      if(operation==='approve'){await this.flush();if(this.hasPending()||this.busy||this.offline)throw Error('UNSENT_RECORDS');}
      const info=await this.api(operation,{ownerEpoch:this.cache.ownerEpoch,requestId:this.info?.transfer?.id,version:this.cache.version??null});
      this.info=info;this.ready=true;this.locked=!info.isOwner;
      if(!this.hasPending())this.applyRemote(info);
      await this.refresh();
    }
    async discardLocal(){
      if(this.busy)return;
      const info=await this.api('inspect');this.cache.pending=null;this.cache.inflight=null;this.cache.lastJson=null;this.applyRemote(info);this.locked=!info.isOwner;this.ready=true;this.message='サーバーに保存された記録を表示しています。';this.changed();
    }
    download(){const blob=new Blob([JSON.stringify({linkId:this.id,exportedAt:new Date().toISOString(),localState:this.getState?.()||localStorage.getItem(this.cacheKey),pending:this.cache.pending,inflight:this.cache.inflight},null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='molkky-unsent-records.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
  }
  root.MolkkyStreamClient=Client;
})(window);
