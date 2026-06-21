import { Store } from './storage.js';
import { Engine } from './engine.js';
import { Teams } from './teams.js';
import { Crest } from './crest.js';
import { Field } from './field.js';
import { Standings } from './standings.js';
import { Stats } from './stats.js';
import { Awards } from './awards.js';
import { Schedule } from './schedule.js';
import { Tournament } from './tournament.js';
import { Sync } from './sync.js';
import { AI } from './ai.js';
import { Auth } from './auth.js';

const ord = n => n+(['th','st','nd','rd'][(n%100>>3^1&&n%10)||0]||'th');
const toast = (()=>{ let t; return msg=>{
  const el=document.getElementById('toast'); el.textContent=msg; el.classList.add('show');
  clearTimeout(t); t=setTimeout(()=>el.classList.remove('show'),1400);
};})();

const Sheet = {
  open(html){ document.getElementById('sheet').innerHTML=html;
    document.getElementById('sheetWrap').classList.add('open'); },
  close(){ document.getElementById('sheetWrap').classList.remove('open'); }
};

let activeView = 'score';
let openTournamentId = null;  // active bracket detail, null = list

function setView(v){
  // leaving the Teams tab clears any open team page / lineup builder
  if(v!=='teams'){ teamPageId=null; lineupCtx=null; }
  if(v!=='score'){ pendingPlay=null; smartSuggestion=null; }
  if(v!=='tournaments'){ openTournamentId=null; }
  _animateView = (v !== activeView);  // animate only on a real tab change
  activeView=v; render();
}
let _animateView=false;  // one-shot: play a view-enter transition on next render

// When signed in to a shared room as a non-writer (fan/player), block local
// mutations so the UI matches what RLS enforces server-side. Offline / signed
// out → never blocks (the local app is fully editable, as before).
function blockedByRole(){
  const a=Auth.current();
  if(a.signedIn && !Auth.canWrite(a.role)){
    toast(`Read-only — signed in as ${Auth.roleLabel(a.role)}`);
    return true;
  }
  return false;
}

/* ---- apply an action with undo snapshot ---- */
function act(name, meta){
  const g = Store.get().game;
  if(!g || g.final) return;
  if(blockedByRole()) return;
  if(!g._undo) g._undo=[];
  const runsBefore = g.totals.away.r + g.totals.home.r;
  // snapshot (cheap clone of mutable bits)
  g._undo.push(JSON.stringify({
    inning:g.inning,half:g.half,outs:g.outs,balls:g.balls,strikes:g.strikes,
    bases:g.bases,battingIndex:g.battingIndex,line:g.line,totals:g.totals,
    eventsLen:g.events.length
  }));
  if(g._undo.length>40) g._undo.shift();
  g._basesBefore = g.bases.slice();   // snapshot for visual replay
  Engine.actions[name](g, meta);
  const runsAfter = g.totals.away.r + g.totals.home.r;
  Store.commit();
  navigator.vibrate && navigator.vibrate(name==='homer'?[10,40,20]:8);
  // celebrate scoring plays
  if(name==='homer'){ fxHomeRun(); }
  else if(runsAfter>runsBefore){ fxScorePop(); fxRuns(runsAfter-runsBefore); }
}

/* ---- Interactive play builder: arm a play, tap field to set location ---- */
let pendingPlay = null;   // {action, label, bbType}
let smartSuggestion = null; // transient hint shown after an auto-advance
let replayGameRef = null; // game currently shown in scorebook
let replayIndex = null;   // event index being replayed

/* ---- Visual play replay viewer ---- */
function replayableIndices(g){
  const out=[];
  g.events.forEach((e,i)=>{ if(e.basesBefore!=null && (e.hx!=null||hasMovement(e))) out.push(i); });
  return out;
}
function openReplay(evIndex){
  const g=replayGameRef; if(!g) return;
  replayIndex=evIndex;
  renderReplay();
}
function renderReplay(){
  const g=replayGameRef; if(!g||replayIndex==null) return;
  const e=g.events[replayIndex];
  const idxs=replayableIndices(g);
  const pos=idxs.indexOf(replayIndex);
  const prevIdx=pos>0?idxs[pos-1]:null;
  const nextIdx=pos<idxs.length-1?idxs[pos+1]:null;

  const scoreLine = e.scoreAfter?`${esc(g.away.name)} ${e.scoreAfter.away} — ${e.scoreAfter.home} ${esc(g.home.name)}`:'';
  const rbi=e.rbi?` · ${e.rbi} RBI`:'';
  const loc=e.zoneName||e.zone||'';

  Sheet.open(`
    <div class="sheet-head">
      <h3>Play Replay</h3>
      <button class="x" onclick="Sheet.close()">×</button>
    </div>
    <div class="sheet-body" style="padding-top:0">
      <div class="replay-meta">
        <div class="replay-inning">${ord(e.i)} · ${e.half==='top'?'Top':'Bottom'}</div>
        <div class="replay-play"><b>${esc(e.batter||'')}</b> — ${esc(e.label)}${loc?` to ${esc(loc)}`:''}${rbi}</div>
        ${scoreLine?`<div class="replay-score">${scoreLine}</div>`:''}
      </div>
      <div class="replay-fieldwrap">${Field.replayField(e)}</div>
      <div class="replay-legend">
        <span><i style="background:#ffc94d"></i>Ball flight</span>
        <span><i style="background:#3ddc84"></i>Batter</span>
        <span><i style="background:#4d9fff"></i>Runner</span>
      </div>
      <div class="replay-nav">
        <button ${prevIdx==null?'disabled':''} onclick="openReplay(${prevIdx})">‹ Prev</button>
        <span class="replay-count">${pos+1} / ${idxs.length}</span>
        <button ${nextIdx==null?'disabled':''} onclick="openReplay(${nextIdx})">Next ›</button>
      </div>
    </div>`);
}

function armPlay(action, label){
  const g=Store.get().game;
  if(!g||g.final) return;
  // map default batted-ball type
  const bbType = action==='groundout' ? 'ground'
               : action==='flyout' ? 'fly'
               : (action==='homer' ? 'fly' : null);
  pendingPlay = {action, label, bbType};
  render();
  navigator.vibrate && navigator.vibrate(6);
}
function cancelPlay(){ pendingPlay=null; render(); }

// preview marker shown while arming (none yet until they tap)
function currentPlayMarkers(){ return []; }

// tap on the field while armed -> compute zone, commit play with location
function onFieldTap(evt, svg){
  if(!pendingPlay) return;
  const pt=svgPoint(evt, svg);
  if(!pt) return;
  const zone=Field.zoneFor(pt.x, pt.y);
  commitPlay({x:+pt.x.toFixed(1), y:+pt.y.toFixed(1), zone:zone.code, zoneName:zone.name,
              area:zone.area, bbType:pendingPlay.bbType});
}
// convert a click/touch on the SVG into 0..100 field coords
function svgPoint(evt, svg){
  const rect=svg.getBoundingClientRect();
  const cx=(evt.touches?evt.touches[0].clientX:evt.clientX);
  const cy=(evt.touches?evt.touches[0].clientY:evt.clientY);
  if(cx==null) return null;
  // viewBox is 0..100 with xMidYMid meet; rect is square-ish — map directly
  const x=((cx-rect.left)/rect.width)*100;
  const y=((cy-rect.top)/rect.height)*100;
  return {x:Math.max(0,Math.min(100,x)), y:Math.max(0,Math.min(100,y))};
}

function commitPlay(location){
  const pp=pendingPlay; if(!pp){ return; }
  pendingPlay=null;
  const g=Store.get().game;
  const basesBefore = g ? g.bases.slice() : [null,null,null];
  const isHit = ['single','double','triple','homer'].includes(pp.action);
  const meta={};
  if(location){
    meta.hx=location.x; meta.hy=location.y;
    meta.zone=location.zone; meta.zoneName=location.zoneName;
    if(location.bbType) meta.bbType=location.bbType;
  } else if(pp.bbType){ meta.bbType=pp.bbType; }
  act(pp.action, meta);          // fires the engine action (auto-advances runners)
  if(location){
    const z=location.zoneName||location.zone;
    toast(`${pp.label} · ${z}`);
  }
  // smart suggestion: if there were runners on before a hit, the engine
  // auto-advanced them by the standard amount — surface that the scorekeeper
  // can drag any runner to adjust (extra base taken, held up, thrown out).
  if(isHit && basesBefore.some(b=>b)){
    showPlaySuggestion(pp.label);
  }
}
function showPlaySuggestion(label){
  smartSuggestion = `Runners auto-advanced on the ${label.toLowerCase()}. Drag any runner to adjust.`;
  render();
  // auto-clear after a few seconds
  clearTimeout(window._suggTimer);
  window._suggTimer=setTimeout(()=>{ smartSuggestion=null; render(); }, 5000);
}

/* ---- Runner interaction: tap a base to manage that runner ---- */
function onBaseTap(baseIdx, evt){
  if(evt) evt.stopPropagation();
  if(pendingPlay) return;        // field is in hit-location mode
  const g=Store.get().game; if(!g||g.final) return;
  if(g.bases[baseIdx]==null) return;  // empty base, nothing to do
  const who=g.bases[baseIdx];
  const baseName=['1st','2nd','3rd'][baseIdx];
  Sheet.open(`
    <div class="sheet-head"><h3>Runner on ${baseName}</h3><button class="x" onclick="Sheet.close()">×</button></div>
    <div class="sheet-body">
      <div style="font-weight:700;font-size:16px;margin:2px 0 14px">${esc(Engine.runnerName(who))}</div>
      <div class="choice" style="grid-template-columns:1fr">
        <button onclick="runnerAdvance(${baseIdx},1)">Advance one base${baseIdx===2?' · SCORE':''}</button>
        ${baseIdx<2?`<button onclick="runnerAdvance(${baseIdx},${3-baseIdx})">Send home · SCORE</button>`:''}
        <button onclick="runnerSteal(${baseIdx})">Stolen base</button>
        <button style="color:var(--out)" onclick="runnerOut(${baseIdx})">Out on bases</button>
      </div>
    </div>`);
}
/* ============================================================
   RUNNER DRAG & DROP
   Runners are HTML pucks layered over the SVG diamond. Press-hold
   and drag to a base; release triggers a Safe/Out/Error/FC prompt.
   ============================================================ */
const DRAG_BASES = { 0:[68,68], 1:[50,58], 2:[32,68], 3:[50,86] }; // 3 = home
const DRAG_BASE_NAMES = {0:'1st',1:'2nd',2:'3rd',3:'home'};

function runnerOverlay(g){
  let pucks='';
  [0,1,2].forEach(i=>{
    if(g.bases[i]==null) return;
    const [x,y]=DRAG_BASES[i];
    const who=g.bases[i];
    pucks+=`<div class="runner-puck" data-base="${i}"
      style="left:${x}%;top:${y}%"
      onpointerdown="startRunnerDrag(event,${i})">
      <span class="puck-label">${esc(Crest.initials(Engine.runnerName(who)))}</span>
    </div>`;
  });
  let zones='';
  [0,1,2,3].forEach(i=>{
    const [x,y]=DRAG_BASES[i];
    zones+=`<div class="drop-zone" data-zone="${i}" style="left:${x}%;top:${y}%"></div>`;
  });
  return `<div class="runner-layer" id="runnerLayer">${zones}${pucks}</div>`;
}

let dragRunner=null;
function startRunnerDrag(evt, fromBase){
  evt.preventDefault(); evt.stopPropagation();
  const g=Store.get().game; if(!g||g.final) return;
  const puck=evt.currentTarget;
  const layer=document.getElementById('runnerLayer');
  if(!layer) return;
  dragRunner={fromBase, who:g.bases[fromBase], puckEl:puck, layerEl:layer, moved:false};
  puck.classList.add('dragging');
  try{ puck.setPointerCapture(evt.pointerId); }catch(e){}
  navigator.vibrate && navigator.vibrate(8);
  layer.classList.add('dragging-active');

  const rect=layer.getBoundingClientRect();
  const move=e=>{
    const px=((e.clientX-rect.left)/rect.width)*100;
    const py=((e.clientY-rect.top)/rect.height)*100;
    dragRunner.moved=true;
    puck.style.left=px+'%'; puck.style.top=py+'%';
    const near=nearestBase(px,py);
    [...layer.querySelectorAll('.drop-zone')].forEach(z=>{
      z.classList.toggle('hot', +z.dataset.zone===near && near!==dragRunner.fromBase);
    });
  };
  const up=e=>{
    puck.removeEventListener('pointermove',move);
    puck.removeEventListener('pointerup',up);
    puck.removeEventListener('pointercancel',up);
    layer.classList.remove('dragging-active');
    puck.classList.remove('dragging');
    const px=((e.clientX-rect.left)/rect.width)*100;
    const py=((e.clientY-rect.top)/rect.height)*100;
    const target=nearestBase(px,py);
    const dr=dragRunner; dragRunner=null;
    if(!dr.moved || target===dr.fromBase || target==null){
      render();
      if(!dr.moved) onBaseTap(dr.fromBase);
      return;
    }
    promptRunnerOutcome(dr.fromBase, target);
  };
  puck.addEventListener('pointermove',move);
  puck.addEventListener('pointerup',up);
  puck.addEventListener('pointercancel',up);
}
function nearestBase(px,py){
  let best=null, bd=Infinity;
  [0,1,2,3].forEach(i=>{
    const [x,y]=DRAG_BASES[i];
    const d=Math.hypot(px-x,py-y);
    if(d<bd){ bd=d; best=i; }
  });
  return bd<16 ? best : null;
}
function promptRunnerOutcome(fromBase, toBase){
  const g=Store.get().game; if(!g){ render(); return; }
  const who=g.bases[fromBase];
  const dest=DRAG_BASE_NAMES[toBase];
  const scoring = toBase===3;
  Sheet.open(`
    <div class="sheet-head"><h3>${esc(Engine.runnerName(who))} → ${dest}</h3><button class="x" onclick="cancelRunnerDrop()">×</button></div>
    <div class="sheet-body">
      <p style="color:var(--ink-dim);font-size:13px;margin:0 0 14px">How did the play end?</p>
      <div class="outcome-grid">
        <button class="oc safe" onclick="resolveRunner(${fromBase},${toBase},'safe')">
          <span class="oc-ic">✓</span>SAFE${scoring?'<small>scores</small>':`<small>to ${dest}</small>`}</button>
        <button class="oc out" onclick="resolveRunner(${fromBase},${toBase},'out')">
          <span class="oc-ic">✕</span>OUT<small>tagged / forced</small></button>
        <button class="oc err" onclick="resolveRunner(${fromBase},${toBase},'error')">
          <span class="oc-ic">E</span>ERROR<small>advances on error</small></button>
        <button class="oc fc" onclick="resolveRunner(${fromBase},${toBase},'fc')">
          <span class="oc-ic">FC</span>FIELDER'S<small>fielder's choice</small></button>
      </div>
      <button class="cta ghost" onclick="cancelRunnerDrop()">Cancel</button>
    </div>`);
}
function cancelRunnerDrop(){ Sheet.close(); render(); }
function resolveRunner(fromBase, toBase, outcome){
  Sheet.close();
  withUndo(g=>{
    const who=g.bases[fromBase];
    g.bases[fromBase]=null;
    const dest=DRAG_BASE_NAMES[toBase];
    if(outcome==='out'){
      g.outs++;
      g.events.push({type:'out',label:`${Engine.runnerName(who)} out at ${dest}`,i:g.inning,half:g.half,ts:Date.now()});
      if(g.outs>=3){ Engine.endHalfPublic(g); }
    } else {
      if(toBase>=3){ addRunUI(g); }
      else { g.bases[toBase]=who; }
      if(outcome==='error') g.totals[g.half==='top'?'home':'away'].e++;
      const tag = outcome==='error'?' (error)' : outcome==='fc'?' (FC)' : '';
      const e={type:toBase>=3?'run':'adv',
        label:`${Engine.runnerName(who)} ${toBase>=3?'scores':'to '+dest}${tag}`,
        i:g.inning,half:g.half,ts:Date.now(),rbi:0};
      if(toBase>=3) e.scored=Engine.scoredInfo([who]);  // attribute the run scored
      g.events.push(e);
    }
  });
  const verb = outcome==='out'?'Out recorded':(toBase>=3?'Run scored':'Runner advanced');
  toast(verb);
}

function runnerAdvance(baseIdx, n){
  Sheet.close();
  withUndo(g=>{
    let runs=0;
    let idx=baseIdx;
    const who=g.bases[idx];
    g.bases[idx]=null;
    const dest=idx+n;
    if(dest>=3){ runs++; addRunUI(g); }
    else g.bases[dest]=who;
    const e={type:'adv',label:`Runner to ${['1st','2nd','3rd','home'][Math.min(dest,3)]}`,
      i:g.inning,half:g.half,ts:Date.now(),rbi:0};
    if(dest>=3) e.scored=Engine.scoredInfo([who]);  // attribute the run scored
    g.events.push(e);
  });
  toast('Runner advanced');
}
function runnerSteal(baseIdx){
  Sheet.close();
  withUndo(g=>{
    const who=g.bases[baseIdx];
    if(baseIdx===2){ g.bases[2]=null; addRunUI(g); }
    else { g.bases[baseIdx+1]=who; g.bases[baseIdx]=null; }
    const e={type:'sb',label:'Stolen Base',i:g.inning,half:g.half,ts:Date.now()};
    if(baseIdx===2) e.scored=Engine.scoredInfo([who]);  // steal of home scores
    g.events.push(e);
  });
  toast('Stolen base');
}
function runnerOut(baseIdx){
  Sheet.close();
  withUndo(g=>{
    g.bases[baseIdx]=null;
    g.outs++;
    g.events.push({type:'out',label:'Out on bases',i:g.inning,half:g.half,ts:Date.now()});
    if(g.outs>=3){ Engine.endHalfPublic(g); }
  });
  toast('Out recorded');
}
// helper: run a base mutation with an undo snapshot + commit + fx
function withUndo(fn){
  const g=Store.get().game; if(!g||g.final) return;
  if(blockedByRole()) return;
  if(!g._undo) g._undo=[];
  const runsBefore=g.totals.away.r+g.totals.home.r;
  g._undo.push(JSON.stringify({inning:g.inning,half:g.half,outs:g.outs,balls:g.balls,
    strikes:g.strikes,bases:g.bases,battingIndex:g.battingIndex,line:g.line,totals:g.totals,
    eventsLen:g.events.length}));
  if(g._undo.length>40) g._undo.shift();
  fn(g);
  const runsAfter=g.totals.away.r+g.totals.home.r;
  Store.commit();
  if(runsAfter>runsBefore) fxScorePop();
}
// add a run to the batting team (UI-side, mirrors engine addRun)
function addRunUI(g){
  const t=g.half==='top'?'away':'home';
  const arr=g.line[t]; while(arr.length<g.inning) arr.push(0);
  arr[g.inning-1]++; g.totals[t].r++;
}

/* ---- scoring animations ---- */
function fxScorePop(){
  const el=document.querySelector('.team-score.win')||document.querySelectorAll('.team-score');
  // re-find after render in next frame
  requestAnimationFrame(()=>{
    document.querySelectorAll('.team-score').forEach(s=>{
      s.classList.remove('bump'); void s.offsetWidth; s.classList.add('bump');
    });
  });
}
function fxHomeRun(){
  const host=document.createElement('div');
  host.className='fx-overlay';
  host.innerHTML=`<div class="fx-hr">💥 HOMER!</div>`;
  document.body.appendChild(host);
  setTimeout(()=>host.remove(),1500);
  fxScorePop();
}
// floating "+N RUN" celebration pill for any scoring play
function fxRuns(n){
  if(!(n>0)) return;
  const host=document.createElement('div');
  host.className='fx-overlay';
  host.innerHTML=`<div class="fx-run">+${n} RUN${n>1?'S':''}</div>`;
  document.body.appendChild(host);
  setTimeout(()=>host.remove(),1100);
}

function undo(){
  const g=Store.get().game;
  if(!g||!g._undo||!g._undo.length){ toast('Nothing to undo'); return; }
  const snap=JSON.parse(g._undo.pop());
  Object.assign(g,{inning:snap.inning,half:snap.half,outs:snap.outs,
    balls:snap.balls,strikes:snap.strikes,bases:snap.bases,
    battingIndex:snap.battingIndex,line:snap.line,totals:snap.totals});
  g.events.length=snap.eventsLen;
  Store.commit(); toast('Undone');
}

