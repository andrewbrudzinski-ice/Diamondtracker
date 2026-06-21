import { Crest } from './crest.js';

export const Field = (()=>{
  // canonical anchor points (x,y) in the 0..100 field space
  const HOME=[50,86], P1B=[68,68], P2B=[50,58], P3B=[32,68], PSS=[40,60], PSS2=[60,60];
  const MOUND=[50,66];
  // angle from home plate; 0deg = straight to 2B (center), negative=left, positive=right
  function angleDeg(x,y){
    const dx=x-HOME[0], dy=HOME[1]-y; // dy positive going up
    return Math.atan2(dx,dy)*180/Math.PI; // -=left field, +=right field
  }
  function dist(x,y){ const dx=x-HOME[0],dy=HOME[1]-y; return Math.sqrt(dx*dx+dy*dy); }

  // Map a tap to one of 11 named field zones (spec list).
  function zoneFor(x,y){
    const a=angleDeg(x,y), d=dist(x,y);
    // very close to home = catcher
    if(d<8) return {code:'C',name:'Catcher',area:'infield'};
    // pitcher: small zone around the mound (mound ~ d20, a0)
    if(d<22 && Math.abs(a)<16) return {code:'P',name:'Pitcher',area:'infield'};
    // infield radius
    const infield = d<34;
    if(infield){
      if(a<=-30) return {code:'3B',name:'Third Base',area:'infield'};
      if(a<  0)  return {code:'SS',name:'Shortstop',area:'infield'};
      if(a< 30)  return {code:'2B',name:'Second Base',area:'infield'};
      return {code:'1B',name:'First Base',area:'infield'};
    }
    // outfield by angle thirds + gaps
    if(a<=-30) return {code:'LF',name:'Left Field',area:'outfield'};
    if(a<=-12) return {code:'LC',name:'Left Center',area:'outfield'};
    if(a<  12) return {code:'CF',name:'Center Field',area:'outfield'};
    if(a<  30) return {code:'RC',name:'Right Center',area:'outfield'};
    return {code:'RF',name:'Right Field',area:'outfield'};
  }

  // big interactive diamond SVG. opts: {bases, armed, runners, lastHit}
  function bigDiamond(g, opts={}){
    const armed=opts.armed;
    const domRunners=opts.domRunners;  // when true, runner pucks are drawn as HTML overlay
    const baseOn=i=>g.bases[i]!=null && !domRunners;
    const runnerLabel=i=>{ const v=g.bases[i]; return v?Crest.initials(String(v)):''; };
    // grass + dirt
    return `<svg class="bigfield ${armed?'armed':''}" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet"
        ${armed?'onclick="onFieldTap(event,this)"':''}>
      <defs>
        <radialGradient id="grass" cx="50%" cy="80%" r="80%">
          <stop offset="0%" stop-color="#1f6b3a"/><stop offset="100%" stop-color="#16502c"/>
        </radialGradient>
        <radialGradient id="dirt" cx="50%" cy="70%" r="50%">
          <stop offset="0%" stop-color="#9c6035"/><stop offset="100%" stop-color="#7d4a28"/>
        </radialGradient>
      </defs>
      <!-- outfield grass -->
      <path d="M50 86 L4 40 A64 64 0 0 1 96 40 Z" fill="url(#grass)"/>
      <!-- mowing arcs -->
      <path d="M50 86 L18 54 A46 46 0 0 1 82 54 Z" fill="rgba(255,255,255,.04)"/>
      <path d="M50 86 L30 64 A30 30 0 0 1 70 64 Z" fill="rgba(255,255,255,.05)"/>
      <!-- infield dirt -->
      <path d="M50 86 L34 70 A23 23 0 0 1 66 70 Z" fill="url(#dirt)"/>
      <circle cx="50" cy="66" r="6" fill="url(#dirt)"/>
      <!-- base lines -->
      <path d="M50 86 L68 68 M50 86 L32 68" stroke="rgba(255,255,255,.55)" stroke-width="1" fill="none"/>
      <!-- bases -->
    <!-- bases (occupancy always reflected on the bag; runner pucks drawn in overlay when domRunners) -->
    ${bag(68,68, g.bases[0]!=null, baseOn(0), runnerLabel(0), armed?0:null)}
    ${bag(50,58, g.bases[1]!=null, baseOn(1), runnerLabel(1), armed?1:null)}
    ${bag(32,68, g.bases[2]!=null, baseOn(2), runnerLabel(2), armed?2:null)}
      ${plate(50,86)}
      <!-- pitcher's rubber -->
      <rect x="48.5" y="65" width="3" height="1.4" rx=".4" fill="rgba(255,255,255,.7)"/>
      <!-- hit markers (current play arming preview handled in JS) -->
      ${(opts.markers||[]).map(m=>hitMarker(m)).join('')}
      ${armed?`<text x="50" y="50" text-anchor="middle" font-family="Archivo,sans-serif"
        font-size="5" font-weight="800" fill="rgba(255,255,255,.85)" class="tap-hint">TAP WHERE IT LANDED</text>`:''}
    </svg>`;
  }
  function bag(x,y,occupied,showPuck,label,baseIdx){
    const tap = baseIdx!=null ? `onclick="onBaseTap(${baseIdx},event)" style="cursor:pointer"` : '';
    return `<g ${tap}>
      <rect class="fbag ${occupied?'on':''}" x="${x-3.2}" y="${y-3.2}" width="6.4" height="6.4" rx="1"
        transform="rotate(45 ${x} ${y})"/>
      ${showPuck?`<circle cx="${x}" cy="${y}" r="4.6" class="frunner"/>
        <text x="${x}" y="${y+1.6}" text-anchor="middle" font-size="3.4" font-weight="800"
          fill="#0a0d14" font-family="Archivo,sans-serif">${label}</text>`:''}
    </g>`;
  }
  function plate(x,y){
    return `<polygon points="${x-2.4},${y-1} ${x+2.4},${y-1} ${x+2.4},${y+1} ${x},${y+2.6} ${x-2.4},${y+1}"
      fill="#fff" stroke="rgba(0,0,0,.3)" stroke-width=".3"/>`;
  }
  function hitMarker(m){
    const color = m.outType?'#ff5566':(m.color||'#ffc94d');
    const shape = m.bbType==='ground'
      ? `<circle cx="${m.x}" cy="${m.y}" r="2" fill="${color}" stroke="#0a0d14" stroke-width=".5"/>`
      : `<path d="M${m.x} ${m.y-2.4} L${m.x+2.1} ${m.y+1.4} L${m.x-2.1} ${m.y+1.4} Z"
           fill="${color}" stroke="#0a0d14" stroke-width=".5"/>`;
    return `<g class="hit-marker">${shape}</g>`;
  }

  // spray chart: small field with plotted markers from a list of hits
  function sprayChart(hits, opts={}){
    const id='sp'+Math.random().toString(36).slice(2,6);
    const markers = hits.map(h=>hitMarker(h)).join('');
    return `<svg class="spray" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="grass-${id}" cx="50%" cy="80%" r="80%">
          <stop offset="0%" stop-color="#1f6b3a"/><stop offset="100%" stop-color="#16502c"/>
        </radialGradient>
        <radialGradient id="dirt-${id}" cx="50%" cy="70%" r="50%">
          <stop offset="0%" stop-color="#9c6035"/><stop offset="100%" stop-color="#7d4a28"/>
        </radialGradient>
      </defs>
      <path d="M50 86 L4 40 A64 64 0 0 1 96 40 Z" fill="url(#grass-${id})"/>
      <path d="M50 86 L34 70 A23 23 0 0 1 66 70 Z" fill="url(#dirt-${id})"/>
      <path d="M50 86 L68 68 M50 86 L32 68" stroke="rgba(255,255,255,.4)" stroke-width=".8" fill="none"/>
      ${plate(50,86)}
      ${markers}
    </svg>`;
  }

  // base anchor coordinates for runner dots in replay
  const BASE_XY = { 0:[68,68], 1:[50,58], 2:[32,68], 3:[50,86] }; // 3 = home
  function baseXY(i){ return BASE_XY[i]; }

  // Visual replay of a single play: shows ball flight + runner movement.
  // ev needs basesBefore/basesAfter/hx/hy (captured at record time).
  function replayField(ev){
    const id='rp'+Math.random().toString(36).slice(2,6);
    const before=ev.basesBefore||[null,null,null];
    const after=ev.basesAfter||[null,null,null];
    const hx=ev.hx, hy=ev.hy;

    // ball flight line from home plate to landing spot
    const ballPath = (hx!=null&&hy!=null)
      ? `<line x1="50" y1="86" x2="${hx}" y2="${hy}" stroke="#ffc94d" stroke-width="1.1"
           stroke-dasharray="2.5 2" class="ball-flight"/>
         ${hitMarker({x:hx,y:hy,bbType:ev.bbType,outType:ev.type==='out',
           color:ev.type==='out'?'#ff5566':(ev.bases===4?'#ffc94d':'#3ddc84')})}`
      : '';

    // runner movement arrows: for each runner present before, find where they went
    let arrows='', dots='';
    // batter starts at home (index -1 -> shown leaving plate)
    const moves=[];
    // existing runners (0,1,2) -> compare before/after by identity
    before.forEach((who,bi)=>{
      if(who==null) return;
      // find this runner in 'after'
      let dest=after.findIndex(a=>a===who);
      if(dest===-1) dest=3; // scored (or out) -> treat as home if scored
      if(dest!==bi) moves.push({from:bi,to:dest,who});
    });
    // batter: appears in 'after' but not 'before'
    after.forEach((who,ai)=>{
      if(who!=null && !before.includes(who)){
        moves.push({from:'H',to:ai,who,batter:true});
      }
    });

    moves.forEach(m=>{
      const from = m.from==='H'?[50,86]:baseXY(m.from);
      const to = baseXY(m.to);
      arrows+=`<line x1="${from[0]}" y1="${from[1]}" x2="${to[0]}" y2="${to[1]}"
        stroke="${m.batter?'#3ddc84':'#4d9fff'}" stroke-width="1.3" marker-end="url(#arr-${id})"
        class="runner-move" opacity=".9"/>`;
    });
    // dots at AFTER positions (current occupancy)
    after.forEach((who,ai)=>{
      if(who==null) return;
      const xy=baseXY(ai);
      dots+=`<g><circle cx="${xy[0]}" cy="${xy[1]}" r="4.4" fill="#ffc94d" stroke="#0a0d14" stroke-width=".6"/>
        <text x="${xy[0]}" y="${xy[1]+1.5}" text-anchor="middle" font-size="3.2" font-weight="800"
          fill="#0a0d14" font-family="Archivo,sans-serif">${Crest.initials(String(who))}</text></g>`;
    });

    return `<svg class="replay-svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="grass-${id}" cx="50%" cy="80%" r="80%">
          <stop offset="0%" stop-color="#1f6b3a"/><stop offset="100%" stop-color="#16502c"/>
        </radialGradient>
        <radialGradient id="dirt-${id}" cx="50%" cy="70%" r="50%">
          <stop offset="0%" stop-color="#9c6035"/><stop offset="100%" stop-color="#7d4a28"/>
        </radialGradient>
        <marker id="arr-${id}" markerWidth="5" markerHeight="5" refX="3.5" refY="2.5" orient="auto">
          <path d="M0 0 L5 2.5 L0 5 z" fill="#4d9fff"/>
        </marker>
      </defs>
      <path d="M50 86 L4 40 A64 64 0 0 1 96 40 Z" fill="url(#grass-${id})"/>
      <path d="M50 86 L18 54 A46 46 0 0 1 82 54 Z" fill="rgba(255,255,255,.04)"/>
      <path d="M50 86 L34 70 A23 23 0 0 1 66 70 Z" fill="url(#dirt-${id})"/>
      <path d="M50 86 L68 68 L50 58 L32 68 Z" fill="none" stroke="rgba(255,255,255,.45)" stroke-width=".7"/>
      ${['0','1','2'].map(i=>{const xy=baseXY(+i);
        return `<rect x="${xy[0]-2.6}" y="${xy[1]-2.6}" width="5.2" height="5.2" rx=".8"
          transform="rotate(45 ${xy[0]} ${xy[1]})" fill="rgba(255,255,255,.25)" stroke="rgba(255,255,255,.6)" stroke-width=".6"/>`;
      }).join('')}
      ${plate(50,86)}
      ${ballPath}
      ${arrows}
      ${dots}
    </svg>`;
  }

  return { zoneFor, bigDiamond, sprayChart, replayField, angleDeg, dist, HOME, baseXY };
})();

/* ============================================================
   STANDINGS / LEADERS — derived from saved game history.
   Matches teams by name (until session-stats wires player ids
   into the live game). Good enough to make the dashboard real.
   ============================================================ */
