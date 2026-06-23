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
└── scripts/
    ├── toolbelt-set-targets.js
    └── pf2e-hud-slots.js
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