function finishGame(){
  if(blockedByRole()) return;
  const g=Store.get().game;
  Sheet.open(`
    <div class="sheet-head"><h3>End Game?</h3><button class="x" onclick="Sheet.close()">×</button></div>
    <div class="sheet-body">
      <p style="color:var(--ink-dim);font-size:14px;line-height:1.5">
        Final: <b>${g.away.name} ${g.totals.away.r}</b> — <b>${g.home.name} ${g.totals.home.r}</b>.
        This saves the game to your scorebook archive and starts a fresh slate.</p>
      <button class="cta" onclick="confirmFinish()">End &amp; Save Game</button>
      <button class="cta ghost" onclick="Sheet.close()">Keep Playing</button>
    </div>`);
}
function confirmFinish(){
  const s=Store.get(); s.game.final=true; delete s.game._undo;
  const g=s.game;
  s.history.unshift(g); s.game=null;
  Store.commit(); Sheet.close();
  // offer MVP selection (only meaningful if players are attributed)
  const hasPlayers = g.events.some(e=>e.batterId);
  if(hasPlayers){ openMvpPicker(g.id); }
  else { setView('score'); toast('Game saved to scorebook'); }
}

/* ============================================================
   GAME MVP
   ============================================================ */
// suggest the best performer in a game using the same composite as season MVP
function suggestGameMvp(g){
  const box=Stats.gameBox(g);
  let best=null,bestScore=-1;
  ['away','home'].forEach(side=>{
    box.sides[side].batters.forEach(p=>{
      const b=p.line;
      const score=(b.h*1.5)+(b.tb*1)+(b.rbi*1.5)+(b.hr*2)+(b.bb*0.5);
      if(score>bestScore){ bestScore=score; best=p; }
    });
  });
  return best;
}
function openMvpPicker(gameId){
  const g=findGameById(gameId);
  if(!g){ setView('score'); return; }
  const box=Stats.gameBox(g);
  const all=[...box.sides.away.batters, ...box.sides.home.batters];
  const suggested=suggestGameMvp(g);
  Sheet.open(`
    <div class="sheet-head"><h3>Game MVP</h3><button class="x" onclick="skipMvp()">×</button></div>
    <div class="sheet-body">
      <p style="color:var(--ink-dim);font-size:13px;line-height:1.5;margin:2px 0 12px">
        Pick the standout performer. We've suggested the top line — tap any player to choose.</p>
      ${all.length?all.map(p=>{
        const b=p.line; const sel=suggested&&p.id===suggested.id;
        const r=Stats.resolve(p.id);
        const color=r?r.team.color:'#ff6b35';
        return `<div class="mvp-pick ${sel?'suggested':''}" onclick="setGameMvp('${gameId}','${p.id}')">
          <span class="avatar" style="width:42px;height:42px">${Crest.player(p.name,p.num,color,false)}</span>
          <div class="mvp-pick-info">
            <div class="mvp-pick-name">${esc(p.name)}${sel?' <span class="mvp-tag">SUGGESTED</span>':''}</div>
            <div class="mvp-pick-line">${mvpStatLine(b)}</div>
          </div>
        </div>`;
      }).join(''):`<div class="empty-sm">No attributed players in this game.</div>`}
      <button class="cta ghost" onclick="skipMvp()">Skip — no MVP</button>
    </div>`);
}
function mvpStatLine(b){
  const parts=[];
  parts.push(`${b.h}-${b.ab}`);
  if(b.b2) parts.push(`${b.b2} 2B`);
  if(b.b3) parts.push(`${b.b3} 3B`);
  if(b.hr) parts.push(`${b.hr} HR`);
  if(b.rbi) parts.push(`${b.rbi} RBI`);
  if(b.bb) parts.push(`${b.bb} BB`);
  return parts.join(' · ');
}
function setGameMvp(gameId, playerId){
  const g=findGameById(gameId);
  if(!g) return;
  g.mvpId=playerId;
  g.mvpSummary=generateMvpSummary(g, playerId);   // instant deterministic write-up
  g.mvpSummaryAI=false;
  Store.commit(); Sheet.close();
  setView('score');
  const r=Stats.resolve(playerId);
  toast(`MVP: ${r?r.player.name:'selected'}`);
  if(AI.isConfigured()) enhanceMvpSummary(gameId, playerId);  // upgrade async if a key is set
}
// Build the fact context an AI write-up needs from the box score.
function aiMvpContext(g, playerId){
  const box=Stats.gameBox(g);
  const all=[...box.sides.away.batters, ...box.sides.home.batters];
  const p=all.find(x=>x.id===playerId); if(!p) return null;
  const r=Stats.resolve(playerId);
  const onAway=box.sides.away.batters.some(x=>x.id===playerId);
  const myRuns=onAway?g.totals.away.r:g.totals.home.r;
  const oppRuns=onAway?g.totals.home.r:g.totals.away.r;
  return {
    name:p.name, num:p.num, team:r?r.team.name:'their team',
    opponent:onAway?g.home.name:g.away.name,
    statLine:mvpStatLine(p.line),
    won:myRuns>oppRuns, tie:myRuns===oppRuns, myRuns, oppRuns,
  };
}
// Replace the templated MVP blurb with a real Claude write-up; on any
// failure the deterministic template already in place simply stays.
async function enhanceMvpSummary(gameId, playerId){
  const g=findGameById(gameId); if(!g) return;
  const ctx=aiMvpContext(g, playerId); if(!ctx) return;
  g._mvpGenerating=true; render();                  // transient; not committed yet
  let text=null;
  try{ text=await AI.mvpSummary(ctx); }
  catch(e){ console.warn('AI MVP write-up failed; keeping template',e); }
  const cur=findGameById(gameId); if(!cur) return;  // game may have changed during the await
  cur._mvpGenerating=false;                          // clear before the single commit
  if(text && cur.mvpId===playerId){ cur.mvpSummary=text; cur.mvpSummaryAI=true; }
  Store.commit(); render();
}
function regenerateMvpSummary(gameId){
  const g=findGameById(gameId); if(!g||!g.mvpId) return;
  if(!AI.isConfigured()){ openAiSheet(); return; }
  enhanceMvpSummary(gameId, g.mvpId);
}

/* ---- AI game recap (box score) ---- */
function aiRecapContext(g){
  const box=Stats.gameBox(g);
  const top=[...box.sides.away.batters, ...box.sides.home.batters]
    .filter(b=>b.line.h||b.line.rbi||b.line.hr)
    .sort((a,b)=>(b.line.h+b.line.rbi+b.line.hr*2)-(a.line.h+a.line.rbi+a.line.hr*2))
    .slice(0,3)
    .map(b=>`${b.name} ${b.line.h}-${b.line.ab}${b.line.hr?`, ${b.line.hr} HR`:''}${b.line.rbi?`, ${b.line.rbi} RBI`:''}`);
  return { away:g.away.name, home:g.home.name,
           awayRuns:g.totals.away.r, homeRuns:g.totals.home.r,
           standouts: top.join('; ') };
}
async function enhanceGameRecap(gameId){
  const g=findGameById(gameId); if(!g) return;
  if(!AI.isConfigured()){ openAiSheet(); return; }
  g._recapGenerating=true; render();
  let text=null;
  try{ text=await AI.gameRecap(aiRecapContext(g)); }
  catch(e){ console.warn('AI recap failed',e); toast('Recap failed — check AI settings'); }
  const cur=findGameById(gameId); if(!cur) return;
  cur._recapGenerating=false;
  if(text){ cur.recap=text; cur.recapAI=true; }
  Store.commit(); render();
}
// Recap card shown in the box score: the generated recap (if any) + a
// generate/regenerate button when AI is configured.
function recapBlock(g){
  const has=!!g.recap;
  const gen=g._recapGenerating;
  if(!has && !AI.isConfigured() && !gen) return '';   // nothing to show, no AI
  const body = gen
    ? `<div class="mvp-card-summary gen"><span class="ai-dots"><i></i><i></i><i></i></span> Writing the recap…</div>`
    : (has?`<div class="recap-text">${esc(g.recap)}${g.recapAI?`<span class="ai-badge" title="Written by Claude">✨ AI</span>`:''}</div>`:'');
  const btn = (AI.isConfigured() && !gen)
    ? `<button class="ai-regen" onclick="enhanceGameRecap('${g.id}')">✨ ${has?'Regenerate recap':'Write game recap'}</button>`
    : '';
  if(!body && !btn) return '';
  return `<div class="recap-card">${body}${btn}</div>`;
}
function skipMvp(){ Sheet.close(); setView('score'); toast('Game saved'); }
function findGameById(id){
  const s=Store.get();
  if(s.game&&s.game.id===id) return s.game;
  return s.history.find(g=>g.id===id);
}

// Template-based MVP write-up (swappable for a real LLM call in the cloud phase)
function generateMvpSummary(g, playerId){
  const box=Stats.gameBox(g);
  const all=[...box.sides.away.batters, ...box.sides.home.batters];
  const p=all.find(x=>x.id===playerId);
  if(!p) return '';
  const b=p.line;
  const r=Stats.resolve(playerId);
  const teamName=r?r.team.name:'their team';
  // figure out which side they're on + result
  const onAway=box.sides.away.batters.some(x=>x.id===playerId);
  const myRuns=onAway?g.totals.away.r:g.totals.home.r;
  const oppRuns=onAway?g.totals.home.r:g.totals.away.r;
  const won=myRuns>oppRuns;
  const oppName=onAway?g.home.name:g.away.name;

  // build the stat phrase
  const bits=[];
  const xbh=[];
  if(b.hr) xbh.push(`${b.hr} home run${b.hr>1?'s':''}`);
  if(b.b3) xbh.push(`${b.b3} triple${b.b3>1?'s':''}`);
  if(b.b2) xbh.push(`${b.b2} double${b.b2>1?'s':''}`);
  // lead with the slash line, optionally appending extra-base hits with "including"
  let lead=`going ${b.h}-for-${b.ab}`;
  if(xbh.length) lead+=` with ${joinList(xbh)}`;
  bits.push(lead);
  if(b.rbi) bits.push(`${b.rbi} RBI`);
  const statPhrase=joinList(bits);

  return `${p.name} earned Game MVP honors after ${statPhrase}, ${won?`helping lead ${teamName} to a ${myRuns}-${oppRuns} victory over ${oppName}.`:`in ${teamName}'s ${myRuns}-${oppRuns} contest against ${oppName}.`}`;
}
function joinList(arr){
  if(arr.length<=1) return arr.join('');
  if(arr.length===2) return arr.join(' and ');
  return arr.slice(0,-1).join(', ')+', and '+arr[arr.length-1];
}

// reusable MVP card for a finished game (shown on game review, etc.)
function mvpCardHTML(g){
  if(!g.mvpId) return '';
  const box=Stats.gameBox(g);
  const all=[...box.sides.away.batters, ...box.sides.home.batters];
  const p=all.find(x=>x.id===g.mvpId);
  const r=Stats.resolve(g.mvpId);
  const color=r?r.team.color:'#ff6b35';
  const name=r?r.player.name:(p?p.name:'MVP');
  const num=r?r.player.num:(p?p.num:'');
  const statLine=p?mvpStatLine(p.line):'';
  const aiBadge=g.mvpSummaryAI?`<span class="ai-badge" title="Written by Claude">✨ AI</span>`:'';
  const summary = g._mvpGenerating
    ? `<div class="mvp-card-summary gen"><span class="ai-dots"><i></i><i></i><i></i></span> Writing the recap…</div>`
    : (g.mvpSummary?`<div class="mvp-card-summary">${esc(g.mvpSummary)}${aiBadge}</div>`:'');
  const regen = (AI.isConfigured() && !g._mvpGenerating)
    ? `<button class="ai-regen" onclick="event.stopPropagation();regenerateMvpSummary('${g.id}')" title="Regenerate with Claude">✨ ${g.mvpSummaryAI?'Regenerate':'Write with AI'}</button>`
    : '';
  return `<div class="mvp-card">
    <span class="avatar">${Crest.player(name,num,color,false)}</span>
    <div class="mvp-card-body">
      <div class="mvp-card-tag">🏆 Game MVP</div>
      <div class="mvp-card-name">${esc(name)}</div>
      ${statLine?`<div class="mvp-card-stats">${statLine}</div>`:''}
      ${summary}
      ${regen}
    </div>
  </div>`;
}

/* ---- new game setup ---- */
function teamSelectOptions(selected){
  const teams=Store.get().teams;
  return `<option value="">— Manual entry —</option>` +
    teams.map(t=>`<option value="${t.id}" ${selected===t.id?'selected':''}>${esc(t.name)} (${t.players.length})</option>`).join('');
}
function openSetup(){
  const hasTeams=Store.get().teams.length>0;
  Sheet.open(`
    <div class="sheet-head"><h3>New Game</h3><button class="x" onclick="Sheet.close()">×</button></div>
    <div class="sheet-body">
      ${hasTeams?`
      <label class="fld"><span>AWAY — PICK TEAM</span>
        <select class="in" id="awayTeam" onchange="onTeamPick('away')">${teamSelectOptions()}</select></label>
      <div id="awayLineupWrap"></div>`:''}
      <label class="fld"><span>AWAY TEAM NAME</span>
        <input class="in" id="awayName" placeholder="Visitors" value="Away"></label>

      ${hasTeams?`
      <label class="fld"><span>HOME — PICK TEAM</span>
        <select class="in" id="homeTeam" onchange="onTeamPick('home')">${teamSelectOptions()}</select></label>
      <div id="homeLineupWrap"></div>`:''}
      <label class="fld"><span>HOME TEAM NAME</span>
        <input class="in" id="homeName" placeholder="Home" value="Home"></label>

      <label class="fld"><span>INNINGS</span>
        <select class="in" id="innings">
          <option>3</option><option>5</option><option selected>7</option><option>9</option>
        </select></label>
      <label class="fld"><span>RULES</span>
        <select class="in" id="rulePreset" onchange="onRulePreset()">
          ${Object.entries(Engine.RULE_PRESETS).map(([k,v])=>`<option value="${k}" ${k==='standard'?'selected':''}>${v.label}</option>`).join('')}
        </select></label>
      <div id="ruleSummary" class="rule-summary">${ruleSummaryText('standard')}</div>
      <label class="fld"><span>AWAY LINEUP — one name per line (optional)</span>
        <textarea class="in" id="awayRoster" rows="2" placeholder="12 Andrew B&#10;7 Chase&#10;23 Max"></textarea></label>
      <label class="fld"><span>HOME LINEUP — one name per line (optional)</span>
        <textarea class="in" id="homeRoster" rows="2" placeholder="One name per line"></textarea></label>
      <button class="cta" onclick="startGame()">Play Ball</button>
    </div>`);
}
function onRulePreset(){
  const k=document.getElementById('rulePreset').value;
  const el=document.getElementById('ruleSummary');
  if(el) el.innerHTML=ruleSummaryText(k);
}
function ruleSummaryText(presetKey){
  const p=Engine.RULE_PRESETS[presetKey]; if(!p) return '';
  const r=Object.assign(Engine.defaultRules(), p.rules);
  const bits=[];
  bits.push(r.runLimitPerInning>0 ? `${r.runLimitPerInning}-run cap/inning${r.openFinalInning?' (open final)':''}` : 'No run limit');
  if(r.mercyEnabled && r.mercyRuns>0) bits.push(`Mercy: ${r.mercyRuns} after inn ${r.mercyAfterInning}`);
  if(r.coedRequired) bits.push('Co-ed required');
  if(r.courtesyRunners) bits.push('Courtesy runners');
  return bits.map(b=>`<span class="rule-chip">${esc(b)}</span>`).join('');
}
// when a saved team is chosen, fill the name + offer its lineups
function onTeamPick(side){
  const tid=document.getElementById(side+'Team').value;
  const wrap=document.getElementById(side+'LineupWrap');
  const nameInput=document.getElementById(side+'Name');
  const rosterInput=document.getElementById(side+'Roster');
  if(!tid){ wrap.innerHTML=''; return; }
  const t=Teams.byId(tid);
  nameInput.value=t.name;
  const lus=Store.get().lineups.filter(l=>l.teamId===tid);
  wrap.innerHTML=`<label class="fld"><span>${side.toUpperCase()} LINEUP</span>
    <select class="in" id="${side}LineupSel" onchange="applyLineup('${side}','${tid}')">
      <option value="__full">Full roster (batting order)</option>
      ${lus.map(l=>`<option value="${l.id}">${esc(l.name)} (${l.order.length})</option>`).join('')}
    </select></label>`;
  applyLineup(side,tid);
}
function applyLineup(side,tid){
  const t=Teams.byId(tid);
  const sel=document.getElementById(side+'LineupSel');
  const rosterInput=document.getElementById(side+'Roster');
  let players;
  if(sel && sel.value!=='__full'){
    const l=Store.get().lineups.find(x=>x.id===sel.value);
    players=l.order.map(id=>Teams.playerById(t,id)).filter(Boolean);
  } else {
    players=[...t.players].filter(p=>p.pos!=='BN');
  }
  rosterInput.value=players.map(p=>`${p.num?p.num+' ':''}${p.name}`).join('\n');
}
function startGame(){
  if(blockedByRole()) return;
  const awayTid=(document.getElementById('awayTeam')||{}).value||'';
  const homeTid=(document.getElementById('homeTeam')||{}).value||'';
  // Resolve rosters WITH player ids when a saved team is selected,
  // so every at-bat can be attributed to a real player profile.
  const awayRoster=resolveRoster('away',awayTid);
  const homeRoster=resolveRoster('home',homeTid);
  const cfg={
    away:document.getElementById('awayName').value.trim()||'Away',
    home:document.getElementById('homeName').value.trim()||'Home',
    innings:parseInt(document.getElementById('innings').value,10),
    awayRoster, homeRoster,
    awayTeamId:awayTid||null, homeTeamId:homeTid||null,
    // default pitcher = whoever is listed at P, else first batter
    awayPitcherId:pickPitcher(awayRoster), homePitcherId:pickPitcher(homeRoster),
    seasonId:Store.get().currentSeasonId||null,
    rules:(Engine.RULE_PRESETS[(document.getElementById('rulePreset')||{}).value]||{}).rules||null,
  };
  Store.get().game = Engine.newGame(cfg);
  Store.commit(); Sheet.close(); setView('score');
}
// show the active ruleset for the live game
function openRulesInfo(){
  const g=Store.get().game; if(!g) return;
  const r=g.rules||Engine.defaultRules();
  const preset=Engine.RULE_PRESETS[r.preset];
  const row=(label,val)=>`<div class="ri-row"><span>${esc(label)}</span><b>${esc(val)}</b></div>`;
  Sheet.open(`
    <div class="sheet-head"><h3>Game Rules</h3><button class="x" onclick="Sheet.close()">×</button></div>
    <div class="sheet-body">
      <div class="ri-preset">${preset?esc(preset.label):'Custom'}</div>
      ${row('Run limit / inning', r.runLimitPerInning>0?`${r.runLimitPerInning} runs`:'None')}
      ${r.runLimitPerInning>0?row('Final inning', r.openFinalInning?'Open (uncapped)':'Capped'):''}
      ${row('Mercy rule', r.mercyEnabled&&r.mercyRuns?`${r.mercyRuns} runs after inning ${r.mercyAfterInning}`:'Off')}
      ${row('Co-ed required', r.coedRequired?'Yes':'No')}
      ${row('Courtesy runners', r.courtesyRunners?'Allowed':'No')}
      ${r.maxArc?row('Pitch arc (max)', r.maxArc+' ft'):''}
      <div class="rsvp-note" style="padding:14px 4px 4px">Co-ed, courtesy-runner, and pitch-arc rules are tracked for reference. Run caps and mercy are enforced automatically during scoring.</div>
    </div>`);
}
// Build the batting roster. If a saved team is chosen, map back to real
// player records (keeping ids + positions). Otherwise parse the text box.
function resolveRoster(side,tid){
  if(tid){
    const t=Teams.byId(tid);
    const sel=document.getElementById(side+'LineupSel');
    let players;
    if(sel && sel.value!=='__full'){
      const l=Store.get().lineups.find(x=>x.id===sel.value);
      players=l?l.order.map(id=>Teams.playerById(t,id)).filter(Boolean):[];
    } else {
      players=[...t.players].filter(p=>p.pos!=='BN');
    }
    if(players.length) return players.map(p=>({id:p.id,num:p.num,name:p.name,pos:p.pos}));
  }
  return parseRoster(document.getElementById(side+'Roster').value);
}
function pickPitcher(roster){
  const p=roster.find(x=>x.pos==='P');
  return (p&&p.id)||null;
}
function parseRoster(txt){
  return (txt||'').split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{
    const m=l.match(/^(\d+)\s+(.*)$/);
    return m?{num:m[1],name:m[2]}:{num:'',name:l};
  });
}

