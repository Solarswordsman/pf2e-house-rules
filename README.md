# PF2e House Rules

A small Foundry VTT module collecting personal tweaks for our Pathfinder 2e home game. Each tweak is a self-contained script under `scripts/` — add or remove them freely.

- **Foundry:** v14
- **System:** Pathfinder 2e

## Layout

```
pf2e-house-rules/
├── module.json
├── README.md
├── CLAUDE.md
├── scripts/
│   ├── toolbelt-set-targets.js
│   ├── pf2e-hud-slots.js
│   ├── ap-journal-styles.js
│   ├── expressions-inserter.js
│   ├── hazard-builder.js
│   ├── infiltration-builder.js
│   ├── crafting-formula-search.js
│   ├── compendium-browser-filters.js
│   ├── trick-magic-daily.js
│   ├── region-teleport-follow.js
│   ├── scene-levels-composer.js
│   ├── level-alpha-mask.js
│   └── navigation-guard.js
└── styles/
    ├── ap-journal-styles.css
    ├── builder-tools.css
    ├── crafting-formula-search.css
    ├── sog-journal-header.css
    └── trick-magic-daily.css
```

## Install

**Recommended — by manifest URL.** In Foundry, open *Add-on Modules → Install Module* and paste:

```
https://github.com/Solarswordsman/pf2e-house-rules/releases/latest/download/module.json
```

Foundry downloads the latest release and re-checks that URL on every world load, so new versions install themselves. Then enable it in **Manage Modules** **for everyone** — both tweaks are per-user or use a GM relay, so every client should load it.

> Foundry only pulls modules to the **server**. Players get updated code on their next reconnect.

**Manual fallback (local dev).** Copy this folder into your Foundry `Data/modules/` directory; the folder name must match the `id` in `module.json` (default `pf2e-house-rules`). Handy while iterating on a tweak before cutting a release. Then enable it as above.

> **Renaming the module?** Change `id` in `module.json` **and** the `MODULE_ID` constant in `scripts/toolbelt-set-targets.js` so they match. The player→GM socket channel is `module.<id>`, and it only works if they agree and `"socket": true` stays in the manifest. (Update the `manifest`/`download`/`url` paths too.)

## Tweaks

### 1. Toolbelt Player Set-Targets — `scripts/toolbelt-set-targets.js`

Lets a **player** set the targets on a PF2e Toolbelt "Target Helper" damage/spell/area card, even when the GM forgot to set them before rolling.

