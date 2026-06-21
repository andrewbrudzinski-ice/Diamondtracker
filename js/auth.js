/* ============================================================
   ACCOUNTS & ROLES — Phase C (Supabase Auth).

   Layered on the same Supabase project as Live Sync (Phase B): Auth
   shares the client created by Sync. Sign-in is passwordless (email
   magic link). Each user has a row in `diamondtracker_profiles` with
   one of five roles; capability checks below mirror the Row-Level
   Security policies in `supabase/auth.sql` — RLS is the real
   enforcement, these helpers are for UX.

   Offline-first: with no Supabase project configured, Auth is simply
   "signed out" and every capability check is moot (the local app lets
   anyone do anything, exactly as before).
   ============================================================ */

export const Auth = (()=> {
  const PROFILES = 'diamondtracker_profiles';
  const ROLES = ['admin', 'manager', 'scorekeeper', 'player', 'fan'];

  /* ---- capability model (mirrors RLS) ---- */
  const WRITERS = ['admin', 'manager', 'scorekeeper'];
  const TEAM_MANAGERS = ['admin', 'manager'];
  function canWrite(role){ return WRITERS.includes(role); }       // score / edit a shared room
  function canManageTeams(role){ return TEAM_MANAGERS.includes(role); }
  function isAdmin(role){ return role === 'admin'; }
  function roleLabel(role){ return role ? role[0].toUpperCase() + role.slice(1) : ''; }

  /* ---- live auth state ---- */
  let _client = null, _user = null, _role = null;
  const listeners = new Set();
  function onChange(fn){ listeners.add(fn); return ()=>listeners.delete(fn); }
  function state(){ return { signedIn: !!_user, user: _user, role: _role,
                             email: _user ? _user.email : null }; }
  const current = state;
  function _notify(){ const s = state(); listeners.forEach(f => f(s)); }

  // Attach the shared Supabase client (from Sync.createClient). Reads the
  // current session + role, then tracks auth changes. Safe to call again on
  // reconnect. Detaches cleanly with detach().
  async function init(client){
    _client = client;
    if(!client || !client.auth){ _user = null; _role = null; _notify(); return; }
    try{
      const { data } = await client.auth.getSession();
      await _apply(data && data.session ? data.session.user : null);
    }catch(e){ console.warn('auth getSession failed', e); await _apply(null); }
    if(typeof client.auth.onAuthStateChange === 'function'){
      client.auth.onAuthStateChange((_evt, session) => { _apply(session ? session.user : null); });
    }
  }
  function detach(){ _client = null; _user = null; _role = null; _notify(); }

  async function _apply(user){
    _user = user;
    _role = user ? await _fetchRole(user) : null;
    _notify();
  }
  // A signed-in user with no profile row yet defaults to 'fan' (the trigger in
  // auth.sql creates the row; this is the safe fallback if it hasn't landed).
  async function _fetchRole(user){
    try{
      const { data, error } = await _client.from(PROFILES).select('role').eq('id', user.id).maybeSingle();
      if(error) throw error;
      return data && data.role ? data.role : 'fan';
    }catch(e){ console.warn('role lookup failed; defaulting to fan', e); return 'fan'; }
  }

  /* ---- actions ---- */
  async function signInWithEmail(email, redirectTo){
    if(!_client) throw new Error('Connect Live Sync first (Auth shares its Supabase project)');
    const opts = redirectTo ? { emailRedirectTo: redirectTo } : undefined;
    const { error } = await _client.auth.signInWithOtp({ email, options: opts });
    if(error) throw error;
  }
  async function signOut(){
    if(_client && _client.auth){ try{ await _client.auth.signOut(); }catch(e){ console.warn(e); } }
    await _apply(null);
  }

  return { PROFILES, ROLES, canWrite, canManageTeams, isAdmin, roleLabel,
           onChange, current, state, init, detach, signInWithEmail, signOut };
})();