/* ---- renderers ---- */
function diamondSVG(bases){
  const on=i=>bases[i]!=null?'on':'';
  return `<svg viewBox="0 0 100 100">
    <rect class="bag ${on(1)}" x="42" y="6"  width="16" height="16" rx="2" transform="rotate(45 50 14)"/>
    <rect class="bag ${on(2)}" x="78" y="42" width="16" height="16" rx="2" transform="rotate(45 86 50)"/>
    <rect class="bag ${on(0)}" x="6"  y="42" width="16" height="16" rx="2" transform="rotate(45 14 50)"/>
    <rect class="bag"          x="42" y="78" width="16" height="16" rx="2" transform="rotate(45 50 86)"/>
  </svg>`;
}

function renderScore(g){
  const bt = Engine.battingTeam(g);
  const batter = Engine.currentBatter(g);
  const dots=(n,cls,fill)=>Array.from({length:n},(_,i)=>
    `<span class="dot ${cls} ${i<fill?'fill':''}"></span>`).join('');
  const ballDots = dots(3,'',g.balls);
  const strikeDots = dots(2,'',g.strikes);
  const outDots = dots(2,'out',g.outs);
  const aw=g.totals.away.r, hw=g.totals.home.r;
  const batColor=teamColor(g[bt].name);

  return `
  <div class="board">
    <div class="board-row">
      <div class="team-cell away ${g.half==='top'?'batting':''}">
        <div class="tc-line">
          <span class="board-crest">${Crest.team(g.away.name, teamColor(g.away.name), 26)}</span>
          <div class="team-name ${g.half==='top'?'batting':''}">${esc(g.away.name)}</div>
        </div>
        <div class="team-score ${aw>hw?'lead':''}">${aw}</div>
      </div>
      <div class="center-cell">
        <div class="inning"><span class="ord">${g.inning}</span><sup>${ord(g.inning).replace(/\d+/,'')}</sup></div>
        <div class="half"><span class="arrow">${g.half==='top'?'▲':'▼'}</span></div>
      </div>
      <div class="team-cell home ${g.half==='bottom'?'batting':''}">
        <div class="tc-line">
          <span class="board-crest">${Crest.team(g.home.name, teamColor(g.home.name), 26)}</span>
          <div class="team-name ${g.half==='bottom'?'batting':''}">${esc(g.home.name)}</div>
        </div>
        <div class="team-score ${hw>aw?'lead':''}">${hw}</div>
      </div>
    </div>
    <div class="board-pulse"></div>
  </div>

  <div class="fieldwrap ${pendingPlay?'is-armed':''}" id="fieldwrap">
    ${Field.bigDiamond(g,{armed:!!pendingPlay, domRunners:!pendingPlay, markers:currentPlayMarkers()})}
    ${pendingPlay?`<button class="field-cancel" onclick="cancelPlay()">✕ Cancel</button>`:''}
    ${!pendingPlay?runnerOverlay(g):''}
  </div>
  ${!pendingPlay&&smartSuggestion?`<div class="smart-suggestion">💡 ${esc(smartSuggestion)}</div>`
    :(!pendingPlay&&g.bases.some(b=>b)?`<div class="drag-hint">Drag a runner to move them · tap for options</div>`:'')}

  <div class="countbar">
    <div class="cgrp"><div class="clbl">B</div><div class="cdots">${ballDots}</div></div>
    <div class="cgrp"><div class="clbl">S</div><div class="cdots">${strikeDots}</div></div>
    <div class="cgrp"><div class="clbl">O</div><div class="cdots">${outDots}</div></div>
    <div class="cbat">
      <span class="avatar cbat-av">${Crest.player(batter.name, batter.num, batColor, false)}</span>
      <div class="cbat-info">
        <span class="pill">AT BAT</span>
        <span class="who">${esc(batter.name)}${batter.num?` <span class="num">#${batter.num}</span>`:''}</span>
      </div>
    </div>
  </div>

  ${(()=>{ const r=g.rules||{};
    if((r.preset||'standard')==='standard' || (!r.runLimitPerInning && !r.mercyEnabled)) return '';
    const lim=Engine.runLimitFor(g);
    const capInfo = lim>0 ? `Run cap ${g._halfRuns||0}/${lim}` : (r.runLimitPerInning?'Open inning':'');
    const mercyInfo = r.mercyEnabled&&r.mercyRuns?`Mercy ${r.mercyRuns}@${r.mercyAfterInning}`:'';
    return `<div class="rules-bar" onclick="openRulesInfo()">
      <span class="rb-icon">⚙️</span>
      ${capInfo?`<span class="rb-chip ${Engine.runCapReached(g)?'hot':''}">${capInfo}</span>`:''}
      ${mercyInfo?`<span class="rb-chip">${mercyInfo}</span>`:''}
    </div>`; })()}

  ${pendingPlay?`<div class="arm-banner">
      <span class="arm-label">${esc(pendingPlay.label)}</span> — tap the field to mark where it went, or
      <button class="arm-skip" onclick="commitPlay(null)">skip location</button>
    </div>`:''}

  <div class="toolbar">
    <button class="tool undo" onclick="undo()">↶ UNDO</button>
    <button class="tool" onclick="setView('book')">📖 BOOK</button>
    <button class="tool" onclick="openBoxScore()">📋 BOX</button>
    <button class="tool" onclick="finishGame()">⏹ END</button>
  </div>

  <div class="actions scroll">
    <div class="seg">
      <div class="seg-title">PITCH</div>
      <div class="grid g3">
        <button class="btn ball"   onclick="act('ball')">BALL</button>
        <button class="btn strike" onclick="act('strike')">STRIKE</button>
        <button class="btn foul"   onclick="act('foul')">FOUL</button>
      </div>
    </div>
    <div class="seg">
      <div class="seg-title">HIT · tap then mark the field</div>
      <div class="grid g4">
        <button class="btn hit" onclick="armPlay('single','1B Single')">1B<small>SINGLE</small></button>
        <button class="btn hit" onclick="armPlay('double','2B Double')">2B<small>DOUBLE</small></button>
        <button class="btn hit" onclick="armPlay('triple','3B Triple')">3B<small>TRIPLE</small></button>
        <button class="btn hit" onclick="armPlay('homer','Home Run')">HR<small>HOMER</small></button>
      </div>
    </div>
    <div class="seg">
      <div class="seg-title">ON BASE</div>
      <div class="grid g3">
        <button class="btn" onclick="act('walkBtn')">BB<small>WALK</small></button>
        <button class="btn" onclick="act('error')">E<small>ERROR</small></button>
        <button class="btn" onclick="act('stolenBase')">SB<small>STEAL</small></button>
      </div>
    </div>
    <div class="seg">
      <div class="seg-title">OUTS</div>
      <div class="grid g4">
        <button class="btn out" onclick="armPlay('groundout','Ground Out')">GO<small>GROUND</small></button>
        <button class="btn out" onclick="armPlay('flyout','Fly Out')">FO<small>FLY</small></button>
        <button class="btn out" onclick="act('strikeoutBtn')">K<small>STRIKE</small></button>
        <button class="btn out" onclick="act('sacFly')">SF<small>SAC FLY</small></button>
      </div>
      <div class="grid g3">
        <button class="btn out" onclick="act('fieldersChoice')">FC<small>FIELDER'S</small></button>
        <button class="btn out" onclick="act('doublePlay')">DP<small>DOUBLE</small></button>
        <button class="btn out" onclick="act('out')">OUT<small>GENERIC</small></button>
      </div>
    </div>
  </div>`;
}

function renderBook(g){
  replayGameRef = g;   // remember which game the scorebook is showing
  // group events by inning+half, preserving global index
  const groups={};
  g.events.forEach((ev,gi)=>{
    const k=`${ev.i}-${ev.half}`;
    (groups[k]=groups[k]||[]).push({ev,gi});
  });
  let html=`
    <div class="book-head" style="position:sticky;top:0;z-index:5">
      <span class="ttl">Digital Scorebook</span>
      <button class="tool" style="flex:0;padding:0 14px;min-height:36px" onclick="setView('score')">← LIVE</button>
    </div>
    ${lineScore(g)}`;

  const keys=Object.keys(groups).sort((a,b)=>{
    const [ai,ah]=a.split('-'),[bi,bh]=b.split('-');
    return ai-bi || (ah==='top'?-1:1)-(bh==='top'?-1:1);
  });
  if(!keys.length) html+=`<div class="subtle">No plays recorded yet. Head to the live tab and start tapping.</div>`;
  keys.forEach(k=>{
    const [i,half]=k.split('-');
    const evs=groups[k];
    const team = half==='top'?g.away.name:g.home.name;
    html+=`<div class="book-inning">
      <div class="book-head">
        <span class="ttl">${ord(+i)} · ${esc(team)}</span>
      </div>
      ${evs.map((x,idx)=>abRow(x.ev,idx+1,g,x.gi)).join('')}
    </div>`;
  });
  return html;
}

function abRow(e,seq,gameRef,evIndex){
  let cls='', tag='';
  if(e.type==='hit'){ tag=`<span class="tag h">${e.label}</span>`; }
  else if(['k','out','dp','fc','sac'].includes(e.type)){ tag=`<span class="tag o">OUT</span>`; }
  const rbi = e.rbi?` <b>${e.rbi} RBI</b>`:'';
  const score = e.rbi||e.type==='run';
  // a play is "replayable" if it has captured base snapshots
  const replayable = e.basesBefore!=null && (e.hx!=null || hasMovement(e));
  const loc = e.zoneName?`<span class="ab-loc">${e.zoneName}</span>`:(e.zone?`<span class="ab-loc">${e.zone}</span>`:'');
  const tap = replayable && evIndex!=null ? `onclick="openReplay(${evIndex})" style="cursor:pointer"` : '';
  return `<div class="ab ${replayable?'replayable':''}" ${tap}>
    <div class="seq">${seq}</div>
    <div class="body">
      <div class="batter">${esc(e.batter||'—')}${replayable?'<span class="play-icon">▶</span>':''}</div>
      <div class="res ${score?'score':''}"><b>${e.label}</b>${loc}${rbi}${tag}</div>
    </div>
  </div>`;
}
function hasMovement(e){
  if(!e.basesBefore||!e.basesAfter) return false;
  return JSON.stringify(e.basesBefore)!==JSON.stringify(e.basesAfter);
}

function lineScore(g){
  const n=Math.max(g.innings, g.line.away.length, g.line.home.length);
  const cells=arr=>{let s='';for(let i=0;i<n;i++){s+=`<td>${arr[i]!=null?arr[i]:'·'}</td>`;}return s;};
  return `<div class="linescore"><table>
    <tr><th class="tm">&nbsp;</th>${Array.from({length:n},(_,i)=>`<th>${i+1}</th>`).join('')}
      <th class="tot">R</th><th class="tot">H</th><th class="tot">E</th></tr>
    <tr><td class="tm">${esc(g.away.name)}</td>${cells(g.line.away)}
      <td class="tot">${g.totals.away.r}</td><td>${g.totals.away.h}</td><td>${g.totals.away.e}</td></tr>
    <tr><td class="tm">${esc(g.home.name)}</td>${cells(g.line.home)}
      <td class="tot">${g.totals.home.r}</td><td>${g.totals.home.h}</td><td>${g.totals.home.e}</td></tr>
  </table></div>`;
}

/* ============================================================
   STATS / LEADERS HUB
   ============================================================ */
let statsMode = 'bat';  // 'bat' | 'pitch'
let statsSeasonId = null; // null = All-Time (career)

const BAT_CATS = [
  {stat:'avg', label:'Batting Average', short:'AVG', fmt:'rate', opts:{minAB:3}},
  {stat:'hr',  label:'Home Runs',       short:'HR',  fmt:'int'},
  {stat:'rbi', label:'Runs Batted In',  short:'RBI', fmt:'int'},
  {stat:'h',   label:'Hits',            short:'H',   fmt:'int'},
  {stat:'ops', label:'OPS',             short:'OPS', fmt:'rate', opts:{minAB:3}},
  {stat:'obp', label:'On-Base %',       short:'OBP', fmt:'rate', opts:{minAB:3}},
  {stat:'slg', label:'Slugging %',      short:'SLG', fmt:'rate', opts:{minAB:3}},
  {stat:'b2',  label:'Doubles',         short:'2B',  fmt:'int'},
  {stat:'b3',  label:'Triples',         short:'3B',  fmt:'int'},
  {stat:'bb',  label:'Walks',           short:'BB',  fmt:'int'},
  {stat:'sb',  label:'Stolen Bases',    short:'SB',  fmt:'int'},
  {stat:'tb',  label:'Total Bases',     short:'TB',  fmt:'int'},
];
const PITCH_CATS = [
  {stat:'k',    label:'Strikeouts',       short:'K',    fmt:'int'},
  {stat:'era',  label:'Earned Run Avg',   short:'ERA',  fmt:'era',  opts:{minOuts:3}},
  {stat:'whip', label:'WHIP',             short:'WHIP', fmt:'rate2',opts:{minOuts:3}},
  {stat:'ip',   label:'Innings Pitched',  short:'IP',   fmt:'ip'},
  {stat:'h',    label:'Hits Allowed',     short:'H',    fmt:'int'},
  {stat:'bb',   label:'Walks Allowed',    short:'BB',   fmt:'int'},
  {stat:'bf',   label:'Batters Faced',    short:'BF',   fmt:'int'},
];

function fmtStatVal(fmt, v){
  if(fmt==='rate')  return v>=1?v.toFixed(3):('.'+Math.round(v*1000).toString().padStart(3,'0'));
  if(fmt==='rate2') return v.toFixed(2);
  if(fmt==='era')   return v.toFixed(2);
  if(fmt==='ip')    { const whole=Math.floor(v), rem=Math.round((v-whole)*3); return `${whole}.${rem}`; }
  return String(Math.round(v));
}

function renderStats(){
  const seasons = Store.get().seasons||[];
  // season chips: All-Time (career) + each season
  const chip=(id,label)=>`<button class="season-chip ${(!statsSeasonId&&id==null)||statsSeasonId===id?'sel':''}"
    onclick="setStatsSeason(${id==null?'null':`'${id}'`})">${esc(label)}</button>`;
  const seasonBar = seasons.length>1 ? `<div class="season-bar">
      ${chip(null,'All-Time')}
      ${seasons.slice().sort((a,b)=>b.created-a.created).map(s=>chip(s.id,s.name)).join('')}
    </div>` : '';

  const head = `${appbar()}
    <div class="sec" style="padding:8px 18px 4px"><h3>${statsMode==='awards'?'Awards & Records':'League Leaders'}</h3>
      <span class="more" onclick="openSeasonManager()">Seasons</span></div>
    <div class="stats-toggle three">
      <button class="${statsMode==='bat'?'sel':''}" onclick="setStatsMode('bat')">⚾ Batting</button>
      <button class="${statsMode==='pitch'?'sel':''}" onclick="setStatsMode('pitch')">🔥 Pitching</button>
      <button class="${statsMode==='awards'?'sel':''}" onclick="setStatsMode('awards')">🏆 Awards</button>
    </div>
    ${seasonBar}`;

  if(statsMode==='awards') return head + renderAwards();

  const cats = statsMode==='bat'?BAT_CATS:PITCH_CATS;
  const kind = statsMode==='bat'?'bat':'pitch';
  const withSeason = c => Object.assign({}, c.opts||{}, statsSeasonId?{seasonId:statsSeasonId}:{});
  const anyData = cats.some(c=>Stats.leaderTable(kind,c.stat,withSeason(c)).length>0);

  let html = head + `<div class="scroll stagger" style="padding-bottom:24px">`;

  if(!anyData){
    html += `<div class="empty"><div class="glyph">📊</div><h2>No Stats Yet</h2>
      <p>Score a game with saved teams and ${statsMode==='bat'?'batting':'pitching'} leaders will populate automatically.</p></div></div>`;
    return html;
  }

  cats.forEach(c=>{
    const rows = Stats.leaderTable(kind, c.stat, withSeason(c));
    if(!rows.length) return;
    html += leaderboardCard(c, rows);
  });
  html += `</div>`;
  return html;
}

function setStatsMode(m){ statsMode=m; render(); }
function setStatsSeason(id){ statsSeasonId=id; render(); }

function renderAwards(){
  const awards = Awards.seasonAwards(statsSeasonId);
  const records = Awards.teamRecords(statsSeasonId);
  const mvpHist = Awards.mvpHistory(statsSeasonId);
  const scope = statsSeasonId ? '' : ' · All-Time';

  if(!awards.length && !records.length && !mvpHist.length){
    return `<div class="scroll"><div class="empty"><div class="glyph">🏆</div><h2>No Awards Yet</h2>
      <p>Awards and team records unlock automatically as games are scored${statsSeasonId?' this season':''}.</p></div></div>`;
  }

  const trophy = {
    'MVP':'👑','Offensive Player of the Year':'💥','Pitcher of the Year':'🔥',
    'Most Improved':'📈','Defensive Player of the Year':'🧤','Rookie of the Year':'🌟'
  };

  let html = `<div class="scroll stagger" style="padding-bottom:24px">`;

  if(awards.length){
    html += `<div class="sec"><h3>Season Awards${scope}</h3></div>`;
    awards.forEach(a=>{
      html += `<div class="award-card" onclick="openPlayerCard('${a.teamId}','${a.playerId}')">
        <div class="award-glow" style="background:radial-gradient(circle at 30% 0%, ${a.color}44, transparent 70%)"></div>
        <div class="award-trophy">${trophy[a.title]||'🏅'}</div>
        <div class="award-body">
          <div class="award-title">${esc(a.title)}</div>
          <div class="award-name">${esc(a.name)}${a.num?` <span class="award-num">#${a.num}</span>`:''}</div>
          <div class="award-detail">${esc(a.teamName)} · ${esc(a.detail)}</div>
        </div>
        <span class="avatar award-av">${Crest.player(a.name,a.num,a.color,false)}</span>
      </div>`;
    });
  }

  if(records.length){
    html += `<div class="sec"><h3>Team Records${scope}</h3></div>
      <div class="rec-list">`;
    records.forEach(r=>{
      html += `<div class="rec-row">
        <div class="rec-info">
          <div class="rec-label">${esc(r.label)}</div>
          <div class="rec-sub">${esc(r.team)} · ${esc(r.sub)}</div>
        </div>
        <div class="rec-val">${esc(String(r.value))}</div>
      </div>`;
    });
    html += `</div>`;
  }

  const mvps = mvpHist;
  if(mvps.length){
    html += `<div class="sec"><h3>Game MVP Leaders${scope}</h3></div>
      <div class="rec-list">`;
    mvps.forEach((m,i)=>{
      html += `<div class="rec-row" onclick="openPlayerCard('${m.teamId}','${m.playerId}')" style="cursor:pointer">
        <span class="lb-rank" style="${i===0?'color:var(--gold)':''}">${i+1}</span>
        <span class="avatar" style="width:34px;height:34px;flex:0 0 auto">${Crest.player(m.name,m.num,m.color,false)}</span>
        <div class="rec-info">
          <div class="rec-label" style="font-size:14px">${esc(m.name)}</div>
          <div class="rec-sub">${esc(m.teamName)}</div>
        </div>
        <div class="rec-val">${m.total}<span style="font-size:11px;color:var(--ink-dim);font-weight:700"> 🏆</span></div>
      </div>`;
    });
    html += `</div>`;
  }

  html += `<div class="handoff" style="margin-top:8px">Awards recompute live from every scored game</div></div>`;
  return html;
}

function leaderboardCard(cat, rows){
  const top = rows[0];
  const rest = rows.slice(1,5);
  return `<div class="lb-card">
    <div class="lb-head">
      <span class="lb-cat">${cat.label}</span>
      ${rows.length>5?`<span class="lb-more" onclick="openLeaderList('${cat.stat}','${cat.label.replace(/'/g,"")}','${cat.fmt}')">All ${rows.length}</span>`:''}
    </div>
    <div class="lb-leader" onclick="openPlayerCard('${top.teamId}','${top.id}')">
      <span class="lb-rank">1</span>
      <span class="avatar lb-av">${Crest.player(top.name,top.num,top.color,false)}</span>
      <div class="lb-who">
        <div class="lb-name">${esc(top.name)}</div>
        <div class="lb-team">${esc(top.teamName)}</div>
      </div>
      <span class="lb-val">${fmtStatVal(cat.fmt, top.val)}<small>${cat.short}</small></span>
    </div>
    ${rest.length?`<div class="lb-rest">${rest.map((r,i)=>`
      <div class="lb-row" onclick="openPlayerCard('${r.teamId}','${r.id}')">
        <span class="lb-rank">${i+2}</span>
        <span class="lb-rname">${esc(r.name)}</span>
        <span class="lb-rteam">${esc(r.teamName)}</span>
        <span class="lb-rval">${fmtStatVal(cat.fmt, r.val)}</span>
      </div>`).join('')}</div>`:''}
  </div>`;
}

function openLeaderList(stat, label, fmt){
  const kind = statsMode==='bat'?'bat':'pitch';
  const cat = (kind==='bat'?BAT_CATS:PITCH_CATS).find(c=>c.stat===stat);
  const opts = Object.assign({}, cat?cat.opts||{}:{}, statsSeasonId?{seasonId:statsSeasonId}:{});
  const rows = Stats.leaderTable(kind, stat, opts);
  Sheet.open(`
    <div class="sheet-head"><h3>${esc(label)}</h3><button class="x" onclick="Sheet.close()">×</button></div>
    <div class="sheet-body" style="padding:0 0 22px">
      ${rows.map((r,i)=>`
        <div class="lb-row full ${i===0?'gold':''}" onclick="Sheet.close();openPlayerCard('${r.teamId}','${r.id}')">
          <span class="lb-rank">${i+1}</span>
          <span class="avatar" style="width:32px;height:32px">${Crest.player(r.name,r.num,r.color,false)}</span>
          <div style="flex:1;min-width:0">
            <div class="lb-rname">${esc(r.name)}</div>
            <div class="lb-rteam">${esc(r.teamName)}</div>
          </div>
          <span class="lb-rval big">${fmtStatVal(fmt, r.val)}</span>
        </div>`).join('')}
    </div>`);
}

/* ---- Season manager: create/switch the active season for new games ---- */
function openSeasonManager(){
  const s=Store.get();
  const seasons=(s.seasons||[]).slice().sort((a,b)=>b.created-a.created);
  Sheet.open(`
    <div class="sheet-head"><h3>Seasons</h3><button class="x" onclick="Sheet.close()">×</button></div>
    <div class="sheet-body">
      <p style="color:var(--ink-dim);font-size:13px;line-height:1.5;margin:2px 0 14px">
        New games are recorded into the <b style="color:var(--ink)">active</b> season. Career stats span every season.</p>
      ${seasons.map(season=>{
        const active=season.id===s.currentSeasonId;
        const gameCount=(s.history||[]).filter(g=>g.seasonId===season.id).length;
        return `<div class="pl-row" style="border:1px solid ${active?'var(--clay)':'var(--line)'};border-radius:12px;margin-bottom:8px;padding:12px 14px">
          <span class="pl-info"><div class="pl-name">${esc(season.name)}${active?' <span style="color:var(--clay);font-size:11px">● ACTIVE</span>':''}</div>
            <div class="pl-meta">${gameCount} game${gameCount===1?'':'s'}</div></span>
          ${active?'':`<button class="tool" style="flex:0;min-height:36px;padding:0 12px" onclick="activateSeason('${season.id}')">Set Active</button>`}
        </div>`;
      }).join('')}
      <button class="cta" onclick="createSeason()">＋ New Season</button>
    </div>`);
}
function createSeason(){
  const name=prompt('Season name:', 'Season '+((Store.get().seasons||[]).length+1));
  if(!name) return;
  const season={id:'s'+Date.now(), name:name.trim()||'Season', created:Date.now()};
  Store.get().seasons.push(season);
  Store.get().currentSeasonId=season.id;
  Store.commit(); openSeasonManager();
  toast('Created & activated '+season.name);
}
function activateSeason(id){
  Store.get().currentSeasonId=id;
  Store.commit(); openSeasonManager(); render();
  toast('Active season changed');
}

function renderHistory(){
  const h=Store.get().history;
  let html=`${appbar()}<div class="sec" style="padding:8px 18px"><h3>Scorebook Archive</h3></div>`;
  if(!h.length) return html+`<div class="empty">
      <div class="glyph">📚</div><h2>No Saved Games</h2>
      <p>Finished games land here as permanent scorebook entries. Tap one to review every at-bat.</p>
    </div>`;
  return html+`<div class="scroll stagger" style="padding:0 14px 16px">
    ${h.map((g,i)=>{
      const aw=g.totals.away.r,hw=g.totals.home.r;
      const ac=teamColor(g.away.name),hc=teamColor(g.home.name);
      return `<div class="card" style="margin-bottom:12px;padding:14px;cursor:pointer" onclick="reviewGame(${i})">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <span style="font-family:var(--font-num);font-size:11px;color:var(--ink-faint);letter-spacing:.5px;text-transform:uppercase">
            ${new Date(g.created).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})}</span>
          <span style="font-family:var(--font-num);font-size:10px;font-weight:800;letter-spacing:1px;color:var(--ink-dim)">FINAL</span>
        </div>
        <div class="ln" style="display:flex;align-items:center;gap:10px;margin-bottom:7px;${aw>=hw?'':'opacity:.6'}">
          <span style="width:24px;height:26px;flex:0 0 auto">${Crest.team(g.away.name,ac,24)}</span>
          <span style="flex:1;font-weight:700;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(g.away.name)}</span>
          <span style="font-family:var(--font-num);font-weight:800;font-size:20px">${aw}</span>
        </div>
        <div class="ln" style="display:flex;align-items:center;gap:10px;${hw>=aw?'':'opacity:.6'}">
          <span style="width:24px;height:26px;flex:0 0 auto">${Crest.team(g.home.name,hc,24)}</span>
          <span style="flex:1;font-weight:700;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(g.home.name)}</span>
          <span style="font-family:var(--font-num);font-weight:800;font-size:20px">${hw}</span>
        </div>
        <div style="font-family:var(--font-num);font-size:11px;color:var(--ink-faint);margin-top:10px">${g.events.length} plays recorded</div>
      </div>`;
    }).join('')}</div>`;
}
function reviewGame(i){ reviewGameObj(Store.get().history[i]); }
function reviewGameObj(g){
  Sheet.open(`<div class="sheet-head"><h3>Final Box</h3><button class="x" onclick="Sheet.close()">×</button></div>
    <div class="sheet-body" style="padding:0 0 22px">${lineScore(g)}
      ${mvpCardHTML(g)}
      <div style="padding:8px 14px"><button class="cta ghost" onclick="openBoxScore(findGameById('${g.id}'))">📋 Full Box Score</button></div>
      <div style="padding:0 4px">${renderBookStatic(g)}</div></div>`);
}
function renderBookStatic(g){ return renderBook(g).replace(/<div class="book-head"[\s\S]*?<\/div>\s*<div class="linescore">[\s\S]*?<\/div>/, ''); }

/* ============================================================
   LIVE BOX SCORE
   ============================================================ */
function openBoxScore(g){
  g = g || Store.get().game;
  if(!g){ toast('No active game'); return; }
  Sheet.open(`
    <div class="sheet-head"><h3>Box Score</h3><button class="x" onclick="Sheet.close()">×</button></div>
    <div class="sheet-body" style="padding:0 0 24px">${boxScoreHTML(g)}</div>`);
}
function boxScoreHTML(g){
  const box=Stats.gameBox(g);
  const fmt3=v=>(v>=1?v.toFixed(3):('.'+Math.round(v*1000).toString().padStart(3,'0')));
  // line score + R/H/E/LOB totals
  let html=`<div style="padding:0 0 4px">${lineScore(g)}</div>
    <div class="box-totals">
      ${boxTotalRow(g.away.name, box.totals.away)}
      ${boxTotalRow(g.home.name, box.totals.home)}
    </div>
    ${recapBlock(g)}`;

  // for each side: batting then pitching
  [['away',g.away.name],['home',g.home.name]].forEach(([side,name])=>{
    const s=box.sides[side];
    if(s.batters.length){
      html+=`<div class="box-sec">${esc(name)} · Batting</div>
        <div class="box-table">
          <div class="bx-row bx-head"><span class="bx-name">Batter</span>
            <span>AB</span><span>R</span><span>H</span><span>RBI</span><span>BB</span><span>SO</span><span>AVG</span></div>
          ${s.batters.map(p=>{const b=p.line;
            // season AVG for context
            const sb=Stats.playerBatting(p.id,true);
            return `<div class="bx-row">
              <span class="bx-name">${esc(p.name)}${p.num?` <i>#${p.num}</i>`:''}</span>
              <span>${b.ab}</span><span>${b.r}</span><span>${b.h}</span>
              <span>${b.rbi}</span><span>${b.bb}</span><span>${b.k}</span><span>${fmt3(Stats.avg(sb))}</span>
            </div>`;}).join('')}
        </div>`;
    }
    if(s.pitchers.length){
      html+=`<div class="box-sec">${esc(name)} · Pitching</div>
        <div class="box-table">
          <div class="bx-row bx-head pitch"><span class="bx-name">Pitcher</span>
            <span>IP</span><span>H</span><span>R</span><span>BB</span><span>SO</span><span>ERA</span></div>
          ${s.pitchers.map(p=>{const pl=p.line;
            const sp=Stats.playerPitching(p.id,true);
            return `<div class="bx-row pitch">
              <span class="bx-name">${esc(p.name)}${p.num?` <i>#${p.num}</i>`:''}</span>
              <span>${Stats.ipStr(pl)}</span><span>${pl.h}</span><span>${pl.r}</span>
              <span>${pl.bb}</span><span>${pl.k}</span><span>${Stats.era(sp).toFixed(2)}</span>
            </div>`;}).join('')}
        </div>`;
    }
    const fielders=(s.fielders||[]).filter(f=>f.line.po||f.line.a||f.line.e)
      .sort((a,b)=>(b.line.po+b.line.a)-(a.line.po+a.line.a));
    if(fielders.length){
      html+=`<div class="box-sec">${esc(name)} · Fielding</div>
        <div class="box-table">
          <div class="bx-row bx-head field"><span class="bx-name">Fielder</span>
            <span>PO</span><span>A</span><span>E</span></div>
          ${fielders.map(p=>{const fl=p.line;
            return `<div class="bx-row field">
              <span class="bx-name">${esc(p.name)}${p.num?` <i>#${p.num}</i>`:''}</span>
              <span>${fl.po}</span><span>${fl.a}</span><span class="${fl.e?'bx-err':''}">${fl.e}</span>
            </div>`;}).join('')}
        </div>`;
    }
  });
  html+=`<div class="handoff" style="margin-top:10px">Updates live after every play</div>`;
  return html;
}
function boxTotalRow(name,t){
  return `<div class="bxt-row">
    <span class="bxt-name">${esc(name)}</span>
    <span class="bxt-cell"><b>${t.r}</b><i>R</i></span>
    <span class="bxt-cell"><b>${t.h}</b><i>H</i></span>
    <span class="bxt-cell"><b>${t.e}</b><i>E</i></span>
    <span class="bxt-cell"><b>${t.lob}</b><i>LOB</i></span>
  </div>`;
}
/* ============================================================
   TEAMS VIEW
   ============================================================ */
