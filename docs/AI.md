# AI Write-ups (Phase D)

Generate vivid **Game MVP recaps** with Claude instead of the built-in template.
**Optional and offline-first** — with no key set, the app uses deterministic
template write-ups and works exactly as before. The model is **`claude-opus-4-8`**.

## How it works

- When you pick a Game MVP, the app immediately shows a template write-up, then
  (if AI is enabled) calls Claude in the background and swaps in the generated
  recap, tagged **✨ AI**. Any failure silently keeps the template.
- The call goes **directly from the browser** to the Anthropic API via `fetch`
  (no SDK, no build step), using the `anthropic-dangerous-direct-browser-access`
  header. Generated recaps are cached on the game so they aren't re-generated
  (or re-billed) on every render.

## Setup

1. Create an API key at <https://console.anthropic.com> (**Settings → API Keys**).
2. In the app → **More → ✨ AI Write-ups**, paste the key and enable.
3. Pick a Game MVP (or tap **✨ Regenerate** on an existing MVP card) — the recap
   is written by Claude.

The key is stored only in that browser's `localStorage` (key `dt.ai`) — **never
committed to the repo**.

## ⚠️ Security — client-side key exposure

The API key lives in the browser and is sent directly to Anthropic. That's fine
for a **personal key on your own/self-hosted build**, but **do not enable AI on a
shared public deployment** (e.g. a public GitHub Pages site) — anyone using the
page could read the key from `localStorage` or network traffic. The proper fix is
to proxy Claude calls through a small server that holds the key, which lands with
accounts/roles in **Phase C**.

## For developers

- Module: [`js/ai.js`](../js/ai.js) — `AI.complete({system, prompt, maxTokens}, fetch?)`
  is the single Claude call (model `claude-opus-4-8`, `max_tokens` per request,
  refusal-aware). `fetch` is injectable so the logic is unit-tested with a mock in
  `tests/ai.test.js` (no network). Prompt builders `AI.mvpPrompt` / `AI.recapPrompt`
  are pure; `AI.mvpSummary` / `AI.gameRecap` wrap them.
- Wiring: `js/app.js` — `setGameMvp()` writes the template synchronously, then
  `enhanceMvpSummary()` upgrades it async via `Store.commit()` + re-render.
  `aiMvpContext()` extracts the fact context from the box score.
- **Recap / season-story prompt builders exist (`recapPrompt`/`gameRecap`) and are
  tested, but only MVP write-ups are wired into the UI so far** — wiring a
  "Generate recap" button on the box score / season views is a small follow-up.
