/* ============================================================
   DATA LAYER — abstract Store.
   Today: localStorage. Later: swap _read/_write/_sync for
   Supabase calls. The rest of the app never touches storage.
   ============================================================ */
export const Store = (()=> {
  const KEY = 'diamondtracker.v1';
  let state = null;
  const listeners = new Set();

  function _read(){
    try{ return JSON.parse(localStorage.getItem(KEY)) || null }catch(e){ return null }
  }
  function _write(s){
    try{ localStorage.setItem(KEY, JSON.stringify(s)) }catch(e){ console.warn('persist failed',e) }
    // FUTURE: enqueue for Supabase sync here. Offline-safe by design.
  }
  function load(){ state = migrate(_read() || defaultState()); return state }
  function get(){ return state }
  function commit(){ _write(state); listeners.forEach(f=>f(state)) }
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
      _v:5
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
    return s;
  }
  return { load, get, commit, sub };
})();

/* ============================================================
   GAME ENGINE — pure-ish reducer over events.
   Every scoring action is an event appended to game.events,
   so the digital scorebook + undo are both free.
   ============================================================ */
