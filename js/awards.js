import { Store } from './storage.js';
import { Stats } from './stats.js';

export const Awards = (()=>{

  // ---- Seasonal player awards ----
  // MVP = best OPS-weighted overall bat line with volume; Offensive POY =
  // most total bases + RBI; Pitcher of Year = best ERA among qualified;
  // Defensive POY (no fielding stats yet) -> best fielding pos player by
  // a simple proxy (most games at a non-EH position) — flagged provisional.
  function seasonAwards(seasonId){
    const {bat,pitch}=Stats.league({includeLive:true, seasonId});
    const out=[];

    // helper to make an award row from a playerId
    const make=(title,playerId,detail)=>{
      const r=Stats.resolve(playerId); if(!r) return null;
      return {title, playerId, name:r.player.name, num:r.player.num,
              teamName:r.team.name, teamId:r.team.id, color:r.team.color, detail};
    };

    // MVP — composite: OPS * sqrt(PA) to reward both rate and volume
    let mvp=null,mvpScore=-1;
    Object.entries(bat).forEach(([id,b])=>{
      if(b.pa<3) return;
      const score=Stats.ops(b)*Math.sqrt(b.pa) + b.rbi*0.15 + b.hr*0.3;
      if(score>mvpScore){ mvpScore=score; mvp=id; }
    });
    if(mvp){ const b=bat[mvp];
      const a=make('MVP',mvp,`${fmt3(Stats.ops(b))} OPS · ${b.hr} HR · ${b.rbi} RBI`); if(a)out.push(a); }

    // Offensive Player of the Year — most total bases (+RBI tiebreak)
    let opoy=null,opoyScore=-1;
    Object.entries(bat).forEach(([id,b])=>{
      const score=b.tb*2+b.rbi;
      if(score>opoyScore && b.ab>0){ opoyScore=score; opoy=id; }
    });
    if(opoy && opoy!==mvp){ const b=bat[opoy];
      const a=make('Offensive Player of the Year',opoy,`${b.tb} TB · ${b.rbi} RBI · ${b.hr} HR`); if(a)out.push(a); }

    // Pitcher of the Year — lowest ERA among those with >=3 outs
    let poy=null,poyEra=Infinity;
    Object.entries(pitch).forEach(([id,p])=>{
      if(p.outs<3) return;
      const e=Stats.era(p);
      if(e<poyEra){ poyEra=e; poy=id; }
    });
    if(poy){ const p=pitch[poy];
      const a=make('Pitcher of the Year',poy,`${Stats.era(p).toFixed(2)} ERA · ${p.k} K · ${Stats.ipStr(p)} IP`); if(a)out.push(a); }

    // Defensive Player of the Year — most chances handled (PO+A), now that
    // fielding is derived from located plays. Tiebreak: fewer errors.
    const dleaders=Stats.fieldLeaders({seasonId, minChances:3});
    if(dleaders.length){ const d=dleaders[0]; const f=d.f;
      const a=make('Defensive Player of the Year',d.id,
        `${f.po} PO · ${f.a} A · ${f.e} E`); if(a)out.push(a); }

    // Most Improved — needs >=2 seasons; compare this season vs prior OPS
    const mip=mostImproved(seasonId, bat);
    if(mip) out.push(mip);

    return out;
  }

  // Most Improved: only meaningful for a specific season with a prior one.
  function mostImproved(seasonId, curBat){
    if(!seasonId) return null;
    const seasons=(Store.get().seasons||[]).slice().sort((a,b)=>a.created-b.created);
    const idx=seasons.findIndex(s=>s.id===seasonId);
    if(idx<=0) return null;                    // no prior season
    const prevId=seasons[idx-1].id;
    const prev=Stats.league({includeLive:true, seasonId:prevId}).bat;
    let best=null,bestGain=0.15;                // require a real jump
    Object.entries(curBat).forEach(([id,b])=>{
      if(b.pa<3) return;
      const pb=prev[id]; if(!pb||pb.pa<3) return;
      const gain=Stats.ops(b)-Stats.ops(pb);
      if(gain>bestGain){ bestGain=gain; best=id; }
    });
    if(!best) return null;
    const r=Stats.resolve(best); if(!r) return null;
    return {title:'Most Improved', playerId:best, name:r.player.name, num:r.player.num,
            teamName:r.team.name, teamId:r.team.id, color:r.team.color,
            detail:`+${fmt3(bestGain)} OPS vs prior season`};
  }

  // ---- Team records (single-game + season extremes) ----
  function teamRecords(seasonId){
    const s=Store.get();
    let games=s.history.slice();
    if(seasonId) games=games.filter(g=>g.seasonId===seasonId);
    const recs=[];
    if(!games.length) return recs;

    // Most runs in a game (by one team)
    let topRuns={runs:-1};
    games.forEach(g=>{
      [['away',g.away.name],['home',g.home.name]].forEach(([side,name])=>{
        const r=g.totals[side].r;
        if(r>topRuns.runs) topRuns={runs:r,team:name,g};
      });
    });
    if(topRuns.runs>0) recs.push({label:'Most Runs in a Game', value:topRuns.runs,
      team:topRuns.team, sub:gameLabel(topRuns.g)});

    // Largest margin of victory
    let topMargin={m:-1};
    games.forEach(g=>{
      const m=Math.abs(g.totals.away.r-g.totals.home.r);
      const winner=g.totals.away.r>g.totals.home.r?g.away.name:g.home.name;
      if(m>topMargin.m) topMargin={m,winner,g};
    });
    if(topMargin.m>0) recs.push({label:'Largest Margin of Victory', value:topMargin.m,
      team:topMargin.winner, sub:gameLabel(topMargin.g)});

    // Longest winning streak (per team, chronological)
    const streak=longestStreak(games);
    if(streak.len>1) recs.push({label:'Longest Win Streak', value:streak.len,
      team:streak.team, sub:'consecutive wins'});

    // Highest team batting average (season aggregate from box hits/at-bats proxy via H and outs)
    // We approximate team AVG from per-team batting lines tallied across season.
    const teamAvg=highestTeamAvg(seasonId);
    if(teamAvg) recs.push({label:'Highest Team Avg', value:fmt3(teamAvg.avg),
      team:teamAvg.team, sub:`${teamAvg.h}-for-${teamAvg.ab}`});

    return recs;
  }

  function gameLabel(g){
    return `${g.away.name} ${g.totals.away.r}–${g.totals.home.r} ${g.home.name}`;
  }

  function longestStreak(games){
    // games come newest-first in history; sort oldest-first
    const chron=games.slice().sort((a,b)=>a.created-b.created);
    const cur={}; let best={len:0,team:null};
    chron.forEach(g=>{
      const aw=g.totals.away.r, hw=g.totals.home.r;
      const winner = aw>hw?g.away.name : hw>aw?g.home.name : null;
      const loser  = aw>hw?g.home.name : hw>aw?g.away.name : null;
      if(winner){
        cur[winner]=(cur[winner]||0)+1;
        if(cur[winner]>best.len) best={len:cur[winner],team:winner};
        if(loser) cur[loser]=0;
      } else { // tie breaks both
        cur[g.away.name]=0; cur[g.home.name]=0;
      }
    });
    return best;
  }

  // team batting average from player bat lines summed by team
  function highestTeamAvg(seasonId){
    const {bat}=Stats.league({includeLive:true, seasonId});
    const byTeam={};
    Object.entries(bat).forEach(([id,b])=>{
      const r=Stats.resolve(id); if(!r) return;
      const t=byTeam[r.team.name]||(byTeam[r.team.name]={h:0,ab:0,team:r.team.name});
      t.h+=b.h; t.ab+=b.ab;
    });
    let best=null;
    Object.values(byTeam).forEach(t=>{
      if(t.ab<5) return;
      const avg=t.h/t.ab;
      if(!best||avg>best.avg) best={...t,avg};
    });
    return best;
  }

  function fmt3(v){ return v>=1?v.toFixed(3):('.'+Math.round(v*1000).toString().padStart(3,'0')); }

  // ---- Game MVP history ----
  // Count Game MVP awards per player, optionally scoped to a season.
  function mvpHistory(seasonId){
    const s=Store.get();
    let games=s.history.filter(g=>g.mvpId);
    if(seasonId) games=games.filter(g=>g.seasonId===seasonId);
    const counts={};
    games.forEach(g=>{
      const c=counts[g.mvpId]||(counts[g.mvpId]={playerId:g.mvpId, total:0, games:[]});
      c.total++; c.games.push(g);
    });
    return Object.values(counts).map(c=>{
      const r=Stats.resolve(c.playerId);
      return {...c, name:r?r.player.name:'—', num:r?r.player.num:'',
              teamName:r?r.team.name:'', teamId:r?r.team.id:null, color:r?r.team.color:'#ff6b35'};
    }).filter(c=>c.teamId).sort((a,b)=>b.total-a.total);
  }
  // total MVP count for one player (career)
  function playerMvpCount(playerId){
    return Store.get().history.filter(g=>g.mvpId===playerId).length;
  }

  return { seasonAwards, teamRecords, mvpHistory, playerMvpCount };
})();

/* ============================================================
   SCHEDULE — games, practices, tournaments + per-player RSVPs.
   Each event: {id,type,title,teamId,oppName,start(ISO),location,
   notes,seasonId,rsvps:{playerId:'in'|'out'|'maybe'}}
   ============================================================ */