let openTeamId = null;     // which team card is expanded
let lineupCtx = null;      // {teamId, lineupId} when editing a lineup
let teamPageId = null;     // when viewing a full team page

function renderTeams(){
  if(lineupCtx) return renderLineupBuilder();
  if(teamPageId) return renderTeamPage(teamPageId);
  const teams = Store.get().teams;
  let html = `${appbar()}
    <div class="sec" style="padding:8px 18px"><h3>Your Teams</h3>
      <span class="more" onclick="openTeamSheet()">＋ New</span></div>
    <div class="scroll stagger" style="padding-top:2px">`;

  if(!teams.length){
    html += `<div class="empty"><div class="glyph">👥</div><h2>No Teams Yet</h2>
      <p>Add a team and build its roster. Lineups, stats, and standings all pull from here.</p>
      <button class="cta" style="max-width:240px" onclick="openTeamSheet()">Create a Team</button></div>`;
  } else {
    html += `<div style="padding:0 14px 14px">${teams.map(teamRowCard).join('')}</div>`;
  }
  return html + `</div>`;
}

// compact team card that opens the full team page
function teamRowCard(t){
  const rec=Standings.teamRecord(t.name);
  return `<div class="card" style="margin-bottom:12px;display:flex;align-items:center;gap:14px;padding:14px;cursor:pointer"
      onclick="openTeamPage('${t.id}')">
    <span style="width:48px;height:53px;flex:0 0 auto">${Crest.team(t.name,t.color,48)}</span>
    <div style="flex:1;min-width:0">
      <div style="font-family:var(--font-display);font-weight:700;text-transform:uppercase;letter-spacing:.5px;font-size:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.name)}</div>
      <div style="font-family:var(--font-num);font-size:12px;color:var(--ink-dim);margin-top:3px">
        ${t.players.length} players · ${rec.games?`${rec.w}-${rec.l}${rec.t?'-'+rec.t:''}`:'No games yet'}</div>
    </div>
    <span style="color:var(--ink-faint);font-size:20px">›</span>
  </div>`;
}

function posRank(code){ const i=Teams.POSITIONS.findIndex(x=>x.code===code); return i<0?99:i; }
function openTeamPage(id){ teamPageId=id; openTeamId=null; render(); }
function openTeamPageByName(name){
  const t=Store.get().teams.find(t=>t.name===name);
  if(t){ setView('teams'); teamPageId=t.id; render(); }
  else { toast('No saved team for '+name); }
}
function closeTeamPage(){ teamPageId=null; render(); }

/* ---- FULL TEAM PAGE (banner, record, stats, roster cards) ---- */
function renderTeamPage(id){
  const t=Teams.byId(id); if(!t){ teamPageId=null; return renderTeams(); }
  const rec=Standings.teamRecord(t.name);
  const c=t.color;
  const players=[...t.players].sort((a,b)=>posRank(a.pos)-posRank(b.pos));
  const rpg = rec.games?(rec.rf/rec.games).toFixed(1):'—';

  return `
  <button class="tp-back" onclick="closeTeamPage()">←</button>
  <div class="scroll">
    <div class="tp-banner">
      <div class="bg" style="background:linear-gradient(125deg,${Crest.shade(c,-.15)},${Crest.shade(c,-.55)})"></div>
      <div class="field-lines"></div>
      <div class="tp-head">
        <span class="crest-lg">${Crest.team(t.name,c,72)}</span>
        <div class="meta">
          <div class="tname">${esc(t.name)}</div>
          <div class="trec">${rec.games?`${rec.w}-${rec.l}${rec.t?'-'+rec.t:''} · ${fmtPct(rec.pct)}`:'New team'}</div>
        </div>
      </div>
    </div>

    <div class="tp-stats">
      <div class="tp-stat"><div class="v">${rec.w}</div><div class="l">Wins</div></div>
      <div class="tp-stat"><div class="v">${rec.l}</div><div class="l">Losses</div></div>
      <div class="tp-stat"><div class="v">${rpg}</div><div class="l">Runs/G</div></div>
      <div class="tp-stat"><div class="v">${rec.diff>0?'+':''}${rec.diff}</div><div class="l">Run Diff</div></div>
    </div>

    <div class="hero-cta" style="padding:0 14px">
      <button class="ghost" style="background:var(--panel);border:1px solid var(--line)" onclick="openPlayerSheet('${t.id}')">＋ Player</button>
      <button class="ghost" style="background:var(--panel);border:1px solid var(--line)" onclick="openLineupPicker('${t.id}')">⚡ Lineups</button>
      <button class="ghost" style="background:var(--panel);border:1px solid var(--line)" onclick="openTeamSheet('${t.id}')">⚙ Edit</button>
    </div>

    <div class="sec"><h3>Roster · ${t.players.length}</h3></div>
    ${players.length?`<div class="roster-grid stagger">${players.map(p=>playerCard(t,p)).join('')}</div>`
      : `<div class="empty-sm">No players yet. Tap ＋ Player to build your roster.</div>`}

    ${rec.games?`<div class="sec"><h3>Recent Games</h3></div>
      <div class="standings" style="margin-bottom:20px">
        ${Store.get().history.filter(g=>g.away.name===t.name||g.home.name===t.name).slice(0,6).map(g=>{
          const isAway=g.away.name===t.name;
          const my=isAway?g.totals.away.r:g.totals.home.r;
          const opp=isAway?g.totals.home.r:g.totals.away.r;
          const oppName=isAway?g.home.name:g.away.name;
          const won=my>opp;
          return `<div class="result-row">
            <span style="font-family:var(--font-num);font-weight:800;width:22px;color:${won?'var(--safe)':'var(--out)'}">${won?'W':'L'}</span>
            <div class="teams"><div class="ln"><span class="tn">vs ${esc(oppName)}</span>
              <span class="sc">${my}–${opp}</span></div></div>
            <span class="when">${new Date(g.created).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</span>
          </div>`;
        }).join('')}
      </div>`:'<div style="height:20px"></div>'}

    ${(()=>{ const sp=Stats.sprayData({teamId:t.id}); return sp.length?`
      <div class="sec"><h3>Team Spray Chart · ${sp.length} balls</h3></div>
      <div class="spray-wrap" style="margin-bottom:8px">${Field.sprayChart(sp)}
        <div class="spray-legend">
          <span><i style="background:#3ddc84"></i>Hit</span>
          <span><i style="background:#ffc94d"></i>HR</span>
          <span><i style="background:#ff5566"></i>Out</span>
        </div>
      </div>`:''; })()}
    <div style="height:16px"></div>
  </div>`;
}

// roster card (trading-card style, grid)
function playerCard(t,p){
  const b=Stats.playerBatting(p.id,true);
  const fmt3=v=>(v>=1?v.toFixed(3):('.'+Math.round(v*1000).toString().padStart(3,'0')));
  const statLine = b.pa>0
    ? `<div class="pc-stats"><span>${fmt3(Stats.avg(b))}<small>AVG</small></span>
        <span>${b.hr}<small>HR</small></span><span>${b.rbi}<small>RBI</small></span></div>`
    : '';
  return `<div class="pcard" onclick="openPlayerCard('${t.id}','${p.id}')">
    <div class="accent" style="background:linear-gradient(90deg,${t.color},${Crest.shade(t.color,-.3)})"></div>
    <div class="pc-num">${p.num||''}</div>
    <span class="avatar">${Crest.player(p.name,p.num,t.color,false)}</span>
    <div class="pc-name">${esc(p.name)}</div>
    <span class="pc-pos">${posName(p.pos)}</span>
    ${statLine}
  </div>`;
}
function posName(code){ const o=Teams.POSITIONS.find(x=>x.code===code); return o?o.code:code; }

