/**
 * PF2e HUD — raise the Persistent HUD shortcut "slots" cap.
 *
 * pf2e-hud's Persistent HUD slot framework is fully dynamic (total = 18 + slots),
 * so the only thing limiting you is the settings slider's max (default 20).
 * Raising range.max is all that's needed; slots beyond 20 "just work".
 *
 * Requires: pf2e-hud. Per-user setting, so each player sets their own slider.
 * No-ops quietly if pf2e-hud isn't present.
 */

const SLOTS_MAX = 50; // raise to taste; keep it even (the slider steps by 2)

Hooks.once("ready", () => {
  const cfg = game.settings.settings.get("pf2e-hud.persistent.slots");
  if (cfg?.range) cfg.range.max = SLOTS_MAX;
});
