# CLAUDE.md

Context for working on this repo with Claude Code.

## What this is

A personal Foundry VTT module bundling small PF2e home-game tweaks. Each tweak is one self-contained ES module under `scripts/`, listed in `module.json`'s `esmodules`. Keep new tweaks small, dependency-guarded, and documented in `README.md`.

## Environment

- Foundry VTT **v14**, Pathfinder 2e system. Self-hosted (shell access to the server).
- API docs: https://foundryvtt.com/api (select v14). **Verify anything version-sensitive there** — hook names, document schema fields, and APIs shift between major versions, and training data is often stale.
- Related modules are by reonZ, written in TypeScript and shipped as **minified** bundles. Read their TS source for behavior; don't try to parse the built JS.
  - pf2e-toolbelt — https://github.com/reonZ/pf2e-toolbelt
  - pf2e-hud — https://github.com/reonZ/pf2e-hud
  - PF2e system source — https://github.com/foundryvtt/pf2e (rule elements live under `packs/`)

## Conventions / guardrails

- `MODULE_ID` in scripts must equal `id` in `module.json`. The set-targets socket channel is `module.<id>` and only works if they match and `"socket": true` is in the manifest.
- Prefer hooking public APIs and document flags over copying module internals.
- Mind setting **scope**: `user` settings are per-player; `world`/`client` differ. Per-user features must load on every client.
- Dev loop: edit a script → F5 in-game; edit the manifest → restart the server. Enable the module for the world.

## Current tweaks — load-bearing facts

**`scripts/toolbelt-set-targets.js`** — players push their targets onto a Toolbelt Target Helper card.
- Chat-message flag writes need author/GM permission, so players emit a socket and the **active GM** writes (`game.toolbelt.api.targetHelper.setMessageFlagTargets({}, uuids)`; flag path `flags.pf2e-toolbelt.targetHelper.targets`, an array of Token document UUIDs). A GM must be online.
- v14 chat render hook is `renderChatMessageHTML` (`html` is an `HTMLElement`, not jQuery). Toolbelt renders its buttons asynchronously, so injection is deferred via `requestAnimationFrame` with a bounded retry.
- The injected button must live inside `.dice-result .dice-total` (or Toolbelt's existing `.pf2e-toolbelt-target-buttons` wrapper). That CSS is `position: absolute` anchored to the total bar; injected anywhere else it renders off-card.

**`scripts/pf2e-hud-slots.js`** — raise the Persistent HUD shortcut-slot cap.
- Setting key `pf2e-hud.persistent.slots` (per-user, step 2). Total slots = `18 + slots`. The framework (render loop, template, `grid-auto-flow: column` CSS) is fully dynamic; only the slider's `range.max` caps it. Bump `game.settings.settings.get("pf2e-hud.persistent.slots").range.max` on the `ready` hook, before the settings window is opened.

## Adding a tweak

New file in `scripts/`, add it to `esmodules` in `module.json`, document it in `README.md`. Guard for missing dependencies so the module stays safe to run regardless of what's installed.
