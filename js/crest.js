import { Store } from './storage.js';

export const Crest = (()=>{
  function initials(name){
    const words=String(name||'').trim().split(/\s+/).filter(Boolean);
    if(!words.length) return '??';
    if(words.length===1) return words[0].slice(0,2).toUpperCase();
    return (words[0][0]+words[words.length-1][0]).toUpperCase();
  }
  // darken/lighten a hex for gradients
  function shade(hex,pct){
    const n=parseInt(hex.slice(1),16);
    let r=(n>>16)&255,g=(n>>8)&255,b=n&255;
    r=Math.max(0,Math.min(255,Math.round(r+(pct<0?r:255-r)*pct)));
    g=Math.max(0,Math.min(255,Math.round(g+(pct<0?g:255-g)*pct)));
    b=Math.max(0,Math.min(255,Math.round(b+(pct<0?b:255-b)*pct)));
    return '#'+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1);
  }
  function readable(hex){
    const n=parseInt(hex.slice(1),16);
    const r=(n>>16)&255,g=(n>>8)&255,b=n&255;
    return (0.299*r+0.587*g+0.114*b)>150 ? '#0a0d14':'#ffffff';
  }
  // shield crest with monogram
  // look up a team's uploaded logo (base64 data URL) by name, if any
  function logoFor(name){
    try{
      const t=(Store.get().teams||[]).find(t=>t.name===name);
      return t&&t.logo ? t.logo : null;
    }catch(e){ return null; }
  }
  function team(name,color,size){
    const id='c'+Math.random().toString(36).slice(2,7);
    const c2=shade(color,-0.35), txt=readable(color);
    const mono=initials(name);
    const logo=logoFor(name);
    // logo path: clip an uploaded image into the shield silhouette
    if(logo){
      return `<svg class="crest" width="${size}" height="${size}" viewBox="0 0 100 110" aria-hidden="true">
        <defs><clipPath id="${id}">
          <path d="M50 2 L94 16 V58 C94 84 74 100 50 108 C26 100 6 84 6 58 V16 Z"/>
        </clipPath></defs>
        <path d="M50 2 L94 16 V58 C94 84 74 100 50 108 C26 100 6 84 6 58 V16 Z"
          fill="${shade(color,-.4)}"/>
        <image href="${logo}" x="3" y="3" width="94" height="104"
          clip-path="url(#${id})" preserveAspectRatio="xMidYMid slice"/>
        <path d="M50 2 L94 16 V58 C94 84 74 100 50 108 C26 100 6 84 6 58 V16 Z"
          fill="none" stroke="${shade(color,.25)}" stroke-width="2"/>
      </svg>`;
    }
    return `<svg class="crest" width="${size}" height="${size}" viewBox="0 0 100 110" aria-hidden="true">
      <defs>
        <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${shade(color,.12)}"/>
          <stop offset="1" stop-color="${c2}"/>
        </linearGradient>
      </defs>
      <path d="M50 2 L94 16 V58 C94 84 74 100 50 108 C26 100 6 84 6 58 V16 Z"
        fill="url(#${id})" stroke="${shade(color,.25)}" stroke-width="2"/>
      <path d="M50 2 L94 16 V58 C94 84 74 100 50 108 C26 100 6 84 6 58 V16 Z"
        fill="none" stroke="rgba(255,255,255,.15)" stroke-width="1" transform="scale(.92) translate(4.3,4.5)"/>
      <text x="50" y="62" text-anchor="middle" font-family="Archivo,sans-serif"
        font-weight="900" font-size="42" fill="${txt}" letter-spacing="-1">${mono}</text>
    </svg>`;
  }
  // round player avatar with number (showNum=false centers initials only)
  function player(name,num,color,showNum=true){
    const id='a'+Math.random().toString(36).slice(2,7);
    const txt=readable(color);
    const mono=initials(name);
    const numText = (showNum&&num)
      ? `<text x="50" y="74" text-anchor="middle" font-family="JetBrains Mono,monospace"
           font-weight="800" font-size="20" fill="${txt}" opacity=".85">#${num}</text>`
      : '';
    const initY = (showNum&&num) ? 46 : 62;  // center initials when no number shown
    return `<svg class="avatar-svg" width="100%" height="100%" viewBox="0 0 100 100" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${shade(color,.18)}"/>
        <stop offset="1" stop-color="${shade(color,-.3)}"/>
      </linearGradient></defs>
      <circle cx="50" cy="50" r="48" fill="url(#${id})" stroke="${shade(color,.3)}" stroke-width="2"/>
      <text x="50" y="${initY}" text-anchor="middle" font-family="Archivo,sans-serif"
        font-weight="800" font-size="${(showNum&&num)?30:38}" fill="${txt}" dominant-baseline="${(showNum&&num)?'auto':'middle'}">${mono}</text>
      ${numText}
    </svg>`;
  }
  return { team, player, initials, shade, readable };
})();

/* ============================================================
   FIELD — geometry, zone detection, interactive diamond,
   and spray-chart rendering. Coordinate space is 0..100 on
   both axes; home plate sits bottom-center, outfield up top.
   ============================================================ */
