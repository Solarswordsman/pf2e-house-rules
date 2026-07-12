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
- Git commit attribution trailer: `Agentic - Using Claude <ModelName> <MajorVersion>` — e.g. `Agentic - Using Claude Fable 5` (human-readable model name + major version, never the raw model ID). Also configured in `.claude/settings.json` under `attribution`.

## Current tweaks — load-bearing facts

**`scripts/toolbelt-set-targets.js`** — players push their targets onto a Toolbelt Target Helper card.
- Chat-message flag writes need author/GM permission, so players emit a socket and the **active GM** writes (`game.toolbelt.api.targetHelper.setMessageFlagTargets({}, uuids)`; flag path `flags.pf2e-toolbelt.targetHelper.targets`, an array of Token document UUIDs). A GM must be online.
- v14 chat render hook is `renderChatMessageHTML` (`html` is an `HTMLElement`, not jQuery). Toolbelt renders its buttons asynchronously, so injection is deferred via `requestAnimationFrame` with a bounded retry.
- The injected button must live inside `.dice-result .dice-total` (or Toolbelt's existing `.pf2e-toolbelt-target-buttons` wrapper). That CSS is `position: absolute` anchored to the total bar; injected anywhere else it renders off-card.

**`scripts/pf2e-hud-slots.js`** — raise the Persistent HUD shortcut-slot cap.
- Setting key `pf2e-hud.persistent.slots` (per-user, step 2). Total slots = `18 + slots`. The framework (render loop, template, `grid-auto-flow: column` CSS) is fully dynamic; only the slider's `range.max` caps it. Bump `game.settings.settings.get("pf2e-hud.persistent.slots").range.max` on the `ready` hook, before the settings window is opened.

**`scripts/ap-journal-styles.js`** (+ `styles/ap-journal-styles.css`) — author Metamorphic AP journal blocks from the rich-text editor.
- Adds an "Adventure Path" submenu to the ProseMirror Format dropdown via the `getProseMirrorMenuDropDowns` hook (same mechanism the PF2e system uses; see their `src/scripts/hooks/get-prosemirror-menu-dropdowns.ts` for the canonical pattern).
- **Classes must go in the node's `_preserve` attr** (`attrs: { _preserve: { class: "read-aloud" } }`) — that's Foundry's attribute-capture channel; a bare `class` attr is stripped by the schema on save. Scaffold HTML is parsed with `foundry.prosemirror.dom.parseString` against the editor schema so inserted content round-trips identically to loaded content.
- Metamorphic markup vocabulary (extracted from the real Season of Ghosts packs): `p.read-aloud`; `section.encounter > div.header > (img + h2.split.no-toc > span.keepme×2 + span.link)` — the second `keepme` span is the right-aligned severity; `aside.sidebar` / `aside.float-right`; `section.action` + `ul.traits > li.trait`; `section.advancement-track` with `span.level`; utility classes `no-toc`, `no-indent`, `split`, `keepme`, `float-left/right`. Their CSS is tag-sensitive (`aside.sidebar`, not `.sidebar`) and scoped to their sheet's wrapper class (e.g. `.seasonofghosts-wrapper`), which is why the editor shows nothing — our CSS adds neutral editor-only affordances, all scoped under `.ProseMirror`.
- `reference/` holds the Season of Ghosts basis pack + first AP for inspection; it is not shipped (the release zip packs only `scripts`/`styles`). Journal HTML lives inside LevelDB packs: read with `classic-level` on a **copy** of the pack dir (never the original — opening takes the LOCK); documents sit at `adventure.journal[].pages[].text.content`.

**`scripts/expressions-inserter.js`** — dialog for building inline `@Check`/`@Damage`/`@Template`/`[[/act]]`/`[[/r]]` expressions.
- Param surface verified against system source `src/module/system/text-editor.ts` (`#createCheck`/`#createDamageRoll`): type lists are comma-joined, numeric adjustments get baked into `dc:`, `against:`/`defense:` excludes `dc:`. DC tables mirror `src/module/dc.ts` (PWOL-aware) and are embedded as data.
- Foundry keybindings **don't fire while a text field/editor has focus**, so the in-editor hotkey is a capture-phase `keydown` listener; the registered keybinding covers the out-of-editor (clipboard) case. No double-fire possible.
- EditorViews are captured from `menu.view` in `getProseMirrorMenuDropDowns` (WeakMap keyed on `view.dom`) — there's no reliable public path from a `.ProseMirror` DOM node back to its view. Insertion is `view.state.tr.insertText(...)`; enrichers run on render, so plain text is correct.
- Exports `levelBasedDC`/`partyLevel` etc.; `infiltration-builder.js` imports them (relative ESM imports work between `esmodules` entries).
- AppV2 gotcha (applies to all three builders): `this.element` persists across re-renders — attach delegated listeners to elements *inside* the re-rendered content (the `form`), never to `this.element`, or they stack.

**`scripts/hazard-builder.js`** — GM Core "Building Hazards" tables 2-13…2-16 embedded; creates a Hazard actor.
- Schema verified against `packs/pf2e/hazards`: `attributes.stealth.value` is the **modifier** (DC − 10) for simple *and* complex hazards; min-proficiency rank goes in `stealth.details`. `disable`/`routine`/`reset` are HTML under `system.details`. Strikes are `melee` items (`bonus.value`, `damageRolls` record keyed by random id); trigger/effect is an `action` item with `actionType.value: "reaction"`. `hasHealth: false` suppresses AC/saves/HP.
- `fa.*` is a pf2e-internal alias, not a Foundry global — use `foundry.applications.ux.FormDataExtended` etc.

**`scripts/infiltration-builder.js`** — GM Core Infiltration subsystem → multi-page journal entry.
- Rules basis: crit/success = 2/1 IP, fail/crit-fail = 1/2 AP, +1 AP per round; failure ceiling 2× total IP with thresholds at ~25/50/75/100%. Standard/hard/very-hard DCs = level-based DC +0/+2/+5.
- Preparation-activity compendium IDs were lifted from the system's GM-screen journal pack (`pf2e.actionspf2e`). Condition links resolve IDs at runtime from the `pf2e.conditionitems` index (name match), falling back to plain text.

**`scripts/crafting-formula-search.js`** (+ `styles/crafting-formula-search.css`) — search bar filtering the Crafting tab's Known Formulas list.
- Hook is `renderCharacterSheetPF2e`; the sheet is still AppV1 on pf2e master, so `html` may be jQuery — normalize (`html instanceof HTMLElement ? html : html[0]`) before querying.
- DOM contract (system `tabs/crafting.hbs`): `section.known-formulas > header + ol.formula-list`; rows are `li.formula-item[data-formula-lvl]` with the name in `h4.name`, level headers `li.formula-level-header[data-level]`. Headers hide when no row of their level matches.
- The sheet re-renders wholesale on any actor update, wiping the input — the query is kept in a `WeakMap` keyed by sheet instance and re-applied each render. The system's own inventory search uses Foundry's `SearchFilter` + MiniSearch; a substring filter is deliberate simplification.

**`scripts/compendium-browser-filters.js`** — extra Compendium Browser filters (Equipment: Other Tags + Usage; Feats: Dedication prerequisite).
- The v14 browser filters generically: each result carries an `options: Set<"prefix:value">`, `buildPredicate()` iterates **all** of `filterData.checkboxes` (predicate prefix is `optionPrefix ?? groupKey`), and the Svelte sidebar renders every checkbox group it finds — injected groups need zero UI/filter plumbing.
- Integration point: wrap each tab instance's `loadData` (instances at `game.pf2e.compendiumBrowser.tabs.*`, created in the system's `ready` hook, which runs before module `ready` hooks). Enrichment must happen inside the wrapper: `init()` builds the MiniSearch engine (its `storeFields` already include `options`) and snapshots `defaultFilterData` *after* `loadData`, so text search and filter reset pick up the additions for free.
- Extra data is a supplemental `pack.getIndex({fields})` pass over `browser.loadedPacks(tabName)`, merged by UUID: `system.traits.otherTags`, `system.usage.value` (empty string = carried; kits have no usage), `system.prerequisites.value` (free text; dedications extracted via `/([A-Z][^,;.()]*?)\s+Dedication\b/`). Labels from `CONFIG.PF2E.usages` and `CONFIG.PF2E.other{Armor,Consumable,Weapon}Tags`, falling back to title-cased slug.

