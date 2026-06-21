/* ============================================================
   TEST ENVIRONMENT SHIM
   The app runs in a browser; the library modules expect a couple
   of browser globals (localStorage above all). This installs a
   minimal in-memory stand-in so the ES modules can be imported and
   exercised under `node --test` with no DOM and no network.

   Import this module FIRST in every test file. Importing it has the
   side effect of installing the globals, so they exist before any
   Store.load() runs.
   ============================================================ */
import { Store } from '../../js/storage.js';

// ---- in-memory localStorage ----------------------------------
function installLocalStorage(){
  const map = new Map();
  globalThis.localStorage = {
    getItem(k){ return map.has(k) ? map.get(k) : null; },
    setItem(k, v){ map.set(k, String(v)); },
    removeItem(k){ map.delete(k); },
    clear(){ map.clear(); },
    key(i){ return [...map.keys()][i] ?? null; },
    get length(){ return map.size; },
  };
  return globalThis.localStorage;
}

if(!globalThis.localStorage) installLocalStorage();

// A couple of no-op globals a few modules may touch defensively.
if(!globalThis.console) globalThis.console = { warn(){}, log(){}, error(){} };

/* Reset Store to a clean default state for a single test.
   Clears persisted storage, then loads (which seeds defaultState).
   Returns the live state object you can mutate directly. */
export function freshStore(){
  globalThis.localStorage.clear();
  return Store.load();
}

/* Seed the live Store state with the given partial state and persist it.
   Pass e.g. { teams:[...], history:[...] }. Anything omitted keeps the
   default. Returns the live state. */
export function seedState(partial){
  const s = freshStore();
  Object.assign(s, partial);
  Store.commit();
  return s;
}

export { Store };
