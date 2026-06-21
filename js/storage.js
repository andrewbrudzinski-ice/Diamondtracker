/* ============================================================
   DATA LAYER — abstract Store.
   Today: localStorage. Later: swap _read/_write/_sync for
   Supabase calls. The rest of the app never touches storage.
   ============================================================ */
export const Store = (()=> {
  const KEY = 'diamondtracker.v1';
  let state = null;
  const listeners = new Set();

  /* ---- durable local cache (always on — guarantees offline-first) ---- */
  function _read(){
    try{ return JSON.parse(localStorage.getItem(KEY)) || null }catch(e){ return null }
  }
  function _write(s){
    try{ localStorage.setItem(KEY, JSON.stringify(s)) }catch(e){ console.warn('persist failed',e) }
  }

  /* ---- optional remote backend (the Phase B seam) ----
     localStorage is always the durable cache; a remote is layered ON TOP,
     never in front, so the app works identically with no network. A remote
     implements:
        async pull()        -> persisted state | null   (initial/refresh read)
        push(state)         -> persist remotely (sync or Promise; fire-and-forget)
        subscribe(onState)  -> optional; call onState(state) on remote changes,
                               return an unsubscribe fn
     Until setRemote() is called, Store is a pure local/offline store and all
     of get/commit/sub behave exactly as before. */
  let remote = null;
  let remoteUnsub = null;
  function setRemote(backend){
    if(remoteUnsub){ remoteUnsub(); remoteUnsub=null; }
    remote = backend || null;
    if(remote && typeof remote.subscribe==='function'){
      remoteUnsub = remote.subscribe(applyRemote);
    }
    return remote;
  }
  function getRemote(){ return remote; }
  // adopt state pushed from the remote: migrate, cache, notify the UI
  function applyRemote(incoming){
    if(!incoming) return;
    state = migrate(incoming);
    _write(state);
    listeners.forEach(f=>f(state));
  }

  // synchronous, cache-first load → instant offline boot (unchanged contract)
  function load(){ state = migrate(_read() || defaultState()); return state }
  // async reconciliation with the remote; offline-first (cache already loaded).
  // No-op (resolves to current state) when no remote is configured.
  async function hydrate(){
    if(!remote || typeof remote.pull!=='function') return state;
    try{
      const incoming = await remote.pull();
      if(incoming){ state = migrate(incoming); _write(state); listeners.forEach(f=>f(state)); }
    }catch(e){ console.warn('remote hydrate failed (staying offline)',e); }
    return state;
  }
  function get(){ return state }
  function commit(){
    _write(state);                          // durable local write-through (offline-safe)
    listeners.forEach(f=>f(state));          // synchronous UI update
    if(remote && typeof remote.push==='function'){
      // write-through to the remote; never blocks or breaks the offline path
      try{ Promise.resolve(remote.push(state)).catch(e=>console.warn('remote push failed (offline?)',e)); }
      catch(e){ console.warn('remote push failed',e); }
    }
  }
  function sub(f){ listeners.add(f); return ()=>listeners.delete(f) }
  function defaultState(){
    const seasonId='s'+Date.now();
    return {
      game:null,
      history:[],          // past games (digital scorebook archive)
      teams:[],            // persistent team records w/ rosters
      lineups:[],          // saved lineups (batting order + defense)
      seasons:[{id:seasonId, name:'Season 1', created:Date.now()}],
      currentSeasonId:seasonId,
      schedule:[],         // scheduled games / practices / tournaments + RSVPs
      tournaments:[],      // brackets: single/double elim, round robin
      _v:6
    };
  }
  // forward-compatible migrations so old saves never crash
  function migrate(s){
    if(!s._v){ s.teams=s.teams||[]; s.lineups=s.lineups||[]; s._v=2; }
    if(s._v<3){
      // introduce seasons; fold all existing games into a default "Season 1"
      if(!s.seasons || !s.seasons.length){
        const sid='s'+(s.history[0]?.created || Date.now());
        s.seasons=[{id:sid, name:'Season 1', created:Date.now()}];
        s.currentSeasonId=sid;
        (s.history||[]).forEach(g=>{ if(!g.seasonId) g.seasonId=sid; });
        if(s.game && !s.game.seasonId) s.game.seasonId=sid;
      }
      s._v=3;
    }
    if(s._v<4){
      if(!s.schedule) s.schedule=[];
      s._v=4;
    }
    if(s._v<5){
      if(!s.tournaments) s.tournaments=[];
      s._v=5;
    }
    if(s._v<6){
      // runner identity now travels on the bases as {name,id} so runs can
      // be attributed to the scorer. Normalize any in-progress live game's
      // bases (older saves stored bare name strings). Finished games in
      // history keep their string-based event snapshots — readers tolerate
      // both shapes, and legacy box scores simply show R=0 (un-attributed).
      if(s.game && Array.isArray(s.game.bases)){
        s.game.bases = s.game.bases.map(b =>
          b==null ? null : (typeof b==='string' ? {name:b, id:null} : b));
      }
      s._v=6;
    }
    return s;
  }
  return { load, get, commit, sub, hydrate, setRemote, getRemote };
})();

/* ============================================================
   GAME ENGINE — pure-ish reducer over events.
   Every scoring action is an event appended to game.events,
   so the digital scorebook + undo are both free.
   ============================================================ */