**`scripts/trick-magic-daily.js`** (+ `styles/trick-magic-daily.css`) — house rule: Trick Magic Item during daily preparations, tricked items work check-free until the next prep.
- Registered as a pf2e-dailies custom daily on `ready` (`game.modules.get("pf2e-dailies").api.registerCustomDailies`); condition-based (feat slug `trick-magic-item` + ≥1 trickable item), so no compendium UUIDs involved. Row slugs are item ids; `save: true` persists skill picks; `empty: true` = skip.
- "Trickable" mirrors the system gate in `consumable/document.ts`: category wand/scroll/spell-gem with `system.spell` that fails `actor.spellcasting.canCastConsumable`. Skills/DC mirror `calculateTrickMagicItemCheckDC` (tradition traits → skill, level-based DC; reuses `levelBasedDC` from `expressions-inserter.js` + a world-setting adjustment).
- Success mechanism: `canCastConsumable` passes if any **prepared/spontaneous** entry `canCast` the spell (innate is explicitly excluded when an origin item is involved; match is `tradition || spell in list`). So success adds a temp 0-slot **spontaneous** entry (`proficiencySlug` = the skill) + spell copies wired in via the `flags.pf2e-dailies.identifier` mechanism (same as its Staves daily). dailies auto-deletes temp items at next rest; our `rest` callback clears `flags.pf2e-house-rules.tricked` on items. `process` wipes stale entries/flags first, so re-prepping never stacks.
- Known leak (documented in README): while an entry exists, *any* consumable of that tradition casts check-free — the system gates per entry, not per item. Strict per-item gating would need an empty-tradition entry (match falls through to spell-list slug) — untested, revisit if needed.

## Adding a tweak

New file in `scripts/`, add it to `esmodules` in `module.json`, document it in `README.md`. Guard for missing dependencies so the module stays safe to run regardless of what's installed.