- **Use:** select your token(s) as targets, then either press **Shift+Alt+T** (rebindable in *Configure Controls*) to push them onto the most recent Target Helper card, or click the bullseye button now shown on the card itself to target that specific card.
- **Requires:** [pf2e-toolbelt](https://github.com/reonZ/pf2e-toolbelt) with Target Helper enabled, and **a GM online**.

**Why it's built this way:** updating a chat message's flags requires being the message's author or a GM, so a non-owner player can't write directly. The player emits a socket and whichever GM is the *active* GM performs the write on their behalf (via Toolbelt's own `setMessageFlagTargets` API). That relay is why the manifest sets `"socket": true`. The on-card button is injected into the dice-total bar, where Toolbelt absolutely-positions its own buttons — injected anywhere else it renders off-card. Because Toolbelt builds its buttons asynchronously, injection is deferred a frame with a short retry.

### 2. PF2e HUD slot cap — `scripts/pf2e-hud-slots.js`

Raises the maximum **additional shortcut slots** on the PF2e HUD Persistent HUD beyond the built-in cap of 20.

- **Use:** the setting's slider now goes up to `SLOTS_MAX` (default 30). Each player sets their own value in module settings. Edit `SLOTS_MAX` to go higher — keep it even, since the slider steps by 2.
- **Requires:** [pf2e-hud](https://github.com/reonZ/pf2e-hud).

**Why it's safe:** pf2e-hud's slot framework is fully dynamic (total slots = `18 + setting`; the render loop, template, and `grid-auto-flow: column` CSS all scale automatically). The only real limit is the settings slider's `range.max`, so we just raise that bound and the rest follows.

### 3. AP Journal Styles — `scripts/ap-journal-styles.js` + `styles/ap-journal-styles.css`

Makes it practical to author the rich journal blocks used by the Metamorphic/Paizo Adventure Path modules (read-aloud boxes, encounter boxes, sidebars, action blocks, traits, advancement tracks) from the rich-text editor, instead of hand-writing HTML in code view.

- **Use:** in any ProseMirror editor, open the **Format ▾** dropdown → **Adventure Path**. Toggles flip a class on the current block (Read Aloud, No Indent, No TOC, Float Left/Right); the rest insert a ready-made scaffold at the cursor (Encounter Box, Sidebar, Action Block, Traits List, Advancement Track, Chapter Heading) whose placeholder text you then replace.
- **Requires:** nothing. The blocks only *render* with AP styling inside a Metamorphic AP module's journal sheet, but authoring the markup works anywhere, and the editor shows each block with a neutral outline + label so the structure is visible while editing.

**Why it's built this way:** the AP modules style plain classed HTML (`<p class="read-aloud">`, `<section class="encounter">`, …), scoped to their own journal sheet, so the editor shows none of it. This tweak plugs into the same `getProseMirrorMenuDropDowns` hook the PF2e system uses for its own styles. Classes are written into the node's `_preserve` attribute — Foundry's attribute-capture channel — because a plain `class` attribute would be stripped by the ProseMirror schema on save. Scaffolds are parsed through Foundry's own schema so they round-trip identically to hand-written markup. The CSS is scoped entirely under `.ProseMirror`, so journal view mode is untouched.

### 4. PF2e Expressions Inserter — `scripts/expressions-inserter.js`

Quick-Insert-style dialog that builds PF2e inline expressions — `@Check[...]`, `@Damage[...]`, `@Template[...]`, `[[/act ...]]`, `[[/r ...]]` — so you never have to remember the syntax.

- **Use:** press **Ctrl+Shift+K** (rebindable in *Configure Controls*) or use **Format ▾ → PF2e Expression…** in any rich-text editor. Pick a tab (Check / Damage / Template / Action / Roll), click options, watch the live preview (both the raw string and the rendered roll button), then **Insert**. If a ProseMirror editor was focused the expression lands at the cursor; otherwise it's copied to the clipboard. You can also send any expression straight to chat.
- **Checks:** statistics are clickable chips (Perception, saves, all skills, flat checks, plus free-text lores). The DC defaults to the **level-based DC for the current party level** and can be switched to a static number or a simple DC, with easy/hard adjustments — all still editable by hand. Advanced options cover `basic`, `secret`, action traits (with autocomplete from the system's actions compendium), `against:` defenses, `showDC`, `immutable`, and more.
- **Requires:** the PF2e system (quietly no-ops elsewhere).

**Why it's built this way:** the parameter surface was verified against the system's inline enricher (`text-editor.ts`) rather than the wiki, and the DC math mirrors the system's `dc.ts` (including Proficiency Without Level). Foundry keybindings don't fire while a text editor has focus, so a capture-phase key listener handles the hotkey inside ProseMirror; editor views are captured from the same menu hook the AP styles tweak uses.

### 5. Hazard Builder — `scripts/hazard-builder.js`

Builds a complete, ready-to-play **Hazard actor** instead of an empty shell, using the GM Core "Building Hazards" tables.

- **Use:** click **Build Hazard** in the Actors directory footer (GM only). Pick a level (defaults to party level), simple or complex, then a role — extreme / high / low — for each statistic (Stealth, Disable, AC, saves). Attack bonus, damage expression, and save DCs are pre-filled from the tables for the chosen level and complexity; every number stays editable before you hit create. Choose a Strike or a save-vs-damage effect, fill in trigger/description/reset (and a routine for complex hazards), and the finished actor opens for normal sheet editing.
- **Output details:** the disable line and the trigger/effect reaction come with working inline `@Check`/`@Damage` buttons; Stealth stores the modifier with the minimum-proficiency rank annotated, exactly like published hazards.
- **Requires:** the PF2e system, GM role.

### 6. Infiltration Builder — `scripts/infiltration-builder.js`

Interactive builder for **GM Core Infiltration subsystem** challenges — or anything infiltration-shaped (multi-phase skill challenges with escalating tension).

- **Use:** click **Build Infiltration** in the Journal directory footer (GM only). Add objectives; under each, add obstacles with one or more skill/save options (each at standard / hard / very hard DCs computed from the party level), Infiltration Point costs (group or per-PC), and failure consequences (free text, damage, and/or a condition). Add complications and opportunities, optionally include the standard preparation activities (Edge Points), and create.
- **Output:** a multi-page journal entry — overview with the point economy and an **Awareness Point threshold table** (failure at 2× total IP, per GM Core), one page per objective with live `@Check`/`@Damage` buttons, complications & opportunities, and preparation activities linked to the system compendium. It's all plain journal text afterward, so edit freely.
- **Requires:** the PF2e system, GM role.

### 7. Season of Ghosts journal header — `styles/sog-journal-header.css`

CSS-only restyle of the Metamorphic **Season of Ghosts** journal windows. Their v14 build split the terra-cotta tile strip out of the titlebar into a decorative frame floating above the drag handle and window controls. This puts the tiles back as the header background and removes the floating top strip (the candle ledge along the bottom is kept).

- **Requires:** the `pf2e-ap196-199-season-of-ghosts` basis pack (selectors are inert without it).

### 8. Crafting Formula Search — `scripts/crafting-formula-search.js` + `styles/crafting-formula-search.css`

Adds a search bar to the character sheet's **Crafting** tab, mirroring the one on the Inventory tab, so you can find a formula (say, *Elixir of Life*) buried in a long Known Formulas list.

- **Use:** open the Crafting tab and type in the search field above the Known Formulas list. Formula rows filter live by name (case-insensitive substring); level headers with no matching formulas hide too. The query survives sheet re-renders (crafting an item, adjusting quantities, etc.).
- **Requires:** the PF2e system. Per-user and purely client-side — no data is changed.

### 9. Compendium Browser extra filters — `scripts/compendium-browser-filters.js`

Adds three filter groups to the PF2e **Compendium Browser** that the system doesn't expose:

- **Equipment → Other Tags** — filter by `system.traits.otherTags` (e.g. *Alchemical Food*, *Alchemical Tool*, *Herbal*).
- **Equipment → Usage** — filter by where an item is used/equipped (*Worn*, *Worn Shoes*, *Held in One Hand*, *Attached to a Weapon*, …).
- **Feats → Dedication** — filter archetype feats by their prerequisite "*X* Dedication" feat (e.g. all *Blessed One* or *Soulforger* feats); the dedication feat itself is included in its group.

No separate index is maintained: after the system's own loader runs, a supplemental compendium-index pass fetches the extra fields, merges filter tokens into each entry, and injects checkbox groups (options collected from the actual data, so only tags/usages/dedications that exist appear). Multiple selections within a group are OR'd, matching system filter behavior.

- **Use:** open the Compendium Browser's Equipment or Feats tab; the new groups appear in the filter sidebar below the system's own.
- **Requires:** the PF2e system (fails safe with a console warning if the browser isn't found).

### 10. Trick Magic Item daily — `scripts/trick-magic-daily.js` + `styles/trick-magic-daily.css`

House rule: instead of Tricking a magic item as an action every time you activate it, characters with **Trick Magic Item** Trick their items once during **daily preparations**; a success makes the item usable check-free until the next daily preparations.

Adds a "Trick Magic Item" section to pf2e-dailies' **Prepare Dailies** window (the coffee-mug button) listing every trickable item on the character — wands, scrolls, and spell gems with an embedded spell they can't already cast. Pick a skill per item (or leave blank to skip); on confirm each check rolls to chat against the item's level-based DC. Successes get:

- a temporary **Tricked Items (Skill)** spellcasting entry (spell DC from the chosen skill) that lets the item's use button cast directly — no popup, no check. Removed automatically at the next rest/preparations.
- a wand-sparkles marker on the item's inventory row.

Skill picks are remembered between days. Failures simply aren't Tricked today.

- **Settings (world):** master toggle, a DC adjustment dropdown (standard adjustments, −10…+10), and per-category toggles for wands / scrolls / spell gems.
- **Requires:** the PF2e system and **pf2e-dailies** (quietly no-ops without it).
- **Known leak:** while a Tricked entry exists, other consumables of the *same tradition* also cast without a check (the system gates item activation per spellcasting entry, not per item). Acceptable at our table; revisit if abused.

### 11. Region Teleport Follow — `scripts/region-teleport-follow.js`

GM navigation aid: press **J** on a region with a **Teleport Token** or **Change Scene Level** behavior to "follow" the transition yourself — for a teleport, your view switches to the destination's scene if needed (players are unaffected; the scene is *viewed*, not activated) and the camera pans to the destination region's center; for a level change (stairs/ladders on a multi-level scene), your viewed scene level switches to the destination level and the camera stays on the stairs. Zoom is left alone.

- **Use:** on the Regions layer, select or hover the transition region and press **J** (rebindable under Configure Controls); on any other layer (e.g. Tokens), just hover the mouse over where the region sits and press **J**. If multiple destinations apply (a multi-destination teleport, a stair spanning 3+ levels, overlapping regions under the cursor, or a region with both behaviors), a single picker dialog lists them all — level destinations are prefixed `Level:`.
- **Level destinations** mirror core's own resolution: the region's assigned levels (all scene levels, if none are assigned) minus the level you're currently viewing.
- **Requires:** core Foundry only (v14 teleport behaviors store a `destinations` set; changeLevel destinations derive from the region's levels). GM-only, purely client-side.

### 12. Scene Levels Composer — `scripts/scene-levels-composer.js`

GM tool that converts a stack of classic one-floor scenes (the basement map, the ground-floor map, the upstairs map…) into a single **Foundry v14 multi-level scene**, plus a **Stair Painter** for wiring floors together.

**Combine into Levels** (button in the Scenes directory footer, or `game.modules.get("pf2e-house-rules").api.sceneLevels.compose()`):

- Pick scenes and stack them bottom→top; elevation bands default to 20 ft per floor (band height, per-floor bottoms/tops, and basements via a negative "lowest bottom" are all editable).
- A cross-level **visibility matrix** controls which floors render while viewing another (for maps with alpha cutouts), with None / "each sees the floor below" / All presets.
- Creates a **new** scene (sources are never touched): each source scene's art becomes a Level, and every wall, light, sound, tile, region, drawing, note — and optionally token — is copied onto **exactly its own level**, with elevations shifted into the floor's band.
- Different map sizes are auto-centered (grid-aligned) with optional per-floor pixel offsets; different grid *sizes* are scaled to the base scene's grid. Different grid *types* can't be combined.
- The base scene donates grid, padding, lighting environment, fog, playlist, weather, and journal links; the floor whose band contains elevation 0 becomes the initial level.

**Stair Painter** (its own Scenes-directory button whenever the viewed scene has two or more levels, offered after creation, from the composer footer, or `…api.sceneLevels.paintStairs()`): click Paint next to a floor pair, drag a rectangle over the staircase, and a Region tagged to both levels with a **Change Level** behavior is created — that's a fully working staircase. Adjacent pairs are listed one-click; a custom pair row handles elevators and ladders spanning more floors.

- **Requires:** core Foundry v14 only (system-agnostic). GM-only.
- **Caveats:** source scenes that are already multi-level contribute only their initial level's art; lights that should shine on several floors need their Levels tag widened by hand afterwards (deliberately not automated).

### 13. Level Alpha Mask Cutter — `scripts/level-alpha-mask.js`

GM tool that cuts see-through holes into a level's background (or foreground) art on a multi-level scene — the "look down into the floor below" effect — by drawing directly on the canvas, no image editor needed.

Opens from the **Mask Cutter** button in the Scenes directory (visible while the viewed scene has 2+ levels) or `game.modules.get("pf2e-house-rules").api.levelAlphaMask.open()`.

- **Tools:** rectangle drag, click-vertex polygon (Enter/double-click closes, Backspace removes a vertex), and a round brush for organic edges, plus an optional **feather** that softens cut edges. Esc stops the active tool.
- **Live preview:** every cut is applied to the level's texture in place immediately, so you see straight through to the floor below while editing (make the lower floor visible in the visibility matrix first).
- **Nondestructive:** cut shapes, feather, and the original image path are stored on the Level document; **Apply** writes a new `<name>-masked-N.webp` beside the original and points the level at it, **Revert to original** switches the art back while keeping your cuts stored for later, and reopening the tool restores everything for further editing. **Forget mask** deletes the stored data and restores the original. Background and foreground masks are stored independently.
- **Requires:** core Foundry v14 only. GM-only. Source images must live in local Data storage (remote URLs can be previewed but not saved); video backgrounds and rotated level textures aren't supported. Old `-masked-N` revisions accumulate in the image's folder — delete them manually if you care.

### 14. Navigation Guard — `scripts/navigation-guard.js`

Stops the mouse **back/forward thumb buttons** (easy to fat-finger in [Foundry Lightweight Client](https://github.com/phenomen/flc) or any Chromium browser) from throwing you out of the game.

- **How:** a dummy same-document history entry is kept armed, so a back press pops it and goes nowhere — no navigation, no popup, the press is simply swallowed. As a backstop for *real* unloads (closing the tab, Ctrl+W, F5) the browser's "Leave site?" confirmation is shown.
- **Settings (client):** the leave-confirmation prompt can be turned off per client (handy while iterating with F5); the back-button trap is always on.
- **Requires:** nothing — core Foundry, any system. Purely client-side.

### 15. Misc Hooks — `scripts/misc-hooks.js`

A home for small one-hook automations, each with its own world-scoped enable setting.

- **Auto origin name:** effects whose name ends with the word "Immunity" (e.g. the system's "Effect: Cackle Immunity") get the originating actor's name appended on creation — "Effect: Cackle Immunity" becomes "Effect: Cackle Immunity (Seelah)" — so stacked immunities from different casters stay distinguishable. The origin comes from the PF2e effect context; effects without one are left alone (a second setting, off by default, falls back to the creating user's assigned character).
- **Requires:** PF2e (effect context is a system field), but degrades to a no-op elsewhere.

## Development

- Both scripts guard for their dependency and quietly no-op if it isn't installed, so the module is safe to run with either, both, or neither present.
- **Editing a script:** save, then refresh the game tab (F5). No server restart needed.
- **Editing `module.json`** (adding/removing files, changing `id` or `socket`): restart the Foundry server so it re-reads the manifest.

### Adding a new tweak

1. Create `scripts/<your-tweak>.js`.
2. Add its path to the `esmodules` array in `module.json`.
3. Document it under **Tweaks** above (and in `CLAUDE.md` if it carries non-obvious facts).

### Releasing a new version

Releases are published automatically by `.github/workflows/release.yml` on any `v*` tag:

1. Bump `"version"` in `module.json` and commit.
2. Tag and push: `git tag v1.2.3 && git push origin v1.2.3`.

The workflow pins the version, builds `module.zip` (with `module.json` at the zip root, as Foundry requires), and publishes a GitHub Release with `module.json` + `module.zip` attached — which the manifest URL above resolves to.
