import { Store } from './storage.js';

export const Standings = (()=>{
  function compute(seasonId){
    const s=Store.get();
    const rec={}; // name -> {w,l,t,rf,ra,games}
    const ensure=n=>rec[n]||(rec[n]={name:n,w:0,l:0,t:0,rf:0,ra:0,games:0});
    let games=s.history;
    if(seasonId) games=games.filter(g=>g.seasonId===seasonId);
    games.forEach(g=>{
      const a=ensure(g.away.name), h=ensure(g.home.name);
      const ar=g.totals.away.r, hr=g.totals.home.r;
      a.rf+=ar;a.ra+=hr;h.rf+=hr;h.ra+=ar;a.games++;h.games++;
      if(ar>hr){a.w++;h.l++;} else if(hr>ar){h.w++;a.l++;} else {a.t++;h.t++;}
    });
    // attach crest color from saved teams when available
    Object.values(rec).forEach(r=>{
      const t=s.teams.find(t=>t.name===r.name);
      r.color=t?t.color:'#ff6b35';
      r.pct=r.games?((r.w+r.t*0.5)/r.games):0;
      r.diff=r.rf-r.ra;
    });
    return Object.values(rec).sort((a,b)=>b.pct-a.pct||b.diff-a.diff);
  }
  function teamRecord(name,seasonId){
    const r=compute(seasonId).find(x=>x.name===name);
    return r||{w:0,l:0,t:0,rf:0,ra:0,games:0,pct:0,diff:0};
  }
  function recentResults(limit=5){
    return Store.get().history.slice(0,limit);
  }
  return { compute, teamRecord, recentResults };
})();

/* ============================================================
   STATS ENGINE — derives player stats from game events.
   Pure + event-sourced: never stored separately, always
   recomputed from the scorebook. Same philosophy as undo.

   Plate-appearance accounting (slow-pitch / rec friendly):
     AB excludes walks and sacrifice flies.
     Hits: 1B/2B/3B/HR by `bases`. K and outs are AB outs.
     OBP = (H + BB) / (AB + BB + SF)
     SLG = total bases / AB ;  OPS = OBP + SLG
   ============================================================ */