/* ---- PLAYER TRADING CARD (modal) ---- */
function openPlayerCard(teamId,pid){
  const t=Teams.byId(teamId); const p=Teams.playerById(t,pid);
  const c=t.color; const txt=Crest.readable(c);
  const posFull=(Teams.POSITIONS.find(x=>x.code===p.pos)||{}).name||p.pos;
  const b=Stats.playerBatting(pid,true);
  const hasStats=b.pa>0;
  const fmt3=v=>(v>=1?v.toFixed(3):('.'+Math.round(v*1000).toString().padStart(3,'0')));

  const heroStats = hasStats
    ? `<div class="tcard-stats">
        <div class="tcard-stat"><div class="v">${fmt3(Stats.avg(b))}</div><div class="l">AVG</div></div>
        <div class="tcard-stat"><div class="v">${b.hr}</div><div class="l">HR</div></div>
        <div class="tcard-stat"><div class="v">${b.rbi}</div><div class="l">RBI</div></div>
      </div>`
    : `<div class="tcard-stats">
        <div class="tcard-stat"><div class="v">${p.bats}</div><div class="l">Bats</div></div>
        <div class="tcard-stat"><div class="v">${p.throws}</div><div class="l">Throws</div></div>
        <div class="tcard-stat"><div class="v">${p.num||'—'}</div><div class="l">Number</div></div>
      </div>`;

  const statTable = hasStats ? `
    <div class="sec" style="padding:16px 18px 6px"><h3>Batting · Career</h3></div>
    <div class="statline">
      ${statCell('G',b.games)}${statCell('AB',b.ab)}${statCell('H',b.h)}${statCell('1B',b.b1)}
      ${statCell('2B',b.b2)}${statCell('3B',b.b3)}${statCell('HR',b.hr)}${statCell('RBI',b.rbi)}
      ${statCell('BB',b.bb)}${statCell('K',b.k)}${statCell('SB',b.sb)}${statCell('TB',b.tb)}
    </div>
    <div class="ratebar">
      ${rateCell('AVG',fmt3(Stats.avg(b)))}${rateCell('OBP',fmt3(Stats.obp(b)))}
      ${rateCell('SLG',fmt3(Stats.slg(b)))}${rateCell('OPS',fmt3(Stats.ops(b)))}
    </div>`
    : `<div class="tcard-note">Batting &amp; pitching stats appear here once this player records an at-bat in a scored game.</div>`;

  // pitching line (only if they've pitched)
  const pc=Stats.careerPitching(pid);
  const pitchTable = pc.bf>0 ? `
    <div class="sec" style="padding:18px 18px 6px"><h3>Pitching · Career</h3></div>
    <div class="statline" style="grid-template-columns:repeat(4,1fr)">
      ${statCell('IP',Stats.ipStr(pc))}${statCell('BF',pc.bf)}${statCell('H',pc.h)}${statCell('K',pc.k)}
    </div>
    <div class="ratebar">
      ${rateCell('ERA',Stats.era(pc).toFixed(2))}${rateCell('WHIP',Stats.whip(pc).toFixed(2))}
      ${rateCell('BB',pc.bb)}${rateCell('K',pc.k)}
    </div>` : '';

  // milestones
  const ms=Stats.milestones(pid);
  const mvpCount=Awards.playerMvpCount(pid);
  const mvpBadge = mvpCount>0 ? `<span class="ms-badge mvp">🏆 ${mvpCount}× Game MVP</span>` : '';
  const msBlock = (ms.length||mvpCount) ? `
    <div class="sec" style="padding:18px 18px 6px"><h3>Career Milestones</h3></div>
    <div class="ms-wrap">${mvpBadge}${ms.map(m=>`<span class="ms-badge ${m.kind}">🏅 ${m.label}</span>`).join('')}</div>` : '';

  // season-by-season breakdown
  const bd=Stats.seasonBreakdown(pid);
  const bdBlock = bd.length>1 ? `
    <div class="sec" style="padding:18px 18px 6px"><h3>Season by Season</h3></div>
    <div class="season-table">
      <div class="st-row st-head"><span class="st-yr">Season</span><span>G</span><span>AB</span><span>H</span><span>HR</span><span>RBI</span><span>AVG</span></div>
      ${bd.map(r=>`<div class="st-row">
        <span class="st-yr">${esc(r.season.name)}</span>
        <span>${r.bat.games}</span><span>${r.bat.ab}</span><span>${r.bat.h}</span>
        <span>${r.bat.hr}</span><span>${r.bat.rbi}</span><span>${fmt3(Stats.avg(r.bat))}</span>
      </div>`).join('')}
    </div>` : '';

  const spray=Stats.sprayData({playerId:pid});
  const sprayBlock = spray.length ? `
    <div class="sec" style="padding:18px 18px 6px"><h3>Spray Chart · ${spray.length} balls in play</h3></div>
    <div class="spray-wrap">${Field.sprayChart(spray)}
      <div class="spray-legend">
        <span><i style="background:#3ddc84"></i>Hit</span>
        <span><i style="background:#ffc94d"></i>HR</span>
        <span><i style="background:#ff5566"></i>Out</span>
      </div>
    </div>` : '';

  Sheet.open(`
    <div class="tcard">
      <div class="tcard-top" style="background:linear-gradient(125deg,${Crest.shade(c,-.05)},${Crest.shade(c,-.5)});color:${txt}">
        <div class="field-lines"></div>
        <div class="jersey" style="color:${txt}">${p.num?'#'+p.num:''}</div>
        <span class="avatar">${Crest.player(p.name,p.num,c,false)}</span>
        <div class="who">
          <div class="big">${esc(p.name)}</div>
          <div class="sub">${esc(t.name)} · ${esc(posFull)}</div>
        </div>
      </div>
      ${heroStats}
      <div class="tcard-scroll">
        ${msBlock}
        ${statTable}
        ${pitchTable}
        ${bdBlock}
        ${sprayBlock}
        <div style="padding:14px 18px 22px">
          <button class="cta" onclick="openPlayerSheet('${teamId}','${pid}')">Edit Player</button>
          <button class="cta ghost" onclick="Sheet.close()">Close</button>
        </div>
      </div>
    </div>`);
}
function statCell(l,v,dim){ return `<div class="sc-cell${dim?' dim':''}"><div class="scv">${v}</div><div class="scl">${l}</div></div>`; }
function rateCell(l,v){ return `<div class="rate-cell"><div class="rv">${v}</div><div class="rl">${l}</div></div>`; }

