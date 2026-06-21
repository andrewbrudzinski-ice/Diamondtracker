import { Store } from './storage.js';

export const Stats = (()=>{
  function blankBat(){
    return {pa:0,ab:0,h:0,b1:0,b2:0,b3:0,hr:0,bb:0,k:0,rbi:0,r:0,sb:0,sf:0,tb:0,games:0};
  }
  function blankPitch(){ return {outs:0,h:0,bb:0,k:0,r:0,bf:0,games:0}; }
  function blankField(){ return {po:0,a:0,e:0,games:0}; }

  // tally one game's events into maps keyed by playerId
  function tallyGame(g, bat, pitch, field){
    const seenBat=new Set(), seenPitch=new Set();
    g.events.forEach(ev=>{
      const id=ev.batterId;
      if(id){
        const b=bat[id]||(bat[id]=blankBat());
        if(!seenBat.has(id)){ b.games++; seenBat.add(id); }
        accumBat(b,ev);
      }
      const pid=ev.pitcherId;
      if(pid){
        const p=pitch[pid]||(pitch[pid]=blankPitch());
        if(!seenPitch.has(pid)){ p.games++; seenPitch.add(pid); }
        accumPitch(p,ev);
      }
      // credit runs scored to whoever crossed the plate on this play.
      // (Scorer may differ from the batter, e.g. a runner driven in.)
      if(Array.isArray(ev.scored)){
        ev.scored.forEach(sc=>{ if(sc && sc.id){ (bat[sc.id]||(bat[sc.id]=blankBat())).r++; } });
      }
    });
  }

  function accumBat(b,ev){
    switch(ev.type){
      case 'hit':{
        b.pa++; b.ab++; b.h++; b.tb+=ev.bases||1;
        if(ev.bases===1)b.b1++; else if(ev.bases===2)b.b2++;
        else if(ev.bases===3)b.b3++; else if(ev.bases===4)b.hr++;
        b.rbi+=ev.rbi||0; break;
      }
      case 'walk': b.pa++; b.bb++; break;
      case 'k': b.pa++; b.ab++; b.k++; break;
      case 'out': b.pa++; b.ab++; break;
      case 'dp': b.pa++; b.ab++; break;
      case 'fc': b.pa++; b.ab++; break;
      case 'sac': b.pa++; b.sf++; b.rbi+=ev.rbi||0; break;  // SF: not an AB
      case 'error': b.pa++; b.ab++; break;                  // reached on error = AB, no hit
      case 'sb': b.sb++; break;                             // baserunning, not a PA
      // 'run' is a team event, runner R credited below
    }
  }
  function accumPitch(p,ev){
    // pitcher faces the batter on PA-producing events
    if(['hit','walk','k','out','dp','fc','sac','error'].includes(ev.type)){
      p.bf++;
      if(ev.type==='hit')p.h++;
      if(ev.type==='walk')p.bb++;
      if(ev.type==='k')p.k++;
      // outs recorded
      if(ev.type==='k'||ev.type==='out'||ev.type==='fc'||ev.type==='error'&&false) p.outs+=1;
      if(ev.type==='sac') p.outs+=1;
      if(ev.type==='dp') p.outs+=2;
      p.r+=ev.rbi||0; // earned-ish: runs driven in while pitching (approx)
    }
  }

  // derived rate stats
  function avg(b){ return b.ab? b.h/b.ab : 0; }
  function obp(b){ const d=b.ab+b.bb+b.sf; return d? (b.h+b.bb)/d : 0; }
  function slg(b){ return b.ab? b.tb/b.ab : 0; }
  function ops(b){ return obp(b)+slg(b); }
  function era(p,innings){ const ip=p.outs/3; return ip? (p.r*(innings||7))/ip : 0; }
  function whip(p){ const ip=p.outs/3; return ip? (p.bb+p.h)/ip : 0; }
  function ipStr(p){ const whole=Math.floor(p.outs/3), rem=p.outs%3; return `${whole}.${rem}`; }

  // build full league stat tables across all history (+ optional live game)
  // Build stat tables. opts: {includeLive, seasonId}
  //   seasonId omitted/null => CAREER (all seasons).
  //   seasonId set          => only that season's games.
  function league(opts){
    // back-compat: league(true) means includeLive+career; league(false) means no live
    if(opts===true||opts===undefined) opts={includeLive:true};
    else if(opts===false) opts={includeLive:false};
    const {includeLive=true, seasonId=null} = opts;
    const s=Store.get();
    const bat={}, pitch={}, field={};
    let games=[...s.history];
    if(includeLive && s.game) games.push(s.game);
    if(seasonId) games=games.filter(g=>g.seasonId===seasonId);
    games.forEach(g=>tallyGame(g,bat,pitch,field));
    return {bat,pitch,field};
  }

  function playerBatting(playerId,includeLive=true,seasonId=null){
    return league({includeLive,seasonId}).bat[playerId]||blankBat();
  }
  function playerPitching(playerId,includeLive=true,seasonId=null){
    return league({includeLive,seasonId}).pitch[playerId]||blankPitch();
  }

  // leaders for a given batting stat (min AB filter for rate stats)
  function leaders(stat,opts={}){
    const {bat}=league({includeLive:true, seasonId:opts.seasonId||null});
    const min=opts.minAB||0;
    const counting=['hr','rbi','h','sb','bb','r','b2','b3','tb','b1','k'];
    const rows=Object.entries(bat).map(([id,b])=>({id,b}))
      .filter(x=>counting.includes(stat) || x.b.ab>=min);
    const val=x=>{
      switch(stat){
        case 'avg':return avg(x.b); case 'obp':return obp(x.b);
        case 'slg':return slg(x.b); case 'ops':return ops(x.b);
        case 'hr':return x.b.hr; case 'rbi':return x.b.rbi;
        case 'h':return x.b.h; case 'sb':return x.b.sb; case 'bb':return x.b.bb;
        case 'b1':return x.b.b1; case 'b2':return x.b.b2; case 'b3':return x.b.b3;
        case 'tb':return x.b.tb; case 'k':return x.b.k; case 'r':return x.b.r;
        default:return 0;
      }
    };
    return rows.map(x=>({id:x.id,val:val(x),b:x.b}))
      .filter(x=>x.val>0).sort((a,b)=>b.val-a.val);
  }

  // leaders for pitching stats. ERA/WHIP sort ascending (lower=better).
  function pitchLeaders(stat,opts={}){
    const {pitch}=league({includeLive:true, seasonId:opts.seasonId||null});
    const minOuts=opts.minOuts||0;
    const ascending = stat==='era'||stat==='whip';
    const rows=Object.entries(pitch).map(([id,p])=>({id,p}))
      .filter(x=>x.p.outs>=minOuts && x.p.bf>0);
    const val=x=>{
      switch(stat){
        case 'k':return x.p.k; case 'bb':return x.p.bb;
        case 'era':return era(x.p); case 'whip':return whip(x.p);
        case 'ip':return x.p.outs/3; case 'bf':return x.p.bf;
        case 'h':return x.p.h;
        default:return 0;
      }
    };
    return rows.map(x=>({id:x.id,val:val(x),p:x.p}))
      .filter(x=> ascending ? x.p.outs>0 : x.val>0)
      .sort((a,b)=> ascending ? a.val-b.val : b.val-a.val);
  }

  // Resolve a leaders() result into display rows with player + team attached.
  function leaderTable(kind, stat, opts={}){
    const raw = kind==='pitch' ? pitchLeaders(stat,opts) : leaders(stat,opts);
    return raw.map(x=>{
      const r=resolve(x.id);
      return { id:x.id, val:x.val, line:x.b||x.p,
               name:r?r.player.name:'—', num:r?r.player.num:'',
               teamName:r?r.team.name:'', color:r?r.team.color:'#ff6b35',
               teamId:r?r.team.id:null };
    }).filter(x=>x.teamId); // only ranked, resolvable players
  }

  // resolve a playerId to {player, team} across all saved teams
  function resolve(playerId){
    for(const t of Store.get().teams){
      const p=t.players.find(p=>p.id===playerId);
      if(p) return {player:p,team:t};
    }
    return null;
  }

  // ---- SPRAY CHART data ----
  // collect every batted-ball with a recorded location, optionally filtered
  // by playerId or teamId. Returns markers ready for Field.sprayChart().
  function sprayData(filter={}, includeLive=true){
    const s=Store.get();
    const games=[...s.history];
    if(includeLive && s.game) games.push(s.game);
    const out=[];
    games.forEach(g=>{
      g.events.forEach(ev=>{
        if(ev.hx==null||ev.hy==null) return;             // only located balls
        if(filter.playerId && ev.batterId!==filter.playerId) return;
        if(filter.teamId && ev.teamId!==filter.teamId) return;
        const isOut = ev.type==='out';
        out.push({x:ev.hx, y:ev.hy, bbType:ev.bbType||null,
          outType:isOut, label:ev.label, zone:ev.zone,
          color:isOut?'#ff5566':(ev.bases===4?'#ffc94d':'#3ddc84')});
      });
    });
    return out;
  }
  function sprayCount(filter={}){ return sprayData(filter).length; }

  // ---- CAREER / SEASON helpers ----
  // Per-season batting + pitching lines for a player, newest first.
  function seasonBreakdown(playerId){
    const s=Store.get();
    return (s.seasons||[]).map(season=>({
      season,
      bat: playerBatting(playerId, true, season.id),
      pitch: playerPitching(playerId, true, season.id)
    })).filter(r=> r.bat.pa>0 || r.pitch.bf>0)
       .sort((a,b)=> b.season.created - a.season.created);
  }
  function careerBatting(playerId){ return playerBatting(playerId, true, null); }
  function careerPitching(playerId){ return playerPitching(playerId, true, null); }

  // Milestone detection on career totals. Returns achieved badges.
  const BAT_MILESTONES=[
    {stat:'h',  marks:[5,10,25,50,100,250], label:'Hits'},
    {stat:'hr', marks:[1,5,10,25,50],       label:'Home Runs'},
    {stat:'rbi',marks:[5,10,25,50,100],     label:'RBI'},
    {stat:'sb', marks:[5,10,25],            label:'Steals'},
  ];
  const PITCH_MILESTONES=[
    {stat:'k', marks:[5,10,25,50,100], label:'Strikeouts'},
  ];
  function milestones(playerId){
    const cb=careerBatting(playerId), cp=careerPitching(playerId);
    const out=[];
    BAT_MILESTONES.forEach(m=>{
      const v=cb[m.stat]||0;
      const hit=[...m.marks].reverse().find(mk=>v>=mk);
      if(hit) out.push({label:`${hit} ${m.label}`, value:v, kind:'bat'});
    });
    PITCH_MILESTONES.forEach(m=>{
      const v=cp[m.stat]||0;
      const hit=[...m.marks].reverse().find(mk=>v>=mk);
      if(hit) out.push({label:`${hit} ${m.label}`, value:v, kind:'pitch'});
    });
    return out;
  }

  // ---- LIVE BOX SCORE for a single game ----
  // Returns per-team batting + pitching lines plus team totals & LOB.
  function gameBox(g){
    const bat={}, pitch={}, field={};
    tallyGame(g, bat, pitch, field);   // tally just this game's events
    // split players by side using the side recorded on events
    const sides={away:{batters:[],pitchers:[]}, home:{batters:[],pitchers:[]}};
    const batSide={}, pitchSide={};
    g.events.forEach(ev=>{
      if(ev.batterId && ev.side) batSide[ev.batterId]=ev.side;
      if(ev.pitcherId){ // pitcher belongs to the FIELDING side (opposite of batting side)
        pitchSide[ev.pitcherId]= ev.side==='away'?'home':'away';
      }
    });
    Object.entries(bat).forEach(([id,b])=>{
      const side=batSide[id]; if(!side) return;
      const r=resolve(id);
      sides[side].batters.push({id,name:r?r.player.name:id,num:r?r.player.num:'',line:b});
    });
    Object.entries(pitch).forEach(([id,p])=>{
      const side=pitchSide[id]; if(!side) return;
      const r=resolve(id);
      sides[side].pitchers.push({id,name:r?r.player.name:id,num:r?r.player.num:'',line:p});
    });
    // left on base: runners still on at the time the half ended — approximate
    // from total baserunners reached minus those who scored/were out. Simpler:
    // count walks+hits+errors that reached, minus runs, minus outs-on-base.
    const lob={away:0,home:0};
    // tally reached vs scored per side from events
    const reached={away:0,home:0}, scored={away:0,home:0};
    g.events.forEach(ev=>{
      const side=ev.side; if(!side) return;
      if(['hit','walk','error'].includes(ev.type)) reached[side]++;
      scored[side]+= (ev.rbi||0) + (ev.type==='run'?1:0);
    });
    // crude LOB: reached minus scored, floored at 0 (HRs reach+score so net 0)
    ['away','home'].forEach(s=>{ lob[s]=Math.max(0, reached[s]-scored[s]); });

    return {
      sides,
      totals:{
        away:{r:g.totals.away.r, h:g.totals.away.h, e:g.totals.away.e, lob:lob.away},
        home:{r:g.totals.home.r, h:g.totals.home.h, e:g.totals.home.e, lob:lob.home}
      }
    };
  }

  return { blankBat, blankPitch, avg, obp, slg, ops, era, whip, ipStr,
           league, playerBatting, playerPitching, leaders, pitchLeaders, leaderTable, resolve,
           sprayData, sprayCount,
           seasonBreakdown, careerBatting, careerPitching, milestones, gameBox };
})();

/* ============================================================
   AWARDS & RECORDS — all derived from games + stats, scoped by
   season (or career when seasonId is null). Nothing stored.
   ============================================================ */
