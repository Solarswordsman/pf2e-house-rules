/**
 * Navigation Guard — stop accidental mouse back/forward navigation from
 * dropping you out of the game (e.g. the thumb buttons in Foundry
 * Lightweight Client / any Chromium browser).
 *
 * Two layers:
 *
 * 1. History sentinel trap. A dummy same-document history entry is pushed on
 *    load; the back button then pops that entry (a same-document navigation —
 *    no unload, no prompt, nothing visible) and the popstate handler re-arms
 *    the sentinel. Mouse-back becomes a no-op. This is the primary defense —
 *    browsers can't bypass it because nothing ever tries to leave the page.
 *
 * 2. beforeunload prompt (toggleable, on by default) as a backstop for real
 *    unloads: closing the tab/window, Ctrl+W, F5. Browsers only show the
 *    confirmation dialog after the user has interacted with the page, which
 *    is always true mid-session.
 */

const MODULE_ID = "pf2e-house-rules";
const SETTING = "navGuardPrompt";
const SENTINEL = `${MODULE_ID}.nav-guard`;

function armSentinel() {
  history.pushState({ [SENTINEL]: true }, "");
}

armSentinel();
window.addEventListener("popstate", (event) => {
  // Any pop means a back/forward navigation landed on (or left) our
  // sentinel; re-arm so the next back press is swallowed too.
  if (!event.state?.[SENTINEL]) armSentinel();
});

window.addEventListener("beforeunload", (event) => {
  let prompt = true;
  try {
    prompt = game.settings.get(MODULE_ID, SETTING);
  } catch {
    // Setting not registered yet (unload before init) — fail safe, prompt.
  }
  if (!prompt) return;
  event.preventDefault();
  event.returnValue = "";
});

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, SETTING, {
    name: "Navigation Guard: confirm before leaving",
    hint: "Show the browser's \"Leave site?\" confirmation when closing or reloading the game tab. The mouse back/forward buttons are always neutralized regardless of this setting.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });
});
