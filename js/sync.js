/* ============================================================
   LIVE SYNC — Phase B (Supabase) remote backend.

   This module produces an object that satisfies the Store remote
   contract (pull / push / subscribe). It is layered ON TOP of the
   localStorage cache by Store.setRemote(), so the app is identical
   offline and only ever touches the network when the user opts in.

   Model (v1, no accounts): the whole Store state is shared under a
   single row keyed by a user-chosen ROOM code. One scorekeeper
   commits → push; every device in the room receives realtime updates
   and mirrors the state. Last-write-wins (fine for one active scorer).

   Secrets: the Supabase URL + anon key live ONLY in localStorage
   (entered in the Live Sync sheet) — never in the repo. The Supabase
   client is loaded lazily from a CDN the first time sync connects, so
   the default offline app pulls in zero dependencies.
   ============================================================ */

export const Sync = (()=> {
  const TABLE = 'diamondtracker_state';
  const CFG_KEY = 'dt.sync';
  const CDN = 'https://esm.sh/@supabase/supabase-js@2';

  /* ---- config (URL / anon key / room / enabled) ---- */
  function readConfig(){
    try{ return JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); }catch(e){ return null; }
  }
  function writeConfig(cfg){
    try{ localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }catch(e){ console.warn('sync config save failed',e); }
  }
  function clearConfig(){ try{ localStorage.removeItem(CFG_KEY); }catch(e){} }
  function isConfigured(cfg=readConfig()){ return !!(cfg && cfg.enabled && cfg.url && cfg.anonKey && cfg.room); }

  /* ---- the Store-compatible remote, built over a Supabase client ----
     `client` is injected (real client in the app, a mock in tests) so the
     mapping logic is unit-testable with no network. */
  function makeRemote(client, room){
    let channel = null;
    return {
      async pull(){
        const { data, error } = await client.from(TABLE).select('state').eq('id', room).maybeSingle();
        if(error) throw error;
        return data ? data.state : null;
      },
      async push(state){
        const { error } = await client.from(TABLE)
          .upsert({ id: room, state, updated_at: new Date().toISOString() });
        if(error) throw error;
      },
      subscribe(onState){
        channel = client.channel('dt:' + room)
          .on('postgres_changes',
              { event: '*', schema: 'public', table: TABLE, filter: 'id=eq.' + room },
              payload => { const row = payload && payload.new; if(row && row.state) onState(row.state); })
          .subscribe();
        return ()=>{ if(channel){ client.removeChannel(channel); channel=null; } };
      },
    };
  }

  /* ---- lazy client + connect (network) ---- */
  async function createClient(cfg = readConfig()){
    if(!isConfigured(cfg)) throw new Error('Live Sync is not configured');
    const mod = await import(/* @vite-ignore */ CDN);
    return mod.createClient(cfg.url, cfg.anonKey);
  }
  // Resolve a ready-to-use remote from a config object. Throws on bad config
  // or load failure (callers stay offline on throw).
  async function connect(cfg = readConfig()){
    const client = await createClient(cfg);
    return makeRemote(client, cfg.room);
  }

  return { TABLE, CFG_KEY, CDN, readConfig, writeConfig, clearConfig, isConfigured, makeRemote, createClient, connect };
})();
