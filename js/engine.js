export const Engine = (()=> {

  // default rules = standard baseball (no caps), so existing games are unchanged
  function defaultRules(){
    return {
      preset:'standard',
      runLimitPerInning:0,   // 0 = unlimited
      openFinalInning:true,  // last inning uncapped (only matters if runLimit>0)
      mercyEnabled:false,
      mercyRuns:0,           // run differential that triggers mercy
      mercyAfterInning:0,    // earliest inning mercy can apply
      tieBreaker:'none',     // 'none' | 'extra' | 'placed-runner' (intl tiebreak)
      // advisory / tracked, not hard-enforced:
      courtesyRunners:false,
      coedRequired:false,
      maxArc:0,              // slow-pitch pitch arc note (display only)
    };
  }
  function newGame(cfg){
    return {
      id:'g'+Date.now(),
      created:Date.now(),
      seasonId:cfg.seasonId||null,   // which season this game belongs to
      away:{ name:cfg.away||'Away', roster:cfg.awayRoster||[], teamId:cfg.awayTeamId||null, pitcherId:cfg.awayPitcherId||null },
      home:{ name:cfg.home||'Home', roster:cfg.homeRoster||[], teamId:cfg.homeTeamId||null, pitcherId:cfg.homePitcherId||null },
      innings:cfg.innings||7,
      rules:Object.assign(defaultRules(), cfg.rules||{}),
      // live state
      inning:1, half:'top',            // top = away bats
      outs:0, balls:0, strikes:0,
      bases:[null,null,null],          // [1B,2B,3B] hold batter index or {name}
      battingIndex:{top:0,bottom:0},   // lineup pointer per team
      line:{ away:[], home:[] },       // runs per inning
      totals:{ away:{r:0,h:0,e:0}, home:{r:0,h:0,e:0} },
      events:[],                       // full play-by-play
      final:false
    };
  }

  const battingTeam = g => g.half==='top' ? 'away' : 'home';
  const fieldingTeam = g => g.half==='top' ? 'home' : 'away';

  function currentBatter(g){
    const t = battingTeam(g);
    const roster = g[t].roster;
    if(!roster.length) return {name:'Batter', num:''};
    const i = g.battingIndex[g.half] % roster.length;
    return roster[i];
  }

  function ensureInningCell(g){
    const arr = g.line[battingTeam(g)];
    while(arr.length < g.inning) arr.push(0);
  }

  // mutate helpers ------------------------------------------------
  function addRun(g, n=1){
    ensureInningCell(g);
    const t = battingTeam(g);
    // apply slow-pitch run limit per half-inning (if configured)
    const lim = runLimitFor(g);
    if(lim>0){
      const already = g._halfRuns||0;
      const room = Math.max(0, lim - already);
      n = Math.min(n, room);
      g._halfRuns = already + n;
    }
    if(n<=0) return 0;
    g.line[t][g.inning-1] += n;
    g.totals[t].r += n;
    return n;
  }
  // effective run cap this half-inning (0 = unlimited). Final inning may be open.
  function runLimitFor(g){
    const r=g.rules||{};
    if(!r.runLimitPerInning) return 0;
    if(r.openFinalInning && g.inning>=g.innings) return 0;  // uncapped final inning
    return r.runLimitPerInning;
  }
  // is this half-inning's run cap already reached?
  function runCapReached(g){
    const lim=runLimitFor(g);
    return lim>0 && (g._halfRuns||0)>=lim;
  }

  function pushEvent(g, ev){
    const t = battingTeam(g);
    const b = currentBatter(g);
    const e = Object.assign({
      i:g.inning, half:g.half, ts:Date.now(),
      batter:b.name, batterId:b.id||null,
      teamId:g[t].teamId||null, side:t,
      // record the fielding team's pitcher for pitching stats
      pitcherId:(g[fieldingTeam(g)].pitcherId)||null,
      // snapshot state for visual replay: bases before/after, outs, score
      basesBefore:(g._basesBefore||[null,null,null]).slice(),
      basesAfter:g.bases.slice(),
      outsAfter:g.outs,
      scoreAfter:{away:g.totals.away.r, home:g.totals.home.r}
    }, ev);
    // pitches this PA = balls + strikes (+1 for the pitch put in play). Manual
    // walk/K shortcut buttons leave the count at 0, so this can undercount when
    // the ball/strike buttons weren't used — best-effort, like ERA/LOB.
    const CONTACT_BONUS = {hit:1,out:1,sac:1,fc:1,dp:1,error:1,walk:0,k:0};
    e.pitches = (e.type in CONTACT_BONUS) ? (g.balls + g.strikes + CONTACT_BONUS[e.type]) : 0;
    g.events.push(e);
  }

  function clearCount(g){ g.balls=0; g.strikes=0; }

  function nextBatter(g){ g.battingIndex[g.half]++; clearCount(g); }

  function recordOut(g, label, meta){
    g.outs++;
    pushEvent(g,Object.assign({type:'out',label}, meta||{}));
    if(g.outs>=3){ endHalf(g); }
    else nextBatter(g);
  }

  function endHalf(g){
    ensureInningCell(g);
    g.outs=0; clearCount(g); g.bases=[null,null,null];
    g._halfRuns=0;   // reset run-limit counter for the new half
    if(g.half==='top'){ g.half='bottom'; }
    else { g.half='top'; g.inning++; }
  }

  // ---- runner identity on the bases ----------------------------
  // A base holds a runner object {name, id} so we can attribute the
  // run to whoever crosses the plate. Legacy saves (and the manual
  // run/advance UI) may still hold a bare name string; the helpers
  // below read either shape so nothing crashes on old data.
  function runnerObj(g){ const b=currentBatter(g); return {name:b.name, id:b.id||null}; }
  function runnerName(occ){ return occ==null ? '' : (typeof occ==='string' ? occ : (occ.name||'')); }
  function runnerKey(occ){ return occ==null ? null : (typeof occ==='string' ? occ : (occ.id||occ.name||null)); }
  // normalize a list of base occupants into stable {id,name} records
  // for the event log (survives JSON round-trips; legacy strings ok).
  function scoredInfo(arr){
    return (arr||[]).map(o => typeof o==='string'
      ? {id:null, name:o}
      : {id:(o&&o.id)||null, name:(o&&o.name)||''});
  }

  // advance every runner by `n` bases; runners past 3rd score.
  // Returns {runs, scored} where scored is the list of {id,name} that
  // actually crossed the plate (respecting any run-limit cap).
  function advanceAll(g, n, batterReaches){
    const scored=[];
    const newBases=[null,null,null];
    // existing runners (lead runners resolved first so a run cap
    // credits the runners closest to home)
    for(let b=2;b>=0;b--){
      if(g.bases[b]!=null){
        const dest=b+n;
        if(dest>=3) scored.push(g.bases[b]);
        else newBases[dest]=g.bases[b];
      }
    }
    // batter
    if(batterReaches!=null){
      const dest=batterReaches-1; // 1B->index0
      const bo=runnerObj(g);
      if(dest>=3) scored.push(bo);
      else newBases[dest]=bo;
    }
    g.bases=newBases;
    const added = scored.length ? addRun(g, scored.length) : 0;
    return {runs:added, scored:scoredInfo(scored.slice(0, added))};
  }

  // ---- public actions -------------------------------------------
  const actions = {
    ball(g){ g.balls++; if(g.balls>=4){ walk(g); } },
    strike(g){ g.strikes++; if(g.strikes>=3){ strikeout(g); } },
    foul(g){ if(g.strikes<2) g.strikes++; },

    single(g,meta){ hit(g,'1B',1,meta); },
    double(g,meta){ hit(g,'2B',2,meta); },
    triple(g,meta){ hit(g,'3B',3,meta); },
    homer(g,meta){ hit(g,'HR',4,meta); },

    walkBtn(g){ walk(g); },
    groundout(g,meta){ recordOut(g,'Groundout',Object.assign({bbType:'ground'},meta||{})); },
    flyout(g,meta){ recordOut(g,'Flyout',Object.assign({bbType:'fly'},meta||{})); },
    strikeoutBtn(g){ strikeout(g); },
    sacFly(g){
      // scores runner from 3rd if present, counts as out
      const scored=[];
      if(g.bases[2]!=null){ const r3=g.bases[2]; g.bases[2]=null; if(addRun(g,1)) scored.push(r3); }
      pushEvent(g,{type:'sac',label:'Sac Fly',rbi:scored.length,scored:scoredInfo(scored)});
      g.outs++;
      if(g.outs>=3) endHalf(g); else nextBatter(g);
    },
    fieldersChoice(g){
      // batter safe at 1st, lead runner out (simplified: out at next base)
      pushEvent(g,{type:'fc',label:"Fielder's Choice"});
      // remove lead runner
      for(let b=2;b>=0;b--){ if(g.bases[b]!=null){ g.bases[b]=null; break; } }
      g.bases[0]=runnerObj(g);
      g.outs++;
      if(g.outs>=3){ endHalf(g); } else nextBatter(g);
    },
    error(g){
      g.totals[fieldingTeam(g)].e++;
      const {scored}=advanceAll(g,1,1);
      pushEvent(g,{type:'error',label:'Reached on Error',scored});
      nextBatter(g);
    },
    stolenBase(g){
      // advance lead-most single runner one base (simplified)
      for(let b=2;b>=0;b--){
        if(g.bases[b]!=null){
          if(b===2){ const r3=g.bases[2]; g.bases[2]=null; const got=addRun(g,1);
            pushEvent(g,{type:'sb',label:'Stolen Base',scored:got?scoredInfo([r3]):[]}); }
          else { g.bases[b+1]=g.bases[b]; g.bases[b]=null;
            pushEvent(g,{type:'sb',label:'Stolen Base'}); }
          return;
        }
      }
    },
    doublePlay(g){
      pushEvent(g,{type:'dp',label:'Double Play'});
      // remove a lead runner + batter, 2 outs
      for(let b=2;b>=0;b--){ if(g.bases[b]!=null){ g.bases[b]=null; break; } }
      g.outs+=2;
      if(g.outs>=3){ endHalf(g); } else nextBatter(g);
    },

    manualRun(g){ addRun(g,1); pushEvent(g,{type:'run',label:'Run scores'}); },
    out(g){ recordOut(g,'Out'); },
  };

  function hit(g,label,bases,meta){
    g.totals[battingTeam(g)].h++;
    const {runs, scored} = advanceAll(g, bases, bases);
    pushEvent(g,Object.assign({type:'hit',label,bases,rbi:runs,scored}, meta||{}));
    if(runCapReached(g)){ capOut(g); } else nextBatter(g);
  }
  // run cap reached → retire the side (slow-pitch run limit)
  function capOut(g){
    pushEvent(g,{type:'cap',label:`Run limit reached (${runLimitFor(g)})`});
    endHalf(g);
  }
  function walk(g){
    // force advance
    const scored=[];
    if(g.bases[0]!=null){
      if(g.bases[1]!=null){
        if(g.bases[2]!=null){ if(addRun(g,1)) scored.push(g.bases[2]); }
        g.bases[2]=g.bases[1];
      }
      g.bases[1]=g.bases[0];
    }
    g.bases[0]=runnerObj(g);
    pushEvent(g,{type:'walk',label:'Walk',scored:scoredInfo(scored)});
    nextBatter(g);
  }
  function strikeout(g){
    pushEvent(g,{type:'k',label:'Strikeout'});
    g.outs++;
    if(g.outs>=3) endHalf(g); else nextBatter(g);
  }

  function isMercyOrDone(g){
    const r=g.rules||{};
    // configurable mercy rule: run differential at/after a given inning
    if(r.mercyEnabled && r.mercyRuns>0){
      const diff=Math.abs(g.totals.home.r-g.totals.away.r);
      const inningOK = g.inning>=(r.mercyAfterInning||1);
      // only call mercy when the trailing team has completed its at-bat
      // (i.e. start of a new half) so the leading team can't be denied a turn
      if(diff>=r.mercyRuns && inningOK && g.outs===0 && g.balls===0 && g.strikes===0){
        return true;
      }
    }
    if(g.inning>g.innings && g.half==='top'){
      // home leads after completing regulation
      if(g.totals.home.r>g.totals.away.r) return true;
    }
    if(g.inning>g.innings && g.half==='bottom' && g.outs===0){
      return g.totals.home.r!==g.totals.away.r;
    }
    return false;
  }

  // common rule presets for quick setup
  const RULE_PRESETS={
    standard:{label:'Standard Baseball', rules:{preset:'standard',runLimitPerInning:0,mercyEnabled:false}},
    slowpitch:{label:'Slow-Pitch (5-run cap)', rules:{preset:'slowpitch',runLimitPerInning:5,openFinalInning:true,mercyEnabled:true,mercyRuns:15,mercyAfterInning:4,maxArc:12}},
    rec:{label:'Rec League', rules:{preset:'rec',runLimitPerInning:7,openFinalInning:true,mercyEnabled:true,mercyRuns:10,mercyAfterInning:5}},
    coed:{label:'Co-Ed Slow-Pitch', rules:{preset:'coed',runLimitPerInning:5,openFinalInning:true,coedRequired:true,mercyEnabled:true,mercyRuns:12,mercyAfterInning:4,courtesyRunners:true}},
    tournament:{label:'Tournament', rules:{preset:'tournament',runLimitPerInning:0,mercyEnabled:true,mercyRuns:12,mercyAfterInning:5,tieBreaker:'placed-runner'}},
  };

  return { newGame, currentBatter, battingTeam, fieldingTeam, actions, isMercyOrDone,
           endHalfPublic:endHalf, defaultRules, runLimitFor, runCapReached, RULE_PRESETS,
           runnerName, runnerKey, scoredInfo };
})();

/* ============================================================
   TEAMS + LINEUPS domain
   Players are persistent records. Lineups reference player ids,
   so editing a player updates everywhere. This is the spine that
   stats / RSVPs / AI reports will attach to in later sessions.
   ============================================================ */
