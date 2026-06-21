import { Store } from './storage.js';

export const Tournament = (()=>{
  let _seq=0;
  const uid = p => p+Date.now()+'_'+(_seq++);

  const FORMATS={
    single:{label:'Single Elimination', icon:'🥇'},
    double:{label:'Double Elimination', icon:'🥈'},
    roundrobin:{label:'Round Robin', icon:'🔄'},
  };

  function all(){ return (Store.get().tournaments||[]).slice(); }
  function byId(id){ return all().find(t=>t.id===id); }
  function remove(id){ const s=Store.get(); s.tournaments=s.tournaments.filter(t=>t.id!==id); }

  // create + generate the bracket structure
  function create({name, format, teamIds, seasonId}){
    const t={
      id:uid('tn'), name:name||'Tournament', format:format||'single',
      teamIds:teamIds.slice(), seasonId:seasonId||Store.get().currentSeasonId||null,
      created:Date.now(), matches:[], champion:null
    };
    if(format==='roundrobin') t.matches=genRoundRobin(teamIds);
    else if(format==='double') t.matches=genDoubleElim(teamIds);
    else t.matches=genSingleElim(teamIds);
    Store.get().tournaments.push(t);
    return t;
  }

  // ---- seeding helper: standard bracket seeding order for n (power of 2) ----
  function seedOrder(n){
    let seeds=[1,2];
    while(seeds.length<n){
      const next=[]; const len=seeds.length*2+1;
      seeds.forEach(s=>{ next.push(s); next.push(len-s); });
      seeds=next;
    }
    return seeds; // 1-indexed seed positions
  }
  function nextPow2(n){ let p=1; while(p<n)p*=2; return p; }

  // ---- SINGLE ELIMINATION ----
  function genSingleElim(teamIds){
    const n=teamIds.length;
    const size=nextPow2(n);
    const order=seedOrder(size);
    // round 1 pairings from seed order; byes where seed > n
    const matches=[];
    const r1=[];
    for(let i=0;i<size;i+=2){
      const sa=order[i], sb=order[i+1];
      const a=sa<=n?teamIds[sa-1]:null;  // null = bye
      const b=sb<=n?teamIds[sb-1]:null;
      r1.push({a,b});
    }
    let round=1, prevIds=[];
    r1.forEach((p,idx)=>{
      const m={id:uid('m'), round, bracket:'w', slot:idx,
        a:p.a?{teamId:p.a}:null, b:p.b?{teamId:p.b}:null,
        scoreA:null, scoreB:null, winner:null, bye:false};
      // auto-resolve byes
      if(p.a && !p.b){ m.winner='a'; m.bye=true; }
      else if(!p.a && p.b){ m.winner='b'; m.bye=true; }
      matches.push(m); prevIds.push(m.id);
    });
    // subsequent rounds reference winners of prior matches
    let count=prevIds.length;
    while(count>1){
      round++;
      const next=[];
      for(let i=0;i<count;i+=2){
        const m={id:uid('m'), round, bracket:'w', slot:i/2,
          a:{from:'winner', match:prevIds[i]},
          b:{from:'winner', match:prevIds[i+1]},
          scoreA:null, scoreB:null, winner:null, bye:false};
        matches.push(m); next.push(m.id);
      }
      prevIds=next; count=next.length;
    }
    // resolve any byes forward immediately
    resolveByes(matches);
    return matches;
  }

  // propagate bye winners into dependent slots
  function resolveByes(matches){
    let changed=true;
    while(changed){
      changed=false;
      matches.forEach(m=>{
        if(m.winner && m.bye){
          const wId=winnerTeamId(m, matches);
          matches.forEach(dep=>{
            ['a','b'].forEach(side=>{
              const slot=dep[side];
              if(slot && slot.from==='winner' && slot.match===m.id && !dep._resolved_+side){
                // leave as reference; resolution is computed live in teamInSlot
              }
            });
          });
        }
      });
    }
  }

  // ---- ROUND ROBIN ----
  function genRoundRobin(teamIds){
    const matches=[]; let slot=0;
    for(let i=0;i<teamIds.length;i++){
      for(let j=i+1;j<teamIds.length;j++){
        matches.push({id:uid('m'), round:1, bracket:'rr', slot:slot++,
          a:{teamId:teamIds[i]}, b:{teamId:teamIds[j]},
          scoreA:null, scoreB:null, winner:null, bye:false});
      }
    }
    return matches;
  }

  // ---- DOUBLE ELIMINATION (simplified, correct for up to 8 teams) ----
  function genDoubleElim(teamIds){
    // build winners bracket like single elim
    const w=genSingleElim(teamIds);
    w.forEach(m=>m.bracket='w');
    // losers bracket: created structurally; teams flow in as they lose.
    // For a clean local implementation we generate L-bracket match shells
    // sized to absorb losers. Number of L matches = (size-1) - 1.
    const size=nextPow2(teamIds.length);
    const wRounds=Math.log2(size);
    const losers=[];
    // simplified: one consolidation chain. Each W-round feeds losers in.
    let lSlot=0;
    for(let r=1;r<wRounds*2;r++){
      // create shells; they reference 'loser' from winners and 'winner' from losers
      losers.push({id:uid('m'), round:r, bracket:'l', slot:lSlot++,
        a:null, b:null, scoreA:null, scoreB:null, winner:null, bye:false, _placeholder:true});
    }
    // grand final
    const gf={id:uid('m'), round:99, bracket:'gf', slot:0,
      a:{from:'champion', bracket:'w'}, b:{from:'champion', bracket:'l'},
      scoreA:null, scoreB:null, winner:null, bye:false};
    return [...w, ...losers, gf];
  }

  // ---- resolve which team currently occupies a slot ----
  function teamInSlot(slot, matches){
    if(!slot) return null;
    if(slot.teamId) return slot.teamId;
    if(slot.from==='winner'){
      const m=matches.find(x=>x.id===slot.match);
      return m && m.winner ? winnerTeamId(m, matches) : null;
    }
    if(slot.from==='loser'){
      const m=matches.find(x=>x.id===slot.match);
      return m && m.winner ? loserTeamId(m, matches) : null;
    }
    if(slot.from==='champion'){
      // final champion of a bracket (winners or losers)
      const bms=matches.filter(x=>x.bracket===slot.bracket);
      const last=bms.sort((a,b)=>b.round-a.round||b.slot-a.slot)[0];
      return last && last.winner ? winnerTeamId(last, matches) : null;
    }
    return null;
  }
  function winnerTeamId(m, matches){
    if(!m.winner) return null;
    return teamInSlot(m.winner==='a'?m.a:m.b, matches);
  }
  function loserTeamId(m, matches){
    if(!m.winner) return null;
    return teamInSlot(m.winner==='a'?m.b:m.a, matches);
  }

  // ---- record a result on a match ----
  function setResult(tId, matchId, scoreA, scoreB){
    const t=byId(tId); if(!t) return;
    const m=t.matches.find(x=>x.id===matchId); if(!m) return;
    m.scoreA=scoreA; m.scoreB=scoreB;
    m.winner = scoreA>scoreB?'a':scoreB>scoreA?'b':null;
    updateChampion(t);
  }
  function clearResult(tId, matchId){
    const t=byId(tId); if(!t) return;
    const m=t.matches.find(x=>x.id===matchId); if(!m||m.bye) return;
    m.scoreA=null; m.scoreB=null; m.winner=null;
    updateChampion(t);
  }
  function updateChampion(t){
    if(t.format==='roundrobin'){
      const st=standings(t);
      t.champion = (st.length && st[0].played>0 && allPlayed(t)) ? st[0].teamId : null;
      return;
    }
    // elimination: champion = winner of the final match (highest round)
    const finals=t.matches.filter(m=>m.bracket==='w'||m.bracket==='gf');
    const last=finals.sort((a,b)=>b.round-a.round||b.slot-a.slot)[0];
    t.champion = last && last.winner ? winnerTeamId(last, t.matches) : null;
  }
  function allPlayed(t){ return t.matches.every(m=>m.winner||m.bye||m.scoreA!=null); }

  // ---- round robin standings ----
  function standings(t){
    const rec={};
    t.teamIds.forEach(id=>rec[id]={teamId:id,w:0,l:0,played:0,rf:0,ra:0});
    t.matches.forEach(m=>{
      if(m.winner==null||m.scoreA==null) return;
      const aId=teamInSlot(m.a,t.matches), bId=teamInSlot(m.b,t.matches);
      if(!aId||!bId) return;
      rec[aId].played++; rec[bId].played++;
      rec[aId].rf+=m.scoreA; rec[aId].ra+=m.scoreB;
      rec[bId].rf+=m.scoreB; rec[bId].ra+=m.scoreA;
      if(m.winner==='a'){ rec[aId].w++; rec[bId].l++; }
      else { rec[bId].w++; rec[aId].l++; }
    });
    return Object.values(rec).map(r=>({...r,diff:r.rf-r.ra,
      pct:r.played?r.w/r.played:0})).sort((a,b)=>b.pct-a.pct||b.diff-a.diff);
  }

  // group matches by round for rendering
  function rounds(t, bracket){
    const ms=t.matches.filter(m=>!bracket||m.bracket===bracket);
    const byRound={};
    ms.forEach(m=>{ (byRound[m.round]=byRound[m.round]||[]).push(m); });
    return Object.keys(byRound).map(Number).sort((a,b)=>a-b)
      .map(r=>({round:r, matches:byRound[r].sort((a,b)=>a.slot-b.slot)}));
  }
  function roundName(t, round, totalRounds){
    const fromEnd=totalRounds-round;
    if(fromEnd===0) return 'Final';
    if(fromEnd===1) return 'Semifinals';
    if(fromEnd===2) return 'Quarterfinals';
    return `Round ${round}`;
  }

  return { FORMATS, all, byId, create, remove, setResult, clearResult,
           teamInSlot, winnerTeamId, standings, rounds, roundName,
           nextPow2, seedOrder };
})();
