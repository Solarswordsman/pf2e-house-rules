/**
 * Misc Hooks — a home for small one-hook automations that don't warrant a
 * file of their own. Each entry gets a world-scoped enable setting so the GM
 * decides what runs.
 *
 * Current entries:
 *
 * 1. Auto origin name — effects whose name ends with the word "Immunity"
 *    (e.g. the system's "Effect: Cackle Immunity") get the originating
 *    actor's name appended on creation: "Effect: Cackle Immunity" →
 *    "Effect: Cackle Immunity (Seelah)". The origin is read from the PF2e
 *    effect context (`system.context.origin.actor`); with no origin the name
 *    is left alone (optionally falling back to the creating user's assigned
 *    character, off by default).
 *
 * 2. Flip tokens hotkey — Shift+F (rebindable) toggles the "Mirror
 *    Horizontally" option of every controlled token. That option is just the
 *    sign of `texture.scaleX` (see the TokenConfig mixin: `mirrorX =
 *    scaleX < 0`), so the toggle is a one-field update per token. Players can
 *    use it on tokens they own; a bad binding is impossible to fire on tokens
 *    you can't already edit since `canvas.tokens.controlled` only holds those.
 *
 * 3. Darkness spell regions — the Region the system places for the Darkness
 *    spell (PF2e on v14 places spell areas as Regions, stamped with
 *    `flags.pf2e.origin` = {slug, castRank, ...}) gets an "Adjust Darkness
 *    Level" behavior in OVERRIDE mode with modifier 1, i.e. darkness level 1
 *    inside the burst: global illumination is cut there, so creatures need
 *    darkvision (or a light source) to see in. Behavior + region are renamed
 *    "Darkness (Rank N)" and the cast rank is kept at
 *    `flags.pf2e-house-rules.darknessRank` on the behavior for macros.
 *    Permission wrinkle (`BaseRegion.#canCreate`): only GMs may create a
 *    Region that carries behaviors, so a player's cast can't be patched in
 *    `preCreateRegion` — the server would reject the whole placement. GM
 *    casts take the atomic preCreate path; for everyone else the active GM
 *    attaches the behavior in `createRegion`, so a GM must be online.
 */

const MODULE_ID = "pf2e-house-rules";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "autoOriginName", {
    name: "Misc: append origin actor name to Immunity effects",
    hint: "Effects whose name ends with \"Immunity\" get the origin actor's name appended, e.g. \"Effect: Cackle Immunity (Seelah)\".",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
  game.settings.register(MODULE_ID, "autoOriginNameFallback", {
    name: "Misc: origin name falls back to assigned character",
    hint: "When an Immunity effect has no origin in its context, use the creating user's assigned character's name instead of leaving the name alone.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });
  game.settings.register(MODULE_ID, "darknessRegions", {
    name: "Misc: Darkness spell regions dim the light",
    hint: "Regions placed from the Darkness spell get an Adjust Darkness Level behavior (override to full darkness) and are named by cast rank. Player casts need an online GM.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
});

Hooks.once("init", () => {
  game.keybindings.register(MODULE_ID, "flipTokens", {
    name: "Flip Controlled Tokens",
    hint: "Toggle \"Mirror Horizontally\" on every token you currently control.",
    editable: [{ key: "KeyF", modifiers: [foundry.helpers.interaction.KeyboardManager.MODIFIER_KEYS.SHIFT] }],
    onDown: () => {
      flipControlledTokens();
      return true;
    },
  });
});

async function flipControlledTokens() {
  const tokens = canvas?.ready ? canvas.tokens.controlled : [];
  if (!tokens.length) {
    ui.notifications.warn("Flip Tokens: no tokens controlled.");
    return;
  }
  // Read the raw source: prepared data is fine here too, but `_source` is the
  // stored value and avoids any active-effect/animation surprises.
  const updates = tokens.map((t) => ({
    _id: t.document.id,
    "texture.scaleX": -(t.document._source.texture.scaleX || 1),
  }));
  await canvas.scene.updateEmbeddedDocuments("Token", updates);
}

Hooks.on("preCreateItem", (item, data, options, userId) => {
  try {
    if (item.type !== "effect") return;
    if (!/\bImmunity\s*$/.test(item.name)) return;
    if (!game.settings.get(MODULE_ID, "autoOriginName")) return;

    const originUUID = item.system.context?.origin?.actor;
    // fromUuidSync throws (rather than returning null) on UUIDs that would
    // need async retrieval, e.g. compendium origins — treat those as no origin.
    let origin = null;
    if (originUUID) {
      try {
        origin = fromUuidSync(originUUID);
      } catch {
        origin = null;
      }
    }

    let name = origin?.name ?? null;
    if (!name && game.settings.get(MODULE_ID, "autoOriginNameFallback")) {
      name = game.users.get(userId)?.character?.name ?? null;
    }
    if (name) item.updateSource({ name: `${item.name} (${name})` });
  } catch (err) {
    // Never abort item creation over a naming nicety.
    console.error(`${MODULE_ID} | autoOriginName failed`, err);
  }
});

/* -------------------------------------------- */
/*  Darkness spell regions                       */
/* -------------------------------------------- */

const DARKNESS_BEHAVIOR_TYPE = "adjustDarknessLevel";

/** Cast rank of the Darkness spell a region was placed from, or null if it isn't one. */
function darknessRegionRank(region) {
  const origin = region.flags?.pf2e?.origin;
  if (origin?.slug !== "darkness") return null;
  return Number(origin.castRank) || 2;
}

function hasDarknessBehavior(region) {
  return region._source.behaviors.some((b) => b.type === DARKNESS_BEHAVIOR_TYPE);
}

function darknessBehaviorSource(rank) {
  return {
    name: `Darkness (Rank ${rank})`,
    type: DARKNESS_BEHAVIOR_TYPE,
    // OVERRIDE (mode 0) sets the darkness level inside the region to the
    // modifier outright — 1 is fully dark. See AdjustDarknessLevelRegionBehaviorType.MODES.
    system: { mode: 0, modifier: 1 },
    flags: { [MODULE_ID]: { darknessRank: rank } },
  };
}

// GM-placed: patch the create data so the region lands with its behavior in
// one write. (updateSource on an embedded collection appends entries that
// carry no _id, so this doesn't disturb anything already in `behaviors`.)
Hooks.on("preCreateRegion", (region, data, options, userId) => {
  try {
    if (!game.user.isGM) return;
    if (!game.settings.get(MODULE_ID, "darknessRegions")) return;
    const rank = darknessRegionRank(region);
    if (rank === null || hasDarknessBehavior(region)) return;
    region.updateSource({
      name: `Darkness (Rank ${rank})`,
      behaviors: [darknessBehaviorSource(rank)],
    });
  } catch (err) {
    // A preCreate error cancels the placement — never do that over a nicety.
    console.error(`${MODULE_ID} | darknessRegions preCreate failed`, err);
  }
});

// Player-placed: non-GMs can't create behaviors, so the active GM attaches
// one after the fact. The GM path above leaves nothing for this to do.
Hooks.on("createRegion", async (region, options, userId) => {
  try {
    if (game.user !== game.users.activeGM) return;
    if (!game.settings.get(MODULE_ID, "darknessRegions")) return;
    const rank = darknessRegionRank(region);
    if (rank === null || hasDarknessBehavior(region)) return;
    await region.createEmbeddedDocuments("RegionBehavior", [darknessBehaviorSource(rank)]);
    await region.update({ name: `Darkness (Rank ${rank})` });
  } catch (err) {
    console.error(`${MODULE_ID} | darknessRegions attach failed`, err);
  }
});
