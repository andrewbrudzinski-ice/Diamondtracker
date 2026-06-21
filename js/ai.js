/* ============================================================
   AI WRITE-UPS — Phase D (Anthropic / Claude API).

   Real LLM game-MVP blurbs (and recap/season prompt builders ready
   to wire), calling Claude directly from the browser via fetch — no
   SDK/build step, matching the app's no-backend design. Opt-in and
   offline-first: when unconfigured or on any error, callers fall back
   to the deterministic template (generateMvpSummary in app.js).

   Model: claude-opus-4-8 (current most-capable Opus).

   ⚠️ Browser-side key exposure: calling the Claude API from the page
   requires the user's API key in the client (stored only in
   localStorage, never the repo) and the anthropic-dangerous-direct-
   browser-access header. Fine for a personal key on a self-hosted
   build; a public deploy should proxy through a server (Phase C).
   ============================================================ */

export const AI = (()=> {
  const CFG_KEY = 'dt.ai';
  const API = 'https://api.anthropic.com/v1/messages';
  const MODEL = 'claude-opus-4-8';
  const VERSION = '2023-06-01';

  /* ---- config (API key) — localStorage only, never committed ---- */
  function readConfig(){
    try{ return JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); }catch(e){ return null; }
  }
  function writeConfig(cfg){
    try{ localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }catch(e){ console.warn('AI config save failed',e); }
  }
  function clearConfig(){ try{ localStorage.removeItem(CFG_KEY); }catch(e){} }
  function isConfigured(cfg=readConfig()){ return !!(cfg && cfg.enabled && cfg.apiKey); }

  /* ---- one Claude call over fetch (fetchImpl injectable for tests) ---- */
  async function complete({ system, prompt, maxTokens = 1024 }, fetchImpl = globalThis.fetch){
    const cfg = readConfig();
    if(!isConfigured(cfg)) throw new Error('AI is not configured');
    const res = await fetchImpl(API, {
      method: 'POST',
      headers: {
        'x-api-key': cfg.apiKey,
        'anthropic-version': VERSION,
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if(!res.ok){
      let detail=''; try{ detail = await res.text(); }catch(e){}
      throw new Error(`Claude API ${res.status} ${detail}`.trim());
    }
    const data = await res.json();
    if(data.stop_reason === 'refusal') throw new Error('Claude declined the request');
    const block = (data.content || []).find(b => b.type === 'text');
    return block ? block.text.trim() : '';
  }

  // shared voice for all write-ups
  const SYSTEM = "You are a sharp, vivid sports writer for a rec-league softball/baseball app. " +
    "Write tight, broadcast-style copy with energy but no clichés or hype-speak. " +
    "Plain prose only: no markdown, no headings, no preamble, no quotation marks around the whole thing. " +
    "Use only the facts provided — never invent plays, names, or numbers.";

  /* ---- prompt builders (pure → unit-testable) ---- */
  function mvpPrompt(ctx){
    const result = ctx.won
      ? `${ctx.team} won ${ctx.myRuns}-${ctx.oppRuns} over ${ctx.opponent}`
      : `${ctx.team} ${ctx.tie ? 'tied' : 'fell'} ${ctx.myRuns}-${ctx.oppRuns} ${ctx.tie?'with':'to'} ${ctx.opponent}`;
    return {
      system: SYSTEM,
      prompt: `Write a 2-3 sentence Game MVP write-up.\n` +
        `Player: ${ctx.name}${ctx.num?` (#${ctx.num})`:''}\n` +
        `Team: ${ctx.team}\n` +
        `Stat line: ${ctx.statLine}\n` +
        `Game result: ${result}.\n` +
        `Lead with the player and what they did at the plate; close with the result.`,
      maxTokens: 400,
    };
  }
  async function mvpSummary(ctx, fetchImpl){ return complete(mvpPrompt(ctx), fetchImpl); }

  function recapPrompt(ctx){
    return {
      system: SYSTEM,
      prompt: `Write a 3-4 sentence recap of this game.\n` +
        `Final: ${ctx.away} ${ctx.awayRuns}, ${ctx.home} ${ctx.homeRuns}.\n` +
        (ctx.standouts ? `Standouts: ${ctx.standouts}.\n` : '') +
        `Capture the story of the game from the box score; don't invent specifics.`,
      maxTokens: 500,
    };
  }
  async function gameRecap(ctx, fetchImpl){ return complete(recapPrompt(ctx), fetchImpl); }

  return { CFG_KEY, MODEL, readConfig, writeConfig, clearConfig, isConfigured,
           complete, mvpPrompt, mvpSummary, recapPrompt, gameRecap };
})();
