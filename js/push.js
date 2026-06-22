/* ============================================================
   PUSH NOTIFICATIONS — opt-in (Phase C).

   The one feature that needs a server: a Supabase Edge Function
   (supabase/functions/notify) sends Web Push to stored subscriptions.
   This client module handles permission + subscription + storing the
   subscription row, and a notify() that asks the function to fan out a
   message. The service worker (sw.js) shows the notification.

   Everything is opt-in and guarded: with no config / unsupported
   browser, the module is inert and the app is unchanged. The pure
   helpers (key decode, row/payload shaping) are unit-tested; the
   browser + function paths need a real device + deployed function.
   ============================================================ */

export const Push = (()=> {
  const CFG_KEY = 'dt.push';
  const TABLE = 'diamondtracker_push';

  /* ---- config: VAPID public key + the notify function URL/key ---- */
  function readConfig(){ try{ return JSON.parse(localStorage.getItem(CFG_KEY)||'null'); }catch(e){ return null; } }
  function writeConfig(cfg){ try{ localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }catch(e){} }
  function clearConfig(){ try{ localStorage.removeItem(CFG_KEY); }catch(e){} }
  function isConfigured(cfg=readConfig()){ return !!(cfg && cfg.enabled && cfg.vapidPublicKey && cfg.functionUrl); }

  function supported(){
    return typeof navigator!=='undefined' && 'serviceWorker' in navigator
      && typeof window!=='undefined' && 'PushManager' in window && 'Notification' in window;
  }

  // VAPID application server key: URL-base64 → Uint8Array (pure).
  function urlB64ToUint8Array(b64){
    const pad='='.repeat((4 - b64.length % 4) % 4);
    const norm=(b64+pad).replace(/-/g,'+').replace(/_/g,'/');
    const raw=atob(norm);
    const out=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++) out[i]=raw.charCodeAt(i);
    return out;
  }
  // Shape a DB row from a PushSubscription (or its .toJSON()) (pure).
  function subRow(sub, extra={}){
    const j = sub && typeof sub.toJSON==='function' ? sub.toJSON() : sub || {};
    const keys = j.keys || {};
    return Object.assign({ endpoint:j.endpoint||null, p256dh:keys.p256dh||null, auth:keys.auth||null }, extra);
  }
  // The fan-out request body the edge function expects (pure).
  function notifyBody({title, body, url, room}={}){
    return { title: title||'DiamondTracker', body: body||'', url: url||'/', room: room||null };
  }

  /* ---- shared client (for storing subscriptions) ---- */
  let _client=null, _uid=()=>null;
  function init(client, getUid){ _client=client; if(getUid) _uid=getUid; }
  function detach(){ _client=null; _uid=()=>null; }

  async function store(sub){
    if(!_client) return;
    const { error } = await _client.from(TABLE).upsert(subRow(sub, { user_id:_uid()||null, room:(readConfig()||{}).room||null }));
    if(error) throw error;
  }

  /* ---- browser actions (need a real device to verify) ---- */
  async function enable(){
    if(!supported()) throw new Error('Push not supported on this device');
    const cfg=readConfig(); if(!cfg || !cfg.vapidPublicKey || !cfg.functionUrl) throw new Error('Push is not configured');
    const perm=await Notification.requestPermission();
    if(perm!=='granted') throw new Error('Notifications permission denied');
    const reg=await navigator.serviceWorker.ready;
    const sub=await reg.pushManager.subscribe({ userVisibleOnly:true,
      applicationServerKey:urlB64ToUint8Array(cfg.vapidPublicKey) });
    writeConfig(Object.assign({}, cfg, { enabled:true }));
    await store(sub);
    return sub;
  }
  async function disable(){
    const cfg=readConfig()||{}; writeConfig(Object.assign({}, cfg, { enabled:false }));
    if(!supported()) return;
    try{
      const reg=await navigator.serviceWorker.ready;
      const sub=await reg.pushManager.getSubscription();
      if(sub){ if(_client){ try{ await _client.from(TABLE).delete().eq('endpoint', sub.endpoint); }catch(e){} } await sub.unsubscribe(); }
    }catch(e){ console.warn('push disable',e); }
  }
  async function isSubscribed(){
    if(!supported()) return false;
    try{ const reg=await navigator.serviceWorker.ready; return !!(await reg.pushManager.getSubscription()); }
    catch(e){ return false; }
  }
  // Ask the edge function to fan out a message (best-effort; never throws to the UI).
  async function notify(payload, fetchImpl=(typeof fetch!=='undefined'?fetch:null)){
    const cfg=readConfig();
    if(!isConfigured(cfg) || !fetchImpl) return false;
    try{
      const res=await fetchImpl(cfg.functionUrl, {
        method:'POST',
        headers:Object.assign({'content-type':'application/json'},
          cfg.anonKey?{'authorization':`Bearer ${cfg.anonKey}`,'apikey':cfg.anonKey}:{}),
        body:JSON.stringify(notifyBody(payload)),
      });
      return res.ok;
    }catch(e){ console.warn('push notify failed',e); return false; }
  }

  return { CFG_KEY, TABLE, readConfig, writeConfig, clearConfig, isConfigured, supported,
           urlB64ToUint8Array, subRow, notifyBody, init, detach,
           enable, disable, isSubscribed, notify };
})();
