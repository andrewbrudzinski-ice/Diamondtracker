/* ============================================================
   ACCOUNT ↔ PLAYER LINKING + SELF-SERVICE RSVPs — Phase C.

   Under the Phase C RLS, only writer roles can touch the shared state
   blob — so a "player" can't write their RSVP there. These two small
   tables are player-writable (each user owns their own rows):

     diamondtracker_claims  — links an auth user to the roster player
                              they are (so RSVPs/stats can be "mine").
     diamondtracker_rsvps   — one row per (event, user): their status.

   Both ride the same Supabase client as Sync/Auth. Offline / signed
   out, this module is inert and the app's existing roster RSVPs (in the
   synced state, managed by writers) are unaffected.
   ============================================================ */

export const RSVP = (()=> {
  const CLAIMS = 'diamondtracker_claims';
  const RSVPS  = 'diamondtracker_rsvps';

  let _client = null;
  let _uid = () => null;                     // injected: current auth user id

  function init(client, getUid){ _client = client; if(getUid) _uid = getUid; }
  function detach(){ _client = null; _uid = () => null; }
  function uid(){ return _uid(); }
  function ready(){ return !!(_client && uid()); }

  /* ---- claim: link my account to a roster player ---- */
  async function claimPlayer(playerId, teamId){
    if(!ready()) throw new Error('Sign in first');
    const { error } = await _client.from(CLAIMS)
      .upsert({ user_id: uid(), player_id: playerId, team_id: teamId || null });
    if(error) throw error;
  }
  async function unclaim(){
    if(!ready()) throw new Error('Sign in first');
    const { error } = await _client.from(CLAIMS).delete().eq('user_id', uid());
    if(error) throw error;
  }
  async function myClaim(){
    if(!ready()) return null;
    const { data, error } = await _client.from(CLAIMS).select('player_id,team_id').eq('user_id', uid()).maybeSingle();
    if(error) throw error;
    return data || null;
  }
  async function listClaims(){
    if(!_client) return [];
    const { data, error } = await _client.from(CLAIMS).select('user_id,player_id,team_id');
    if(error) throw error;
    return data || [];
  }

  /* ---- self-service RSVP ---- */
  // status: 'in' | 'out' | 'maybe' | null (null clears my RSVP)
  async function setMyRsvp(eventId, status, playerId){
    if(!ready()) throw new Error('Sign in first');
    if(status == null){
      const { error } = await _client.from(RSVPS).delete().eq('event_id', eventId).eq('user_id', uid());
      if(error) throw error; return;
    }
    const { error } = await _client.from(RSVPS)
      .upsert({ event_id: eventId, user_id: uid(), player_id: playerId || null, status });
    if(error) throw error;
  }
  async function listRsvps(eventId){
    if(!_client) return [];
    const { data, error } = await _client.from(RSVPS).select('user_id,player_id,status').eq('event_id', eventId);
    if(error) throw error;
    return data || [];
  }

  return { CLAIMS, RSVPS, init, detach, uid, ready,
           claimPlayer, unclaim, myClaim, listClaims, setMyRsvp, listRsvps };
})();
