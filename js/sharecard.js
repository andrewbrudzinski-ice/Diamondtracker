/* ============================================================
   SHARE CARD — a 1080×1080 result graphic, as a pure SVG string.

   Kept dependency-free and DOM-free so it's unit-testable; app.js
   rasterizes it to PNG (canvas) and hands it to the Web Share API or a
   download. Uses a safe font stack and team-color accents (no embedded
   web fonts/crests) so it rasterizes reliably across browsers.
   ============================================================ */

export const ShareCard = (()=> {
  const esc = s => String(s==null?'':s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  const clip = (s, n=15) => { s=String(s||''); return s.length>n ? s.slice(0,n-1)+'…' : s; };

  // build({away, home, awayRuns, homeRuns, final, date, mvp, awayColor, homeColor})
  function build(o){
    const W=1080, H=1080;
    const aWin = o.awayRuns > o.homeRuns, hWin = o.homeRuns > o.awayRuns;
    const label = o.final ? 'FINAL' : 'LIVE';
    const NUM = "'JetBrains Mono','SF Mono',ui-monospace,monospace";
    const DISP = "'Arial Narrow','Helvetica Neue',Helvetica,Arial,sans-serif";

    const row = (name, runs, color, win, y) => `
      <rect x="80" y="${y}" width="16" height="170" rx="8" fill="${esc(color)}"/>
      <text x="128" y="${y+112}" font-family="${DISP}" font-weight="800" font-size="86"
            letter-spacing="1" fill="${win?'#f3f6fc':'#8a94a8'}">${esc(clip(name).toUpperCase())}</text>
      <text x="1000" y="${y+138}" text-anchor="end" font-family="${NUM}" font-weight="800"
            font-size="160" fill="${win?'#ff6b35':'#f3f6fc'}">${runs}</text>`;

    const mvp = o.mvp ? `
      <text x="${W/2}" y="858" text-anchor="middle" font-family="${DISP}" font-weight="700"
            font-size="38" letter-spacing="2" fill="#ffc94d">★ MVP · ${esc(clip(o.mvp, 26).toUpperCase())}</text>` : '';

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#141925"/><stop offset="1" stop-color="#0a0d14"/>
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="18%" r="60%">
          <stop offset="0" stop-color="rgba(255,107,53,.16)"/><stop offset="1" stop-color="rgba(255,107,53,0)"/>
        </radialGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#bg)"/>
      <rect width="${W}" height="${H}" fill="url(#glow)"/>
      <rect x="${W/2-100}" y="84" width="200" height="60" rx="30"
            fill="${o.final?'#1b2230':'rgba(255,85,102,.14)'}" stroke="${o.final?'#272f3f':'#ff5566'}" stroke-width="2"/>
      <text x="${W/2}" y="124" text-anchor="middle" font-family="${DISP}" font-weight="700"
            font-size="32" letter-spacing="6" fill="${o.final?'#8a94a8':'#ff5566'}">${label}</text>
      ${row(o.away, o.awayRuns, o.awayColor||'#ff6b35', aWin, 300)}
      ${row(o.home, o.homeRuns, o.homeColor||'#4d9fff', hWin, 520)}
      ${mvp}
      <text x="${W/2}" y="968" text-anchor="middle" font-family="${NUM}" font-weight="700"
            font-size="30" letter-spacing="1" fill="#586074">${esc(o.date||'')}</text>
      <text x="${W/2}" y="1016" text-anchor="middle" font-family="${DISP}" font-weight="800"
            font-size="40" letter-spacing="1" fill="#8a94a8">Diamond<tspan fill="#ff6b35">Tracker</tspan></text>
    </svg>`;
  }

  return { build, clip };
})();