/* ---- team create/edit sheet ---- */
const TEAM_COLORS = ['#d2703a','#5fb56a','#4a90d9','#e7b84f','#b05fd9','#d9534f','#3ab0a8','#e0683c'];
function openTeamSheet(id){
  const t = id?Teams.byId(id):null;
  window._teamLogo = t&&t.logo ? t.logo : null;   // pending logo
  Sheet.open(`
    <div class="sheet-head"><h3>${t?'Edit Team':'New Team'}</h3><button class="x" onclick="Sheet.close()">×</button></div>
    <div class="sheet-body">
      <label class="fld"><span>TEAM LOGO</span></label>
      <div class="logo-upload">
        <div class="logo-preview" id="logoPreview">${logoPreviewHTML(window._teamLogo)}</div>
        <div class="logo-actions">
          <label class="logo-btn">📷 Upload Logo
            <input type="file" accept="image/*" style="display:none" onchange="onLogoPick(event)">
          </label>
          ${window._teamLogo?`<button class="logo-btn remove" type="button" onclick="clearLogo()">Remove</button>`:''}
          <div class="logo-hint">Camera, photo library, or image file</div>
        </div>
      </div>
      <label class="fld"><span>TEAM NAME</span>
        <input class="in" id="tName" value="${t?esc(t.name):''}" placeholder="Sandlot Sluggers"></label>
      <label class="fld"><span>ACCENT COLOR</span></label>
      <div class="choice" style="grid-template-columns:repeat(4,1fr)" id="colorRow">
        ${TEAM_COLORS.map(c=>`<button type="button" onclick="pickColor('${c}',this)"
          style="background:${c};min-height:46px;border:2px solid ${t&&t.color===c?'var(--ink)':'transparent'}"
          data-c="${c}"></button>`).join('')}
      </div>
      <button class="cta" onclick="saveTeam(${t?`'${t.id}'`:'null'})">${t?'Save':'Create Team'}</button>
      ${t?`<button class="cta ghost" style="color:var(--out)" onclick="deleteTeam('${t.id}')">Delete Team</button>`:''}
    </div>`);
  window._pickedColor = t?t.color:TEAM_COLORS[0];
}
function logoPreviewHTML(logo){
  if(logo) return `<img src="${logo}" alt="logo">`;
  return `<span class="logo-placeholder">⚾</span>`;
}
// downscale + compress uploaded image to a square data URL (keeps storage small)
function onLogoPick(evt){
  const file=evt.target.files&&evt.target.files[0];
  if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    const img=new Image();
    img.onload=()=>{
      const size=256;
      const canvas=document.createElement('canvas');
      canvas.width=size; canvas.height=size;
      const ctx=canvas.getContext('2d');
      // cover-crop to square
      const scale=Math.max(size/img.width, size/img.height);
      const w=img.width*scale, h=img.height*scale;
      ctx.drawImage(img,(size-w)/2,(size-h)/2,w,h);
      const dataUrl=canvas.toDataURL('image/jpeg',0.82);
      window._teamLogo=dataUrl;
      const prev=document.getElementById('logoPreview');
      if(prev) prev.innerHTML=logoPreviewHTML(dataUrl);
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(file);
}
function clearLogo(){
  window._teamLogo=null;
  const prev=document.getElementById('logoPreview');
  if(prev) prev.innerHTML=logoPreviewHTML(null);
}
function pickColor(c,el){
  window._pickedColor=c;
  [...document.getElementById('colorRow').children].forEach(b=>b.style.border='2px solid transparent');
  el.style.border='2px solid var(--ink)';
}
function saveTeam(id){
  const name=document.getElementById('tName').value.trim()||'New Team';
  const color=window._pickedColor||TEAM_COLORS[0];
  const logo=window._teamLogo||null;
  const s=Store.get();
  if(id){ const t=Teams.byId(id); t.name=name; t.color=color; t.logo=logo; }
  else { const t=Teams.createTeam(name,color); t.logo=logo; s.teams.push(t); teamPageId=t.id; }
  Store.commit(); Sheet.close(); render();
}
function deleteTeam(id){
  if(!confirm('Delete this team and its roster?')) return;
  const s=Store.get(); s.teams=s.teams.filter(t=>t.id!==id);
  s.lineups=s.lineups.filter(l=>l.teamId!==id);
  teamPageId=null;
  Store.commit(); Sheet.close(); toast('Team deleted'); render();
}

/* ---- player create/edit sheet ---- */
function openPlayerSheet(teamId,pid){
  const t=Teams.byId(teamId);
  const p=pid?Teams.playerById(t,pid):null;
  const posOpts=Teams.POSITIONS.map(o=>
    `<option value="${o.code}" ${p&&p.pos===o.code?'selected':''}>${o.code} — ${o.name}</option>`).join('');
  const hand=(field,val)=>['L','R','S'].map(h=>
    `<button type="button" class="${val===h?'sel':''}" onclick="pickHand('${field}','${h}',this)">${h}</button>`).join('');
  Sheet.open(`
    <div class="sheet-head"><h3>${p?'Edit Player':'Add Player'}</h3><button class="x" onclick="Sheet.close()">×</button></div>
    <div class="sheet-body">
      <div class="row2">
        <label class="fld" style="flex:0 0 84px"><span>NUMBER</span>
          <input class="in" id="pNum" inputmode="numeric" value="${p?esc(p.num):''}" placeholder="00"></label>
        <label class="fld"><span>NAME</span>
          <input class="in" id="pName" value="${p?esc(p.name):''}" placeholder="Player name"></label>
      </div>
      <label class="fld"><span>PRIMARY POSITION</span>
        <select class="in" id="pPos">${posOpts}</select></label>
      <label class="fld"><span>BATS</span></label>
      <div class="seg-toggle" id="batsRow">${hand('bats',p?p.bats:'R')}</div>
      <label class="fld"><span>THROWS</span></label>
      <div class="seg-toggle" id="throwsRow">${hand('throws',p?p.throws:'R')}</div>
      <button class="cta" onclick="savePlayer('${teamId}',${p?`'${p.id}'`:'null'})">${p?'Save':'Add Player'}</button>
      ${p?`<button class="cta ghost" style="color:var(--out)" onclick="deletePlayer('${teamId}','${p.id}')">Remove Player</button>`:''}
    </div>`);
  window._hand={bats:p?p.bats:'R', throws:p?p.throws:'R'};
}
function pickHand(field,val,el){
  window._hand[field]=val;
  [...el.parentElement.children].forEach(b=>b.classList.remove('sel'));
  el.classList.add('sel');
}
function savePlayer(teamId,pid){
  const t=Teams.byId(teamId);
  const data={
    name:document.getElementById('pName').value.trim()||'Player',
    num:document.getElementById('pNum').value.trim(),
    pos:document.getElementById('pPos').value,
    bats:window._hand.bats, throws:window._hand.throws
  };
  if(pid){ Object.assign(Teams.playerById(t,pid),data); }
  else { Teams.addPlayer(t,data); }
  teamPageId=teamId;
  Store.commit(); Sheet.close(); render();
}
function deletePlayer(teamId,pid){
  const t=Teams.byId(teamId);
  t.players=t.players.filter(p=>p.id!==pid);
  Store.get().lineups.forEach(l=>{ l.order=l.order.filter(x=>x!==pid);
    Object.keys(l.defense).forEach(k=>{ if(l.defense[k]===pid) delete l.defense[k]; }); });
  Store.commit(); Sheet.close(); render();
}

/* ============================================================
   LINEUP BUILDER  (drag-and-drop batting order + positions)
   ============================================================ */
function openLineupPicker(teamId){
  const lus=Store.get().lineups.filter(l=>l.teamId===teamId);
  const t=Teams.byId(teamId);
  Sheet.open(`
    <div class="sheet-head"><h3>${esc(t.name)} Lineups</h3><button class="x" onclick="Sheet.close()">×</button></div>
    <div class="sheet-body">
      ${lus.length? lus.map(l=>`
        <div class="pl-row" style="border:1px solid var(--line);border-radius:10px;margin-bottom:8px;padding:12px 14px">
          <span class="pl-info"><div class="pl-name">${esc(l.name)}</div>
            <div class="pl-meta">${l.order.length} batters</div></span>
          <button class="tool" style="flex:0;min-height:36px;padding:0 12px" onclick="editLineup('${teamId}','${l.id}')">Edit</button>
          <button class="pl-edit" style="color:var(--out)" onclick="deleteLineup('${l.id}')">🗑</button>
        </div>`).join('')
        : `<div class="empty-sm">No saved lineups. Create one from your roster — drag to set the batting order, tap to assign field positions.</div>`}
      <button class="cta" onclick="newLineup('${teamId}')">＋ New Lineup</button>
    </div>`);
}
function newLineup(teamId){
  const t=Teams.byId(teamId);
  if(!t.players.length){ toast('Add players first'); return; }
  const l=Teams.createLineup(teamId, 'Lineup '+(Store.get().lineups.filter(x=>x.teamId===teamId).length+1));
  Store.get().lineups.push(l); Store.commit(); Sheet.close();
  lineupCtx={teamId,lineupId:l.id}; render();
}
function editLineup(teamId,lineupId){ Sheet.close(); lineupCtx={teamId,lineupId}; render(); }
function deleteLineup(id){
  Store.get().lineups=Store.get().lineups.filter(l=>l.id!==id);
  Store.commit(); render();
  const open=document.querySelector('.sheet-wrap.open');
  if(open) openLineupPicker(lineupCtx?lineupCtx.teamId:Store.get().lineups[0]?.teamId);
}
function getLineup(){ return Store.get().lineups.find(l=>l.id===lineupCtx.lineupId); }

function renderLineupBuilder(){
  const l=getLineup(); const t=Teams.byId(l.teamId);
  const inOrder = l.order.map(id=>Teams.playerById(t,id)).filter(Boolean);
  const benched = t.players.filter(p=>!l.order.includes(p.id));

  const slots = inOrder.map((p,i)=>{
    const pos = Object.keys(l.defense).find(k=>l.defense[k]===p.id) || p.pos;
    return `<div class="lu-slot" draggable="true" data-pid="${p.id}" data-idx="${i}">
      <span class="lu-order">${i+1}</span>
      <span class="lu-grip" data-grip>⠿</span>
      <span class="lu-name">${p.num?'#'+p.num+' ':''}${esc(p.name)}</span>
      <button class="lu-posbtn" onclick="openPosPicker('${p.id}')">${pos}</button>
      <button class="lu-rm" onclick="benchPlayer('${p.id}')">−</button>
    </div>`;
  }).join('');

  return `<div class="list-head">
      <button class="tool" style="flex:0;min-height:36px;padding:0 12px" onclick="closeLineup()">← Back</button>
      <span class="ttl" style="font-size:15px;flex:1;text-align:center" onclick="renameLineup()">${esc(l.name)} ✎</span>
      <button class="add-btn" onclick="closeLineup()">Done</button>
    </div>
    <div class="scroll">
      <div class="seg-title" style="padding:12px 16px 6px">BATTING ORDER · drag to reorder</div>
      <div class="lu-card" id="luList">
        ${inOrder.length?slots:`<div class="empty-sm">Add players from the bench below.</div>`}
      </div>
      <div class="seg-title" style="padding:14px 16px 6px">BENCH · tap to add to lineup</div>
      <div class="bench-wrap">
        ${benched.length? benched.map(p=>`<span class="bench-chip">${p.num?'#'+p.num+' ':''}${esc(p.name)}
          <button onclick="addToLineup('${p.id}')">＋</button></span>`).join('')
          : `<span class="empty-sm" style="padding:8px">Everyone's in the lineup.</span>`}
      </div>
      <div class="handoff">Positions enforce one player per spot · slow-pitch supports 10 fielders + EH</div>
    </div>`;
}
function closeLineup(){ lineupCtx=null; render(); }
function renameLineup(){
  const l=getLineup(); const n=prompt('Lineup name:',l.name);
  if(n){ l.name=n.trim()||l.name; Store.commit(); render(); }
}
function addToLineup(pid){ const l=getLineup(); if(!l.order.includes(pid)) l.order.push(pid); Store.commit(); render(); }
function benchPlayer(pid){
  const l=getLineup(); l.order=l.order.filter(x=>x!==pid);
  Object.keys(l.defense).forEach(k=>{ if(l.defense[k]===pid) delete l.defense[k]; });
  Store.commit(); render();
}
function openPosPicker(pid){
  const l=getLineup(); const t=Teams.byId(l.teamId);
  const cur=Object.keys(l.defense).find(k=>l.defense[k]===pid);
  Sheet.open(`
    <div class="sheet-head"><h3>Field Position</h3><button class="x" onclick="Sheet.close()">×</button></div>
    <div class="sheet-body">
      <div class="pos-grid">
        ${Teams.POSITIONS.filter(o=>o.code!=='BN').map(o=>{
          const takenBy=l.defense[o.code];
          const taken = takenBy && takenBy!==pid;
          return `<button class="${cur===o.code?'sel':''} ${taken?'taken':''}"
            onclick="setPos('${pid}','${o.code}')">${o.code}<small>${o.name.split(' / ')[0]}</small></button>`;
        }).join('')}
      </div>
      <button class="cta ghost" onclick="setPos('${pid}','')">Clear Position</button>
    </div>`);
}
function setPos(pid,code){
  const l=getLineup();
  // remove this player from any existing slot
  Object.keys(l.defense).forEach(k=>{ if(l.defense[k]===pid) delete l.defense[k]; });
  if(code){
    // bump whoever else held it
    if(l.defense[code]) delete l.defense[code];
    l.defense[code]=pid;
  }
  Store.commit(); Sheet.close(); render();
}

/* ---- drag-and-drop (pointer-based, works on touch) ---- */
let dragState=null;
function initLineupDnD(){
  const list=document.getElementById('luList'); if(!list) return;
  list.querySelectorAll('.lu-slot').forEach(slot=>{
    const grip=slot.querySelector('[data-grip]');
    if(!grip) return;
    grip.addEventListener('pointerdown',e=>startDrag(e,slot,list));
  });
}
function startDrag(e,slot,list){
  e.preventDefault();
  const pid=slot.dataset.pid;
  slot.classList.add('dragging');
  dragState={pid,list};
  navigator.vibrate&&navigator.vibrate(8);
  const move=ev=>{
    const y=ev.clientY;
    const slots=[...list.querySelectorAll('.lu-slot')];
    slots.forEach(s=>s.classList.remove('over'));
    const target=slots.find(s=>{
      if(s===slot) return false;
      const r=s.getBoundingClientRect();
      return y>=r.top && y<=r.bottom;
    });
    if(target) target.classList.add('over');
    dragState.target=target;
  };
  const up=()=>{
    document.removeEventListener('pointermove',move);
    document.removeEventListener('pointerup',up);
    const l=getLineup();
    if(dragState.target){
      const from=l.order.indexOf(dragState.pid);
      const to=l.order.indexOf(dragState.target.dataset.pid);
      l.order.splice(from,1);
      l.order.splice(to,0,dragState.pid);
      Store.commit();
    }
    dragState=null; render();
  };
  document.addEventListener('pointermove',move);
  document.addEventListener('pointerup',up);
}

/* ---- shell ---- */
function render(){
  const s=Store.get();
  const app=document.getElementById('app');
  if(fanMode){ app.innerHTML = renderFan(); return; }   // public read-only viewer
  let body='';
  if(activeView==='score'){
    body = s.game ? renderScore(s.game) : emptyHome();
  } else if(activeView==='book'){
    body = s.game ? `<div class="scroll">${renderBook(s.game)}</div>` : emptyBook();
  } else if(activeView==='history'){
    body = renderHistory();
  } else if(activeView==='teams'){
    body = renderTeams();
  } else if(activeView==='stats'){
    body = renderStats();
  } else if(activeView==='schedule'){
    body = renderSchedule();
  } else if(activeView==='tournaments'){
    body = renderTournaments();
  } else if(activeView==='more'){
    body = renderMore();
  }
  app.innerHTML = body + nav();
  if(_animateView){
    // one-shot entrance on tab change (skipped on per-play live re-renders)
    app.classList.remove('view-enter'); void app.offsetWidth; app.classList.add('view-enter');
    _animateView=false;
  }
  if(activeView==='teams' && lineupCtx) initLineupDnD();
}

function emptyHome(){
  // The LIVE tab shows the active game; when none, show a rich home dashboard.
  return renderHome();
}

function renderHome(){
  const s=Store.get();
  const standings=Standings.compute();
  const results=Standings.recentResults(4);
  const leaders=computeLeaders();

  return `
  ${appbar()}
  <div class="scroll" data-refresh="home">
    ${scoresRail()}
    <div class="stagger">
    ${heroCard()}

    ${spotlightCard()}

    ${(()=>{ const up=Schedule.upcoming().slice(0,2);
      return up.length?`
      <div class="sec"><h3>Up Next</h3><span class="more" onclick="setView('schedule')">Schedule</span></div>
      ${up.map(eventCard).join('')}`:''; })()}

    ${leaders.length?`
    <div class="sec"><h3>League Leaders</h3></div>
    <div class="rail">${leaders.map(leaderCard).join('')}</div>`:''}

    ${standings.length?`
    <div class="sec"><h3>Standings</h3>${standings.length>5?`<span class="more" onclick="setView('teams')">All teams</span>`:''}</div>
    <div class="standings">
      ${standings.slice(0,5).map((r,i)=>`
        <div class="std-row" onclick="openTeamPageByName('${escAttr(r.name)}')">
          <span class="rank ${i===0?'top':''}">${i+1}</span>
          <span class="crest-sm">${Crest.team(r.name,r.color,30)}</span>
          <span class="nm">${esc(r.name)}</span>
          <span class="wl">${r.w}-${r.l}${r.t?'-'+r.t:''}</span>
          <span class="pct">${fmtPct(r.pct)}</span>
        </div>`).join('')}
    </div>`:''}

    ${!standings.length && !results.length ? firstRunCard() : ''}
    <div style="height:20px"></div>
    </div>
  </div>`;
}

/* ESPN-style horizontal scores strip: the live game (if any) + recent
   finals as compact, swipeable, tappable chips. */
function scoresRail(){
  const s=Store.get();
  const games=[];
  if(s.game) games.push({g:s.game, live:!s.game.final});
  Standings.recentResults(8).forEach(g=>{ if(!s.game || g.id!==s.game.id) games.push({g, live:false}); });
  if(games.length<2) return '';           // nothing worth a strip yet
  const chip=({g,live})=>{
    const aw=g.totals.away.r, hw=g.totals.home.r;
    const ac=teamColor(g.away.name), hc=teamColor(g.home.name);
    const aWin=!live&&aw>hw, hWin=!live&&hw>aw;
    const status=live
      ? `<div class="sc-status live"><span class="live-dot"></span>${g.half==='top'?'TOP':'BOT'} ${ord(g.inning)}</div>`
      : `<div class="sc-status">${new Date(g.created).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</div>`;
    const tap = live ? `setView('score')` : `openBoxScore(findGameById('${g.id}'))`;
    return `<div class="score-chip" onclick="${tap}">
      ${status}
      <div class="sc-line ${aWin?'win':(!live&&hWin?'lose':'')}">
        <span class="crest-xs">${Crest.team(g.away.name,ac,18)}</span>
        <span class="nm">${esc(g.away.name)}</span><span class="rn">${aw}</span></div>
      <div class="sc-line ${hWin?'win':(!live&&aWin?'lose':'')}">
        <span class="crest-xs">${Crest.team(g.home.name,hc,18)}</span>
        <span class="nm">${esc(g.home.name)}</span><span class="rn">${hw}</span></div>
    </div>`;
  };
  return `<div class="score-rail">${games.slice(0,8).map(chip).join('')}</div>`;
}

/* Featured player spotlight — the hottest bat in the league. */
function spotlightCard(){
  const rows=Stats.leaders('ops',{minAB:5});
  let pick=rows[0];
  if(!pick){ const hr=Stats.leaders('hr',{}); pick=hr[0]; }   // fallback before AB volume
  if(!pick) return '';
  const r=Stats.resolve(pick.id); if(!r) return '';
  const b=pick.b;
  const color=r.team.color;
  const fmt3=v=>(v>=1?v.toFixed(3):('.'+Math.round(v*1000).toString().padStart(3,'0')));
  const stat=(v,l)=>`<div class="sl-stat"><b>${v}</b><small>${l}</small></div>`;
  return `<div class="sec"><h3>Player Spotlight</h3></div>
    <div class="spotlight" onclick="openPlayerCard('${r.team.id}','${pick.id}')">
      <div class="sl-bg" style="background:linear-gradient(135deg,${color},${Crest.shade(color,-.55)})"></div>
      <div class="field-lines"></div>
      <div class="sl-inner">
        <span class="avatar sl-av">${Crest.player(r.player.name,r.player.num,color,true)}</span>
        <div class="sl-meta">
          <div class="sl-tag">🔥 In Form</div>
          <div class="sl-name">${esc(r.player.name)}</div>
          <div class="sl-team">${esc(r.team.name)}${r.player.num?` · #${r.player.num}`:''}</div>
        </div>
      </div>
      <div class="sl-stats">
        ${stat(fmt3(Stats.avg(b)),'AVG')}
        ${stat(b.hr,'HR')}
        ${stat(b.rbi,'RBI')}
        ${stat(fmt3(Stats.ops(b)),'OPS')}
      </div>
    </div>`;
}

function appbar(){
  return `<div class="appbar">
    <div class="logo">
      <div class="mark">⚾</div>
      <div class="wordmark">Diamond<b>Tracker</b></div>
    </div>
    <div class="spacer"></div>
    <button class="icon-btn" onclick="setView('more')">⚙</button>
  </div>`;
}

function heroCard(){
  const s=Store.get();
  // Prefer in-progress game; else most recent final; else a "start" prompt.
  const g = s.game || s.history[0];
  if(!g){
    return `<div class="hero">
      <div class="hero-banner" style="background:linear-gradient(135deg,#1b2230,#141925)">
        <div class="field-lines"></div></div>
      <div class="hero-body">
        <div style="text-align:center;padding:6px 0 2px">
          <div style="font-family:var(--font-display);font-size:22px;font-weight:700;text-transform:uppercase;letter-spacing:1px">Play Ball</div>
          <div style="color:var(--ink-dim);font-size:13px;margin-top:6px;line-height:1.5">
            Start your first game — the scorebook, stats, and standings all build from here.</div>
        </div>
        <div class="hero-cta">
          <button class="primary" onclick="openSetup()">⚾ Start a Game</button>
        </div>
      </div></div>`;
  }
  const live = s.game && !g.final;
  const ac=teamColor(g.away.name), hc=teamColor(g.home.name);
  const aw=g.totals.away.r, hw=g.totals.home.r;
  const statusHtml = live
    ? `<div class="hero-status"><span class="live-dot"></span>Live · ${g.half==='top'?'Top':'Bot'} ${ord(g.inning)}</div>`
    : `<div class="hero-status final">Final</div>`;
  return `<div class="hero">
    <div class="hero-banner" style="background:linear-gradient(110deg,${Crest.shade(ac,-.4)},${Crest.shade(hc,-.4)})">
      <div class="field-lines"></div>
      ${statusHtml}
    </div>
    <div class="hero-body">
      <div class="matchup">
        <div class="side">
          <span class="avatar" style="width:46px;height:46px">${Crest.team(g.away.name,ac,46)}</span>
          <span class="nm">${esc(g.away.name)}</span>
          <span class="scr ${aw>hw?'win':''}">${aw}</span>
        </div>
        <div class="vs">—</div>
        <div class="side">
          <span class="avatar" style="width:46px;height:46px">${Crest.team(g.home.name,hc,46)}</span>
          <span class="nm">${esc(g.home.name)}</span>
          <span class="scr ${hw>aw?'win':''}">${hw}</span>
        </div>
      </div>
      <div class="hero-cta">
        ${live
          ? `<button class="primary" onclick="setView('score')">▶ Resume Scoring</button>
             <button class="ghost" onclick="setView('book')">📖 Book</button>`
          : `<button class="primary" onclick="openSetup()">⚾ New Game</button>
             <button class="ghost" onclick="reviewGameByObj()">📋 Box Score</button>`}
      </div>
    </div></div>`;
}

function firstRunCard(){
  return `<div class="sec"><h3>Get Started</h3></div>
    <div class="standings" style="padding:4px 0">
      <div class="std-row" onclick="setView('teams')">
        <span style="font-size:20px;width:30px;text-align:center">👥</span>
        <span class="nm">Create your first team<div style="font-size:11px;color:var(--ink-dim);font-weight:400">Add a roster and build lineups</div></span>
        <span style="color:var(--clay);font-size:18px">→</span>
      </div>
      <div class="std-row" onclick="openSetup()">
        <span style="font-size:20px;width:30px;text-align:center">⚾</span>
        <span class="nm">Score a game<div style="font-size:11px;color:var(--ink-dim);font-weight:400">Live scorekeeping, one tap per play</div></span>
        <span style="color:var(--clay);font-size:18px">→</span>
      </div>
    </div>`;
}

/* leaders: derive simple per-team scoring leaders until player stats land */
function computeLeaders(){
  const s=Store.get();
  const out=[];

  // --- Player leaders (preferred, from real stats) ---
  const fmt3=v=>(v>=1?v.toFixed(3):('.'+Math.round(v*1000).toString().padStart(3,'0')));
  const pushPlayerLeader=(cat,stat,opts,fmt)=>{
    const rows=Stats.leaders(stat,opts);
    if(rows.length){
      const top=rows[0]; const r=Stats.resolve(top.id);
      if(r) out.push({type:'player',cat,pid:top.id,teamId:r.team.id,
        name:r.player.name,num:r.player.num,color:r.team.color,
        stat:fmt?fmt(top.val):top.val,unit:''});
    }
  };
  pushPlayerLeader('AVG Leader','avg',{minAB:3},fmt3);
  pushPlayerLeader('Home Runs','hr',{},null);
  pushPlayerLeader('RBI Leader','rbi',{},null);
  pushPlayerLeader('Hits','h',{},null);

  // --- Team leaders (fallback / supplement) ---
  const standings=Standings.compute();
  if(out.length<2 && standings.length){
    const topRF=[...standings].sort((a,b)=>b.rf-a.rf)[0];
    if(topRF&&topRF.rf>0) out.push({type:'team',cat:'Most Runs',name:topRF.name,color:topRF.color,stat:topRF.rf,unit:'R'});
    const topW=[...standings].sort((a,b)=>b.w-a.w)[0];
    if(topW&&topW.w>0) out.push({type:'team',cat:'Most Wins',name:topW.name,color:topW.color,stat:topW.w,unit:'W'});
  }
  return out;
}
function leaderCard(l){
  if(l.type==='player'){
    return `<div class="leader-card" style="--lc:${l.color}" onclick="openPlayerCard('${l.teamId}','${l.pid}')">
      <div class="cat">${l.cat}</div>
      <div class="who">
        <span class="avatar">${Crest.player(l.name,l.num,l.color,false)}</span>
        <div style="min-width:0"><div class="nm">${esc(l.name)}</div></div>
      </div>
      <div class="stat">${l.stat}${l.unit?`<small>${l.unit}</small>`:''}</div>
    </div>`;
  }
  return `<div class="leader-card" style="--lc:${l.color}" onclick="openTeamPageByName('${escAttr(l.name)}')">
    <div class="cat">${l.cat}</div>
    <div class="who">
      <span class="avatar">${Crest.team(l.name,l.color,38)}</span>
      <div style="min-width:0"><div class="nm">${esc(l.name)}</div></div>
    </div>
    <div class="stat">${l.stat}${l.unit?`<small>${l.unit}</small>`:''}</div>
  </div>`;
}

function teamColor(name){
  const t=Store.get().teams.find(t=>t.name===name);
  return t?t.color:'#ff6b35';
}
function fmtPct(p){ return p>=1?'1.000':('.'+Math.round(p*1000).toString().padStart(3,'0')); }
function escAttr(s){ return String(s).replace(/'/g,"\\'").replace(/"/g,'&quot;'); }
function reviewGameByObj(){ const g=Store.get().history[0]; if(g) reviewGameObj(g); }

function emptyBook(){
  return `<div class="empty"><div class="glyph">📖</div><h2>No Active Game</h2>
    <p>Start a game to begin the digital scorebook, or browse finished games in the Archive.</p></div>`;
}
/* ============================================================
   SCHEDULE VIEW
   ============================================================ */
function fmtEventDate(iso){
  const d=new Date(iso);
  const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const mons=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let h=d.getHours(), m=d.getMinutes();
  const ap=h>=12?'PM':'AM'; h=h%12||12;
  const time=`${h}:${String(m).padStart(2,'0')} ${ap}`;
  return {dow:days[d.getDay()], date:`${mons[d.getMonth()]} ${d.getDate()}`, time};
}
function dateGroupLabel(iso){
  const d=new Date(iso), now=new Date();
  const dd=new Date(d.getFullYear(),d.getMonth(),d.getDate());
  const t0=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const diff=Math.round((dd-t0)/864e5);
  if(diff===0) return 'Today';
  if(diff===1) return 'Tomorrow';
  if(diff>1 && diff<7) return 'This Week';
  if(diff>=7 && diff<14) return 'Next Week';
  return null; // fall back to month
}
/* ============================================================
   TOURNAMENT VIEWS
   ============================================================ */
function renderTournaments(){
  if(openTournamentId){ return renderBracket(openTournamentId); }
  const tns=Tournament.all().sort((a,b)=>b.created-a.created);
  let html=`${appbar()}
    <div class="sec" style="padding:8px 18px 4px"><h3>Tournaments</h3>
      <span class="more" onclick="openTournamentSheet()">＋ New</span></div>`;
  if(!tns.length){
    return html+`<div class="empty"><div class="glyph">🏆</div><h2>No Tournaments</h2>
      <p>Create a bracket — single or double elimination, or round robin — and track it as you record results.</p>
      <button class="cta" style="max-width:240px;margin:18px auto 0" onclick="openTournamentSheet()">Create Tournament</button></div>`;
  }
  html+=`<div class="scroll stagger" style="padding-bottom:24px">`;
  tns.forEach(t=>{
    const fmt=Tournament.FORMATS[t.format];
    const champTeam=t.champion?Store.get().teams.find(x=>x.id===t.champion):null;
    const done=!!t.champion;
    html+=`<div class="tn-card" onclick="openTournament('${t.id}')">
      <div class="tn-card-top">
        <span class="tn-icon">${fmt.icon}</span>
        <div class="tn-card-info">
          <div class="tn-name">${esc(t.name)}</div>
          <div class="tn-sub">${fmt.label} · ${t.teamIds.length} teams</div>
        </div>
        ${done?`<span class="tn-done">✓ Final</span>`:`<span class="tn-live">LIVE</span>`}
      </div>
      ${champTeam?`<div class="tn-champ">
        <span class="avatar" style="width:30px;height:30px">${Crest.team(champTeam.name,champTeam.color,30)}</span>
        🏆 ${esc(champTeam.name)} — Champion</div>`:''}
    </div>`;
  });
  html+=`</div>`;
  return html;
}
function openTournament(id){ openTournamentId=id; render(); }
function closeTournament(){ openTournamentId=null; render(); }

/* ---- create tournament ---- */
function openTournamentSheet(){
  const teams=Store.get().teams;
  if(teams.length<2){
    Sheet.open(`<div class="sheet-head"><h3>New Tournament</h3><button class="x" onclick="Sheet.close()">×</button></div>
      <div class="sheet-body"><div class="rsvp-note">You need at least 2 saved teams to create a bracket. Add teams first.</div>
      <button class="cta" onclick="Sheet.close();setView('teams')">Go to Teams</button></div>`);
    return;
  }
  window._tnFormat='single';
  window._tnTeams=new Set();
  Sheet.open(`
    <div class="sheet-head"><h3>New Tournament</h3><button class="x" onclick="Sheet.close()">×</button></div>
    <div class="sheet-body">
      <label class="fld"><span>NAME</span>
        <input class="in" id="tnName" placeholder="Summer Slam"></label>
      <label class="fld"><span>FORMAT</span></label>
      <div id="tnFormatRow" class="tn-format-row">
        ${Object.entries(Tournament.FORMATS).map(([k,v])=>`
          <button type="button" data-fmt="${k}" onclick="pickTnFormat('${k}',this)"
            class="tn-format ${k==='single'?'sel':''}">
            <span style="font-size:22px">${v.icon}</span>
            <span>${v.label}</span></button>`).join('')}
      </div>
      <label class="fld"><span>TEAMS · tap to include</span></label>
      <div class="tn-team-pick" id="tnTeamPick">
        ${teams.map(t=>`<button type="button" data-tid="${t.id}" onclick="toggleTnTeam('${t.id}',this)"
          class="tn-team-chip">
          <span class="avatar" style="width:26px;height:26px">${Crest.team(t.name,t.color,26)}</span>
          ${esc(t.name)}</button>`).join('')}
      </div>
      <div class="tn-pick-hint" id="tnPickHint">0 teams selected</div>
      <button class="cta" onclick="createTournament()">Generate Bracket</button>
    </div>`);
}
function pickTnFormat(k,el){
  window._tnFormat=k;
  [...document.getElementById('tnFormatRow').children].forEach(b=>b.classList.remove('sel'));
  el.classList.add('sel');
}
function toggleTnTeam(id,el){
  const set=window._tnTeams;
  if(set.has(id)){ set.delete(id); el.classList.remove('sel'); }
  else { set.add(id); el.classList.add('sel'); }
  document.getElementById('tnPickHint').textContent=`${set.size} team${set.size===1?'':'s'} selected`;
}
function createTournament(){
  const name=document.getElementById('tnName').value.trim()||'Tournament';
  const format=window._tnFormat||'single';
  const teamIds=[...window._tnTeams];
  if(teamIds.length<2){ toast('Pick at least 2 teams'); return; }
  if((format==='single'||format==='double') && teamIds.length<2){ toast('Need 2+ teams'); return; }
  const t=Tournament.create({name,format,teamIds});
  Store.commit(); Sheet.close(); openTournament(t.id); toast('Bracket generated');
}

/* ---- bracket display ---- */
function renderBracket(id){
  const t=Tournament.byId(id);
  if(!t){ openTournamentId=null; return renderTournaments(); }
  const fmt=Tournament.FORMATS[t.format];
  let html=`${appbar()}
    <div class="bracket-head">
      <button class="tool" style="flex:0;min-height:38px;padding:0 12px" onclick="closeTournament()">← All</button>
      <div class="bh-title"><div class="bh-name">${esc(t.name)}</div>
        <div class="bh-sub">${fmt.icon} ${fmt.label}</div></div>
      <button class="tool" style="flex:0;min-height:38px;padding:0 12px;color:var(--out)" onclick="deleteTournament('${t.id}')">🗑</button>
    </div>`;

  if(t.champion){
    const ct=Store.get().teams.find(x=>x.id===t.champion);
    if(ct) html+=`<div class="champ-banner">
      <span class="avatar" style="width:46px;height:46px">${Crest.team(ct.name,ct.color,46)}</span>
      <div><div class="champ-label">🏆 CHAMPION</div><div class="champ-name">${esc(ct.name)}</div></div>
    </div>`;
  }

  if(t.format==='roundrobin'){
    html+=renderRoundRobin(t);
  } else {
    html+=renderElimBracket(t);
  }
  return html;
}

function teamChip(teamId, isWinner){
  if(!teamId) return `<span class="bm-team tbd">TBD</span>`;
  const team=Store.get().teams.find(x=>x.id===teamId);
  if(!team) return `<span class="bm-team tbd">—</span>`;
  return `<span class="bm-team ${isWinner?'win':''}">
    <span class="avatar" style="width:22px;height:22px;flex:0 0 auto">${Crest.team(team.name,team.color,22)}</span>
    <span class="bm-name">${esc(team.name)}</span></span>`;
}
function matchCard(t, m){
  const aId=Tournament.teamInSlot(m.a,t.matches), bId=Tournament.teamInSlot(m.b,t.matches);
  if(m.bye){
    return `<div class="bmatch bye"><div class="bm-inner">
      ${teamChip(aId||bId,true)}
      <span class="bm-byelabel">BYE</span></div></div>`;
  }
  const ready=aId&&bId;
  const aWin=m.winner==='a', bWin=m.winner==='b';
  return `<div class="bmatch ${m.winner?'done':''} ${ready?'':'pending'}"
      ${ready?`onclick="openMatchResult('${t.id}','${m.id}')"`:''}>
    <div class="bm-row ${aWin?'win':''}">
      ${teamChip(aId,aWin)}
      <span class="bm-score">${m.scoreA!=null?m.scoreA:''}</span>
    </div>
    <div class="bm-row ${bWin?'win':''}">
      ${teamChip(bId,bWin)}
      <span class="bm-score">${m.scoreB!=null?m.scoreB:''}</span>
    </div>
  </div>`;
}
function renderElimBracket(t){
  const wRounds=Tournament.rounds(t,'w');
  const total=wRounds.length;
  let html=`<div class="bracket-scroll"><div class="bracket">`;
  wRounds.forEach(r=>{
    html+=`<div class="b-round">
      <div class="b-round-name">${Tournament.roundName(t,r.round,total)}</div>
      <div class="b-round-matches">
        ${r.matches.map(m=>matchCard(t,m)).join('')}
      </div>
    </div>`;
  });
  html+=`</div></div>`;
  // grand final for double elim
  if(t.format==='double'){
    const gf=t.matches.find(m=>m.bracket==='gf');
    if(gf){ html+=`<div class="sec" style="padding:14px 18px 6px"><h3>Grand Final</h3></div>
      <div style="padding:0 14px 8px">${matchCard(t,gf)}</div>`; }
    html+=`<div class="rsvp-note">Double-elimination losers bracket fills in as teams are eliminated. Tap a winners-bracket match to record results.</div>`;
  }
  return html;
}
function renderRoundRobin(t){
  const st=Tournament.standings(t);
  let html=`<div class="scroll" style="padding-bottom:24px">
    <div class="sec" style="padding:14px 18px 6px"><h3>Standings</h3></div>
    <div class="rr-standings">
      <div class="rr-row rr-head"><span class="rr-rank">#</span><span class="rr-team">Team</span>
        <span>W</span><span>L</span><span>PCT</span><span>DIFF</span></div>
      ${st.map((r,i)=>{const team=Store.get().teams.find(x=>x.id===r.teamId);
        return `<div class="rr-row ${i===0&&r.played?'lead':''}">
          <span class="rr-rank">${i+1}</span>
          <span class="rr-team">${team?esc(team.name):'—'}</span>
          <span>${r.w}</span><span>${r.l}</span>
          <span>${r.played?fmtPct(r.pct):'—'}</span>
          <span class="${r.diff>0?'pos':r.diff<0?'neg':''}">${r.diff>0?'+':''}${r.diff}</span>
        </div>`;}).join('')}
    </div>
    <div class="sec" style="padding:16px 18px 6px"><h3>Matches</h3></div>
    <div style="padding:0 14px">
      ${t.matches.map(m=>matchCard(t,m)).join('')}
    </div>
  </div>`;
  return html;
}

/* ---- record a match result ---- */
function openMatchResult(tId, mId){
  const t=Tournament.byId(tId); const m=t.matches.find(x=>x.id===mId);
  const aId=Tournament.teamInSlot(m.a,t.matches), bId=Tournament.teamInSlot(m.b,t.matches);
  const aTeam=Store.get().teams.find(x=>x.id===aId), bTeam=Store.get().teams.find(x=>x.id===bId);
  if(!aTeam||!bTeam) return;
  Sheet.open(`
    <div class="sheet-head"><h3>Record Result</h3><button class="x" onclick="Sheet.close()">×</button></div>
    <div class="sheet-body">
      <div class="mr-team">
        <span class="avatar" style="width:36px;height:36px">${Crest.team(aTeam.name,aTeam.color,36)}</span>
        <span class="mr-name">${esc(aTeam.name)}</span>
        <input class="mr-score" id="mrA" type="number" inputmode="numeric" value="${m.scoreA!=null?m.scoreA:''}" placeholder="0">
      </div>
      <div class="mr-team">
        <span class="avatar" style="width:36px;height:36px">${Crest.team(bTeam.name,bTeam.color,36)}</span>
        <span class="mr-name">${esc(bTeam.name)}</span>
        <input class="mr-score" id="mrB" type="number" inputmode="numeric" value="${m.scoreB!=null?m.scoreB:''}" placeholder="0">
      </div>
      <button class="cta" onclick="saveMatchResult('${tId}','${mId}')">Save Result</button>
      ${m.winner?`<button class="cta ghost" onclick="clearMatchResult('${tId}','${mId}')">Clear Result</button>`:''}
    </div>`);
}
function saveMatchResult(tId, mId){
  const a=parseInt(document.getElementById('mrA').value,10);
  const b=parseInt(document.getElementById('mrB').value,10);
  if(isNaN(a)||isNaN(b)){ toast('Enter both scores'); return; }
  if(a===b){ toast('Games cannot end in a tie'); return; }
  Tournament.setResult(tId,mId,a,b);
  Store.commit(); Sheet.close(); render(); toast('Result saved');
}
function clearMatchResult(tId, mId){
  Tournament.clearResult(tId,mId);
  Store.commit(); Sheet.close(); render(); toast('Result cleared');
}
function deleteTournament(id){
  if(!confirm('Delete this tournament?')) return;
  Tournament.remove(id); openTournamentId=null;
  Store.commit(); render(); toast('Tournament deleted');
}

function renderSchedule(){
  const up=Schedule.upcoming();
  const past=Schedule.past();
  let html=`${appbar()}
    <div class="sec" style="padding:8px 18px 4px"><h3>Schedule</h3>
      <span class="more" onclick="openEventSheet()">＋ Add</span></div>`;

  if(!up.length && !past.length){
    return html+`<div class="empty"><div class="glyph">📅</div><h2>Nothing Scheduled</h2>
      <p>Add games, practices, and tournaments — then collect RSVPs from your roster.</p>
      <button class="cta" style="max-width:240px;margin:18px auto 0" onclick="openEventSheet()">Schedule an Event</button></div>`;
  }

  html+=`<div class="scroll stagger" style="padding-bottom:24px">`;

  if(up.length){
    // group upcoming by relative label / month
    let lastGroup=null;
    up.forEach(e=>{
      const g=dateGroupLabel(e.start) || (()=>{const d=new Date(e.start);
        return d.toLocaleDateString(undefined,{month:'long',year:'numeric'});})();
      if(g!==lastGroup){ html+=`<div class="sched-group">${esc(g)}</div>`; lastGroup=g; }
      html+=eventCard(e);
    });
  }
  if(past.length){
    html+=`<div class="sched-group past">Past</div>`;
    past.slice(0,10).forEach(e=>{ html+=eventCard(e,true); });
  }
  html+=`</div>`;
  return html;
}
function eventCard(e, isPast){
  const ty=Schedule.TYPES[e.type]||Schedule.TYPES.event;
  const dt=fmtEventDate(e.start);
  const team=e.teamId?Store.get().teams.find(t=>t.id===e.teamId):null;
  const tally=Schedule.rsvpTally(e);
  const title=e.title||(e.type==='game'&&e.oppName?`vs ${e.oppName}`:ty.label);
  return `<div class="event-card ${isPast?'past':''}" onclick="openEventDetail('${e.id}')">
    <div class="ec-date" style="border-color:${ty.color}">
      <span class="ec-dow">${dt.dow}</span>
      <span class="ec-day">${dt.date.split(' ')[1]}</span>
      <span class="ec-mon">${dt.date.split(' ')[0]}</span>
    </div>
    <div class="ec-body">
      <div class="ec-title">${ty.icon} ${esc(title)}</div>
      <div class="ec-meta">${dt.time}${e.location?` · ${esc(e.location)}`:''}</div>
      ${team?`<div class="ec-team">${esc(team.name)}</div>`:''}
    </div>
    ${team&&!isPast?`<div class="ec-rsvp">
      <span class="rsvp-in">${tally.in}</span><span class="rsvp-sep">in</span>
      ${tally.pending?`<span class="rsvp-pending">${tally.pending} pending</span>`:''}
    </div>`:''}
  </div>`;
}

/* ---- event create / edit ---- */
function openEventSheet(id){
  const e=id?Schedule.byId(id):null;
  const teams=Store.get().teams;
  // default start: next hour, today
  const now=new Date(); now.setMinutes(0,0,0); now.setHours(now.getHours()+1);
  const startVal=e?toLocalInput(e.start):toLocalInput(now.toISOString());
  Sheet.open(`
    <div class="sheet-head"><h3>${e?'Edit Event':'New Event'}</h3><button class="x" onclick="Sheet.close()">×</button></div>
    <div class="sheet-body">
      <label class="fld"><span>TYPE</span></label>
      <div class="choice" style="grid-template-columns:repeat(4,1fr)" id="evTypeRow">
        ${Object.entries(Schedule.TYPES).map(([k,v])=>`<button type="button" data-ty="${k}"
          onclick="pickEvType('${k}',this)"
          style="flex-direction:column;gap:3px;min-height:58px;border:2px solid ${(e?e.type:'game')===k?v.color:'transparent'}">
          <span style="font-size:20px">${v.icon}</span><span style="font-size:10px">${v.label}</span></button>`).join('')}
      </div>
      <label class="fld"><span>TITLE</span>
        <input class="in" id="evTitle" value="${e?esc(e.title):''}" placeholder="e.g. vs River Rats"></label>
      ${teams.length?`<label class="fld"><span>TEAM (for RSVPs)</span>
        <select class="in" id="evTeam">
          <option value="">— none —</option>
          ${teams.map(t=>`<option value="${t.id}" ${e&&e.teamId===t.id?'selected':''}>${esc(t.name)}</option>`).join('')}
        </select></label>`:''}
      <label class="fld"><span>DATE &amp; TIME</span>
        <input class="in" type="datetime-local" id="evStart" value="${startVal}"></label>
      <label class="fld"><span>LOCATION</span>
        <input class="in" id="evLoc" value="${e?esc(e.location):''}" placeholder="Field 3, Memorial Park"></label>
      <label class="fld"><span>NOTES</span>
        <input class="in" id="evNotes" value="${e?esc(e.notes):''}" placeholder="Bring white jerseys"></label>
      <button class="cta" onclick="saveEvent(${e?`'${e.id}'`:'null'})">${e?'Save':'Add to Schedule'}</button>
      ${e?`<button class="cta ghost" style="color:var(--out)" onclick="deleteEvent('${e.id}')">Delete Event</button>`:''}
    </div>`);
  window._evType = e?e.type:'game';
}
function pickEvType(k,el){
  window._evType=k;
  const row=document.getElementById('evTypeRow');
  [...row.children].forEach(b=>b.style.border='2px solid transparent');
  el.style.border='2px solid '+(Schedule.TYPES[k].color);
}
function toLocalInput(iso){
  const d=new Date(iso);
  const pad=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function saveEvent(id){
  const type=window._evType||'game';
  const title=document.getElementById('evTitle').value.trim();
  const teamEl=document.getElementById('evTeam');
  const teamId=teamEl?teamEl.value||null:null;
  const startEl=document.getElementById('evStart').value;
  const start=startEl?new Date(startEl).toISOString():new Date().toISOString();
  const location=document.getElementById('evLoc').value.trim();
  const notes=document.getElementById('evNotes').value.trim();
  const data={type,title,teamId,start,location,notes};
  if(id) Schedule.update(id,data); else Schedule.create(data);
  Store.commit(); Sheet.close(); render(); toast(id?'Event updated':'Event added');
}
function deleteEvent(id){
  if(!confirm('Delete this event?')) return;
  Schedule.remove(id); Store.commit(); Sheet.close(); render(); toast('Event deleted');
}

/* ---- event detail + RSVPs ---- */
function openEventDetail(id){
  const e=Schedule.byId(id); if(!e) return;
  const ty=Schedule.TYPES[e.type]||Schedule.TYPES.event;
  const dt=fmtEventDate(e.start);
  const team=e.teamId?Store.get().teams.find(t=>t.id===e.teamId):null;
  const tally=Schedule.rsvpTally(e);
  const title=e.title||(e.type==='game'&&e.oppName?`vs ${e.oppName}`:ty.label);

  let rsvpSection='';
  if(team){
    rsvpSection=`
      <div class="rsvp-summary">
        <div class="rsvp-stat in"><b>${tally.in}</b><span>In</span></div>
        <div class="rsvp-stat out"><b>${tally.out}</b><span>Out</span></div>
        <div class="rsvp-stat maybe"><b>${tally.maybe}</b><span>Maybe</span></div>
        <div class="rsvp-stat pending"><b>${tally.pending}</b><span>No reply</span></div>
      </div>
      <div class="sec" style="padding:14px 2px 6px"><h3>Roster RSVP</h3></div>
      <div class="rsvp-list">
        ${team.players.map(p=>{
          const st=(e.rsvps||{})[p.id]||'';
          return `<div class="rsvp-row">
            <span class="avatar" style="width:34px;height:34px">${Crest.player(p.name,p.num,team.color,false)}</span>
            <span class="rsvp-name">${esc(p.name)}</span>
            <div class="rsvp-btns">
              <button class="rb in ${st==='in'?'on':''}" onclick="rsvp('${e.id}','${p.id}','in')">✓</button>
              <button class="rb maybe ${st==='maybe'?'on':''}" onclick="rsvp('${e.id}','${p.id}','maybe')">?</button>
              <button class="rb out ${st==='out'?'on':''}" onclick="rsvp('${e.id}','${p.id}','out')">✕</button>
            </div>
          </div>`;
        }).join('')}
      </div>`;
  } else {
    rsvpSection=`<div class="rsvp-note">Assign a team to this event to collect RSVPs from the roster.</div>`;
  }

  Sheet.open(`
    <div class="sheet-head"><h3>${ty.icon} ${esc(ty.label)}</h3><button class="x" onclick="Sheet.close()">×</button></div>
    <div class="sheet-body">
      <div class="ed-title">${esc(title)}</div>
      <div class="ed-when">${dt.dow}, ${dt.date} · ${dt.time}</div>
      ${e.location?`<div class="ed-meta">📍 ${esc(e.location)}</div>`:''}
      ${e.notes?`<div class="ed-notes">${esc(e.notes)}</div>`:''}
      ${rsvpSection}
      <button class="cta ghost" style="margin-top:14px" onclick="openEventSheet('${e.id}')">Edit Event</button>
    </div>`);
}
function rsvp(eventId,playerId,status){
  const e=Schedule.byId(eventId);
  const cur=(e.rsvps||{})[playerId];
  // tapping the active status clears it (toggle off)
  Schedule.setRsvp(eventId,playerId, cur===status?null:status);
  Store.commit();
  openEventDetail(eventId); // re-render the sheet in place
}

function renderMore(){
  const theme=document.documentElement.getAttribute('data-theme')||'dark';
  const up=Schedule.upcoming();
  return `${appbar()}<div style="padding:6px 18px 18px">
    <div class="sec" style="padding:8px 0"><h3>Team Management</h3></div>
    <button class="tool" style="width:100%;justify-content:flex-start;padding:0 16px;margin-bottom:10px;min-height:52px;border-radius:14px"
      onclick="setView('schedule')">📅 Schedule &amp; RSVPs${up.length?`<span class="more-badge">${up.length}</span>`:''}</button>
    <button class="tool" style="width:100%;justify-content:flex-start;padding:0 16px;margin-bottom:10px;min-height:52px;border-radius:14px"
      onclick="setView('tournaments')">🏆 Tournaments &amp; Brackets${Tournament.all().length?`<span class="more-badge">${Tournament.all().length}</span>`:''}</button>
    <div class="sec" style="padding:8px 0"><h3>Settings</h3></div>
    ${(()=>{ const a=Auth.current();
      return `<button class="tool" style="width:100%;justify-content:flex-start;padding:0 16px;margin-bottom:10px;min-height:52px;border-radius:14px"
        onclick="openAccountSheet()">👤 Account<span class="sync-pill ${a.signedIn?'live':''}">${a.signedIn?esc(Auth.roleLabel(a.role)).toUpperCase():'SIGN IN'}</span></button>`; })()}
    <button class="tool" style="width:100%;justify-content:flex-start;padding:0 16px;margin-bottom:10px;min-height:52px;border-radius:14px"
      onclick="openSyncSheet()">📡 Live Sync<span class="sync-pill ${_syncState}">${_syncState==='live'?'LIVE':_syncState==='connecting'?'…':_syncState==='error'?'ERROR':'OFF'}</span></button>
    <button class="tool" style="width:100%;justify-content:flex-start;padding:0 16px;margin-bottom:10px;min-height:52px;border-radius:14px"
      onclick="openAiSheet()">✨ AI Write-ups<span class="sync-pill ${AI.isConfigured()?'live':''}">${AI.isConfigured()?'ON':'OFF'}</span></button>
    <button class="tool" style="width:100%;justify-content:flex-start;padding:0 16px;margin-bottom:10px;min-height:52px;border-radius:14px"
      onclick="toggleTheme()">${theme==='light'?'🌙 Switch to Dark':'☀️ Switch to Light'}</button>
    <button class="tool" style="width:100%;justify-content:flex-start;padding:0 16px;margin-bottom:10px;min-height:52px;border-radius:14px"
      onclick="exportData()">⬇️ Export All Data (JSON)</button>
    <button class="tool" style="width:100%;justify-content:flex-start;padding:0 16px;color:var(--out);min-height:52px;border-radius:14px"
      onclick="wipe()">🗑 Reset Everything</button>
    <div class="handoff">DiamondTracker · session 14 build<br>custom rules · run caps · mercy · slow-pitch DiamondTracker · session 13 build<br>tournament brackets · single/double elim · round robin co-ed presets</div>
  </div>`;
}

function nav(){
  const live = !!Store.get().game;
  const tabs=[
    ['score', live?'⚾':'🏠', live?'LIVE':'HOME'],
    ['book','📖','BOOK'],
    ['teams','👥','TEAMS'],
    ['stats','📊','STATS'],
    ['more','⚙️','MORE'],
  ];
  const idx=tabs.findIndex(t=>t[0]===activeView);
  // single sliding indicator (hidden when on a view with no matching tab)
  const ind = idx>=0 ? `<div class="nav-ind" style="left:${idx*(100/tabs.length)}%;width:${100/tabs.length}%"></div>` : '';
  const btn=([v,ic,lbl])=>`<button class="${activeView===v?'active':''}" onclick="setView('${v}')">
    <span class="ic">${ic}</span>${lbl}</button>`;
  return `<div class="nav">${ind}${tabs.map(btn).join('')}</div>`;
}

/* ---- Live Sync (Phase B) ---- */
let _syncState='offline';   // 'offline' | 'connecting' | 'live' | 'error'
// Connect on boot / after save if configured. Offline-first: failure is silent
// (we stay on the local cache) beyond a status flag.
async function initSync(opts={}){
  if(!Sync.isConfigured()){ _syncState='offline'; return; }
  _syncState='connecting'; if(opts.rerender) render();
  try{
    const cfg=Sync.readConfig();
    const client=await Sync.createClient(cfg);     // one client, shared with Auth
    Store.setRemote(Sync.makeRemote(client, cfg.room));
    await Store.hydrate();           // pull shared state, then live updates flow via subscribe
    await Auth.init(client);         // accounts/roles ride the same Supabase project
    _syncState='live';
    if(opts.toast) toast('Live Sync connected');
  }catch(e){
    console.warn('Live Sync failed; staying offline',e);
    Store.setRemote(null); Auth.detach(); _syncState='error';
    if(opts.toast) toast('Sync failed — working offline');
  }
  render();
}
function openSyncSheet(){
  const cfg=Sync.readConfig()||{};
  const v=s=>s?esc(s):'';
  Sheet.open(`
    <div class="sheet-head"><h3>📡 Live Sync</h3><button class="x" onclick="Sheet.close()">×</button></div>
    <div class="sheet-body">
      <div class="sync-status ${_syncState}">
        <span class="dot"></span>${_syncState==='live'?'Connected — sharing live':
          _syncState==='connecting'?'Connecting…':_syncState==='error'?'Connection failed':'Offline (local only)'}</div>
      <p style="color:var(--ink-dim);font-size:13px;line-height:1.5;margin:12px 0">
        Share one game across devices in real time. Create a free Supabase project, run the
        setup SQL (see <b>docs/SYNC.md</b>), then paste your project URL + anon key and pick a
        shared room code. Everything still works offline; sync is layered on top.</p>
      <label class="fld"><span>SUPABASE URL</span>
        <input class="in" id="syncUrl" placeholder="https://xxxx.supabase.co" value="${v(cfg.url)}"></label>
      <label class="fld"><span>ANON KEY</span>
        <input class="in" id="syncKey" placeholder="eyJ…" value="${v(cfg.anonKey)}"></label>
      <label class="fld"><span>ROOM CODE</span>
        <input class="in" id="syncRoom" placeholder="e.g. lions-2026" value="${v(cfg.room)}"></label>
      <button class="cta" onclick="saveSync()">${Sync.isConfigured()?'Reconnect':'Connect'}</button>
      ${Sync.isConfigured()?`<button class="cta ghost" style="margin-top:10px" onclick="copyFanLink()">📣 Copy fan link (read-only)</button>`:''}
      ${cfg.url?`<button class="cta ghost" style="margin-top:10px" onclick="disconnectSync()">Disconnect</button>`:''}
    </div>`);
}
function saveSync(){
  const url=(document.getElementById('syncUrl').value||'').trim();
  const anonKey=(document.getElementById('syncKey').value||'').trim();
  const room=(document.getElementById('syncRoom').value||'').trim();
  if(!url||!anonKey||!room){ toast('Fill in URL, key and room'); return; }
  Sync.writeConfig({enabled:true, url, anonKey, room});
  Sheet.close();
  initSync({toast:true, rerender:true});
}
function disconnectSync(){
  const cfg=Sync.readConfig()||{};
  Sync.writeConfig({...cfg, enabled:false});   // keep creds for convenience, just disable
  Store.setRemote(null); Auth.detach(); _syncState='offline';
  Sheet.close(); toast('Disconnected — working offline'); render();
}

/* ---- Account (Phase C: accounts & roles) ---- */
function openAccountSheet(){
  const connected=Sync.isConfigured() && _syncState==='live';
  const a=Auth.current();
  let body;
  if(!Sync.isConfigured()){
    body=`<p style="color:var(--ink-dim);font-size:13px;line-height:1.5">
      Accounts use your Live Sync Supabase project. Set up <b>📡 Live Sync</b> first, then sign in here.</p>
      <button class="cta" onclick="Sheet.close();openSyncSheet()">Set up Live Sync</button>`;
  } else if(a.signedIn){
    body=`<div class="acct-card">
        <div class="acct-id">
          <div class="acct-email">${esc(a.email||'Signed in')}</div>
          <span class="role-chip ${a.role}">${esc(Auth.roleLabel(a.role))}</span>
        </div>
        <div class="acct-cap">${Auth.canWrite(a.role)
          ? '✓ Can score &amp; edit shared games'
          : '👁 Read-only — you can follow live games but not edit them'}</div>
      </div>
      <button class="cta ghost" onclick="signOutNow()">Sign out</button>
      <div class="rsvp-note" style="padding:14px 4px 0">Roles are set in Supabase (see <b>docs/AUTH.md</b>). New sign-ins start as <b>fan</b> until promoted.</div>`;
  } else {
    body=`<p style="color:var(--ink-dim);font-size:13px;line-height:1.5;margin:0 0 12px">
        Sign in with a magic link — no password. We'll email you a link that signs you in.</p>
      <label class="fld"><span>EMAIL</span>
        <input class="in" id="acctEmail" type="email" placeholder="you@example.com"></label>
      <button class="cta" onclick="sendMagicLink()">Send magic link</button>`;
  }
  Sheet.open(`
    <div class="sheet-head"><h3>👤 Account</h3><button class="x" onclick="Sheet.close()">×</button></div>
    <div class="sheet-body">${body}</div>`);
}
async function sendMagicLink(){
  const email=(document.getElementById('acctEmail').value||'').trim();
  if(!email){ toast('Enter your email'); return; }
  try{
    await Auth.signInWithEmail(email, location.origin+location.pathname);
    Sheet.close(); toast('Check your email for the sign-in link');
  }catch(e){ console.warn(e); toast('Could not send link — check Live Sync'); }
}
async function signOutNow(){ await Auth.signOut(); Sheet.close(); toast('Signed out'); render(); }

/* ---- Public fan live-game page (Phase C) ----
   A read-only viewer that follows a shared room via a deep link
   (?fan=1&room=CODE&sb=<url>&k=<anon key>). Reads are open under RLS, so
   no sign-in is needed; the viewer pulls + subscribes and never writes. */
let fanMode=false;
let _fanRoom='';
let _fanStatus='connecting';   // 'connecting' | 'live' | 'error'

// Build a shareable fan link from the current Live Sync config.
function fanLink(){
  const cfg=Sync.readConfig(); if(!Sync.isConfigured(cfg)) return '';
  const p=new URLSearchParams({ fan:'1', room:cfg.room, sb:cfg.url, k:cfg.anonKey });
  return `${location.origin}${location.pathname}?${p.toString()}`;
}
async function copyFanLink(){
  const link=fanLink(); if(!link){ toast('Connect Live Sync first'); return; }
  try{ await navigator.clipboard.writeText(link); toast('Fan link copied'); }
  catch(e){ Sheet.open(`<div class="sheet-head"><h3>Fan link</h3><button class="x" onclick="Sheet.close()">×</button></div>
    <div class="sheet-body"><p style="color:var(--ink-dim);font-size:13px">Copy this read-only link to share:</p>
    <input class="in" readonly onclick="this.select()" value="${esc(link)}"></div>`); }
}

// Boot directly into the fan viewer (called from init when ?fan=1 is present).
async function bootFan(params){
  fanMode=true; _fanRoom=params.get('room')||''; _fanStatus='connecting';
  document.body.classList.add('fan');
  const sp=document.getElementById('splash'); if(sp) sp.remove();
  Store.load();                       // local default; overwritten by the room state
  Store.sub(()=>render());            // remote pushes -> applyRemote -> render
  render();
  const url=params.get('sb'), key=params.get('k');
  if(!url||!key||!_fanRoom){ _fanStatus='error'; render(); return; }
  try{
    const client=await Sync.createClient({ enabled:true, url, anonKey:key, room:_fanRoom });
    Store.setRemote(Sync.makeRemote(client, _fanRoom));   // fan never commits, so never pushes
    await Store.hydrate();
    _fanStatus='live';
  }catch(e){ console.warn('fan connect failed',e); _fanStatus='error'; }
  render();
}

function renderFan(){
  const s=Store.get();
  const g=s.game;
  const head=`<div class="fan-bar">
    <div class="logo"><div class="mark">⚾</div><div class="wordmark">Diamond<b>Tracker</b></div></div>
    <span class="fan-tag ${_fanStatus}">${_fanStatus==='live'?'● LIVE':_fanStatus==='connecting'?'CONNECTING…':'OFFLINE'}</span>
  </div>`;
  if(_fanStatus==='error'){
    return `${head}<div class="empty"><div class="glyph">📡</div><h2>Can't Connect</h2>
      <p>This fan link is missing or has invalid connection details. Ask for a fresh link.</p></div>`;
  }
  if(g && !g.final){
    const bt=Engine.battingTeam(g), batter=Engine.currentBatter(g);
    const aw=g.totals.away.r, hw=g.totals.home.r;
    return `${head}
      <div class="board"><div class="board-row">
        <div class="team-cell away ${g.half==='top'?'batting':''}">
          <div class="tc-line"><span class="board-crest">${Crest.team(g.away.name,teamColor(g.away.name),26)}</span>
            <div class="team-name ${g.half==='top'?'batting':''}">${esc(g.away.name)}</div></div>
          <div class="team-score ${aw>hw?'lead':''}">${aw}</div></div>
        <div class="center-cell">
          <div class="inning"><span class="ord">${g.inning}</span><sup>${ord(g.inning).replace(/\d+/,'')}</sup></div>
          <div class="half"><span class="arrow">${g.half==='top'?'▲':'▼'}</span></div></div>
        <div class="team-cell home ${g.half==='bottom'?'batting':''}">
          <div class="tc-line"><span class="board-crest">${Crest.team(g.home.name,teamColor(g.home.name),26)}</span>
            <div class="team-name ${g.half==='bottom'?'batting':''}">${esc(g.home.name)}</div></div>
          <div class="team-score ${hw>aw?'lead':''}">${hw}</div></div>
      </div><div class="board-pulse"></div></div>
      <div class="fieldwrap">${Field.bigDiamond(g,{})}</div>
      <div class="countbar">
        <div class="cgrp"><div class="clbl">B</div><div class="cdots">${dotRow(3,g.balls)}</div></div>
        <div class="cgrp"><div class="clbl">S</div><div class="cdots">${dotRow(2,g.strikes)}</div></div>
        <div class="cgrp"><div class="clbl">O</div><div class="cdots">${dotRow(2,g.outs,'out')}</div></div>
        <div class="cbat"><span class="pill">AT BAT</span><span class="who">${esc(batter.name)}</span></div>
      </div>
      <div class="scroll">${boxScoreHTML(g)}<div style="height:24px"></div></div>`;
  }
  // no live game — show the latest final + recent results
  const results=Standings.recentResults(6);
  return `${head}<div class="scroll">
    ${g&&g.final?`<div class="sec"><h3>Final</h3></div>${mvpCardHTML(g)}<div style="padding:0 4px">${renderBookStatic(g)}</div>`:''}
    ${results.length?`<div class="sec"><h3>Recent Results</h3></div>
      <div class="standings">${results.map(rg=>{const aw=rg.totals.away.r,hw=rg.totals.home.r;
        return `<div class="result-row"><div class="teams">
          <div class="ln ${aw>hw?'w':'l'}"><span class="tn">${esc(rg.away.name)}</span><span class="sc">${aw}</span></div>
          <div class="ln ${hw>aw?'w':'l'}"><span class="tn">${esc(rg.home.name)}</span><span class="sc">${hw}</span></div>
        </div></div>`;}).join('')}</div>`:
      `<div class="empty"><div class="glyph">⚾</div><h2>No Live Game</h2>
        <p>Hang tight — the scoreboard updates here automatically when the game starts.</p></div>`}
    <div style="height:24px"></div></div>`;
}
function dotRow(n,fill,cls=''){
  return Array.from({length:n},(_,i)=>`<span class="dot ${cls} ${i<fill?'fill':''}"></span>`).join('');
}

/* ---- AI write-ups (Phase D) ---- */
function openAiSheet(){
  const cfg=AI.readConfig()||{};
  const on=AI.isConfigured();
  Sheet.open(`
    <div class="sheet-head"><h3>✨ AI Write-ups</h3><button class="x" onclick="Sheet.close()">×</button></div>
    <div class="sheet-body">
      <div class="sync-status ${on?'live':''}"><span class="dot"></span>${on?'Enabled — using Claude':'Off (template write-ups)'}</div>
      <p style="color:var(--ink-dim);font-size:13px;line-height:1.5;margin:12px 0">
        Generate vivid Game MVP recaps with Claude (model <b>claude-opus-4-8</b>). Paste an
        Anthropic API key from <b>console.anthropic.com</b>. Without a key, the app uses built-in
        template write-ups — everything still works offline.</p>
      <label class="fld"><span>ANTHROPIC API KEY</span>
        <input class="in" id="aiKey" type="password" placeholder="sk-ant-…" value="${cfg.apiKey?esc(cfg.apiKey):''}"></label>
      <button class="cta" onclick="saveAi()">${on?'Update key':'Enable AI write-ups'}</button>
      ${cfg.apiKey?`<button class="cta ghost" style="margin-top:10px" onclick="disableAi()">Turn off</button>`:''}
      <div class="rsvp-note" style="padding:14px 4px 0">⚠️ The key is stored only in this browser and sent directly to Anthropic. Don't enable AI on a shared public deployment — anyone using it could read the key.</div>
    </div>`);
}
function saveAi(){
  const apiKey=(document.getElementById('aiKey').value||'').trim();
  if(!apiKey){ toast('Paste an API key'); return; }
  AI.writeConfig({enabled:true, apiKey});
  Sheet.close(); toast('AI write-ups enabled'); render();
}
function disableAi(){
  const cfg=AI.readConfig()||{};
  AI.writeConfig({...cfg, enabled:false});
  Sheet.close(); toast('AI write-ups off'); render();
}

/* ---- settings actions ---- */
function toggleTheme(){
  const cur=document.documentElement.getAttribute('data-theme')||'dark';
  const nxt=cur==='light'?'dark':'light';
  document.documentElement.setAttribute('data-theme',nxt);
  try{localStorage.setItem('dt.theme',nxt)}catch(e){}
  render();
}
function exportData(){
  const blob=new Blob([JSON.stringify(Store.get(),null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='diamondtracker-backup.json'; a.click(); toast('Exported');
}
function wipe(){
  if(confirm('Erase all games and history? This cannot be undone.')){
    localStorage.removeItem('diamondtracker.v1');
    Store.load(); setView('score'); toast('Reset complete');
  }
}

function esc(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

/* ---- expose globals for inline HTML event handlers ----
   Inline on*= attributes run in global scope, so every symbol they
   reference (library modules + UI functions) must be on window. */
Object.assign(window, {
  Store, Engine, Teams, Crest, Field, Standings, Stats, Awards, Schedule, Tournament,
  ord, toast, Sheet, activeView, openTournamentId, setView, act, pendingPlay, smartSuggestion, replayGameRef,
  replayIndex, replayableIndices, openReplay, renderReplay, armPlay, cancelPlay, currentPlayMarkers, onFieldTap, svgPoint, commitPlay,
  showPlaySuggestion, onBaseTap, DRAG_BASES, DRAG_BASE_NAMES, runnerOverlay, dragRunner, startRunnerDrag, nearestBase, promptRunnerOutcome, cancelRunnerDrop,
  resolveRunner, runnerAdvance, runnerSteal, runnerOut, withUndo, addRunUI, fxScorePop, fxHomeRun, undo, finishGame,
  confirmFinish, suggestGameMvp, openMvpPicker, mvpStatLine, setGameMvp, skipMvp, findGameById, generateMvpSummary, joinList, mvpCardHTML,
  teamSelectOptions, openSetup, onRulePreset, ruleSummaryText, onTeamPick, applyLineup, startGame, openRulesInfo, resolveRoster, pickPitcher,
  parseRoster, diamondSVG, renderScore, renderBook, abRow, hasMovement, lineScore, statsMode, statsSeasonId, BAT_CATS,
  PITCH_CATS, fmtStatVal, renderStats, setStatsMode, setStatsSeason, renderAwards, leaderboardCard, openLeaderList, openSeasonManager, createSeason,
  activateSeason, renderHistory, reviewGame, reviewGameObj, renderBookStatic, openBoxScore, boxScoreHTML, boxTotalRow, openTeamId,
  lineupCtx, teamPageId, renderTeams, teamRowCard, posRank, openTeamPage, openTeamPageByName, closeTeamPage, renderTeamPage, playerCard,
  posName, openPlayerCard, statCell, rateCell, TEAM_COLORS, openTeamSheet, logoPreviewHTML, onLogoPick, clearLogo, pickColor,
  saveTeam, deleteTeam, openPlayerSheet, pickHand, savePlayer, deletePlayer, openLineupPicker, newLineup, editLineup, deleteLineup,
  getLineup, renderLineupBuilder, closeLineup, renameLineup, addToLineup, benchPlayer, openPosPicker, setPos, dragState, initLineupDnD,
  startDrag, render, emptyHome, renderHome, appbar, heroCard, firstRunCard, computeLeaders, leaderCard, teamColor,
  fmtPct, escAttr, reviewGameByObj, emptyBook, fmtEventDate, dateGroupLabel, renderTournaments, openTournament, closeTournament, openTournamentSheet,
  pickTnFormat, toggleTnTeam, createTournament, renderBracket, teamChip, matchCard, renderElimBracket, renderRoundRobin, openMatchResult, saveMatchResult,
  clearMatchResult, deleteTournament, renderSchedule, eventCard, openEventSheet, pickEvType, toLocalInput, saveEvent, deleteEvent, openEventDetail,
  rsvp, renderMore, nav, toggleTheme, exportData, wipe, esc,
  Sync, initSync, openSyncSheet, saveSync, disconnectSync,
  AI, aiMvpContext, enhanceMvpSummary, regenerateMvpSummary, openAiSheet, saveAi, disableAi,
  aiRecapContext, enhanceGameRecap, recapBlock,
  Auth, blockedByRole, openAccountSheet, sendMagicLink, signOutNow,
  fanLink, copyFanLink, bootFan, renderFan, dotRow,
});

/* ---- Pull-to-refresh (touch only) ----
   Engages only when the touched .scroll is at the top and the user drags
   down; otherwise native scrolling is untouched. "Refresh" just re-renders
   (data is local), but the gesture makes the app feel native. */
function initPullToRefresh(){
  const THRESH=64, MAX=90;
  let el=null, startY=0, pull=0, armed=false;
  const ptr=document.getElementById('ptr');
  const reset=()=>{
    if(el){ el.style.transition='transform .25s var(--ease-out)'; el.style.transform='';
      const e=el; setTimeout(()=>{ if(e) e.style.transition=''; },260); }
    if(ptr){ ptr.classList.add('snap'); ptr.classList.remove('show','spin'); ptr.style.transform=''; }
    el=null; pull=0; armed=false;
  };
  document.addEventListener('touchstart',e=>{
    if(e.touches.length!==1){ armed=false; return; }
    const sc=e.target.closest && e.target.closest('.scroll');
    if(sc && sc.scrollTop<=0){ el=sc; startY=e.touches[0].clientY; armed=true; pull=0;
      if(ptr) ptr.classList.remove('snap'); }
    else armed=false;
  },{passive:true});
  document.addEventListener('touchmove',e=>{
    if(!armed||!el) return;
    const dy=e.touches[0].clientY-startY;
    if(dy<=0 || el.scrollTop>0){ if(pull>0){ el.style.transform=''; if(ptr) ptr.classList.remove('show'); } pull=0; return; }
    pull=Math.min(dy*0.5, MAX);
    e.preventDefault();                                   // suppress native overscroll while pulling
    el.style.transition=''; el.style.transform=`translateY(${pull}px)`;
    if(ptr){ ptr.classList.add('show'); ptr.style.transform=`translate(-50%,${pull-22}px)`;
      ptr.style.opacity=Math.min(1, pull/THRESH); }
  },{passive:false});
  const end=()=>{
    if(!armed||!el){ return; }
    if(pull>=THRESH){
      if(ptr){ ptr.classList.add('spin'); ptr.style.transform='translate(-50%,18px)'; ptr.style.opacity=1; }
      if(el){ el.style.transition='transform .2s var(--ease-out)'; el.style.transform='translateY(40px)'; }
      navigator.vibrate && navigator.vibrate(10);
      setTimeout(()=>{ render(); reset(); }, 480);        // render() rebuilds the scroll element
    } else { reset(); }
  };
  document.addEventListener('touchend',end,{passive:true});
  document.addEventListener('touchcancel',reset,{passive:true});
}

/* ---- boot ---- */
function registerSW(){
  if('serviceWorker' in navigator){
    // offline app shell; harmless if unsupported or on file://
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  }
}
(function init(){
  registerSW();
  try{ const t=localStorage.getItem('dt.theme'); if(t) document.documentElement.setAttribute('data-theme',t); }catch(e){}
  const params=new URLSearchParams(location.search);
  if(params.get('fan')==='1'){ bootFan(params); return; }   // public read-only viewer
  Store.load();
  Store.sub(()=>render());
  Auth.onChange(()=>render());     // reflect sign-in / role changes in the UI
  render();
  initPullToRefresh();
  // dismiss the branded boot splash once the first paint is up
  const sp=document.getElementById('splash');
  if(sp) setTimeout(()=>{ sp.classList.add('hide'); setTimeout(()=>sp.remove(),460); }, 540);
  // opt-in live sync: connect if the user has configured it (offline-safe)
  initSync();
})();
