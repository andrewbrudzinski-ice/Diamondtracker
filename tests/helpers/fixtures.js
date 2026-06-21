/* ============================================================
   TEST FIXTURES
   Small builders for teams, games and play-by-play events so the
   derivation modules (Stats / Standings / Awards / etc.) can be fed
   realistic, event-sourced data without standing up the whole UI.
   ============================================================ */

// Build a team record with players. players: [{id,name,num,pos}]
export function team({ id = 't1', name = 'Test Team', color = '#ff6b35', players = [] } = {}){
  return { id, name, color, players, created: 1 };
}

// Build a single play-by-play event. Mirrors the shape Engine.pushEvent
// produces; only the fields the derivation modules read are required.
export function ev(type, props = {}){
  return Object.assign({ type, i: 1, half: 'top', label: type }, props);
}

// Convenience batting-event builders --------------------------------
export const hit   = (bases, props = {}) => ev('hit',  { bases, rbi: 0, ...props });
export const single = (props = {}) => hit(1, props);
export const double = (props = {}) => hit(2, props);
export const triple = (props = {}) => hit(3, props);
export const homer  = (props = {}) => hit(4, { rbi: 1, ...props });
export const walk   = (props = {}) => ev('walk', props);
export const strikeout = (props = {}) => ev('k', props);
export const out    = (props = {}) => ev('out', props);
export const sacFly = (props = {}) => ev('sac', { rbi: 1, ...props });
export const error  = (props = {}) => ev('error', props);
export const stolenBase = (props = {}) => ev('sb', props);

// Build a finished game record. events: array from the builders above.
export function game({
  id = 'g1', seasonId = null, created = 1,
  away = 'Away', home = 'Home',
  awayRuns = 0, homeRuns = 0, awayHits = 0, homeHits = 0,
  awayErr = 0, homeErr = 0,
  events = [], mvpId = null,
} = {}){
  return {
    id, seasonId, created,
    away: { name: away, roster: [], teamId: null, pitcherId: null },
    home: { name: home, roster: [], teamId: null, pitcherId: null },
    innings: 7,
    totals: {
      away: { r: awayRuns, h: awayHits, e: awayErr },
      home: { r: homeRuns, h: homeHits, e: homeErr },
    },
    line: { away: [], home: [] },
    events,
    final: true,
    mvpId,
  };
}
