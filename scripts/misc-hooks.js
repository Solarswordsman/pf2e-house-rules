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
 *    `flags.pf2e.origin` = {slug, castRank, ...}) gets a linked AmbientLight
 *    at its centre with "Is Darkness Source" (`config.negative`) on and
 *    bright/dim radii matching the burst. That is what PF2e's rules-based
 *    vision understands as darkness; the adjustDarknessLevel region behavior
 *    only alters global illumination and fights the system's lighting. The
 *    light carries `flags.pf2e-house-rules.darknessRegion` = region id and
 *    `darknessRank`; it follows the region on shape updates and is deleted
 *    with it, so a player dismissing the darkness (deleting their region)
 *    cleans up without GM tooling. AmbientLights are GM-only to create, so
 *    the active GM does all of this from create/update/deleteRegion hooks —
 *    a GM must be online.
 *
 * 4. Consumable damage formula templates — works around PF2e HUD's consumable
 *    "use" path (`consumeItem` in reonZ's foundry-helpers `src/item.ts`), which
 *    builds `new DamageRoll("(formula)[type,kind]")` with **no roll data**; the
 *    system's own `ConsumablePF2e#consume` passes `this.getRollData()`. Without
 *    data, `DamageInstance.parse` replaces every `@item.level` with "0", so a
 *    scaling consumable rolls 0 dice from the HUD. Fix: keep the scaling
 *    formula in `flags.world.damageFormulaTemplate` and bake the resolved,
 *    reference-free result into `system.damage.formula` whenever the item is
 *    created or its level/template changes — then both paths roll the same
 *    thing. Only item-level references are baked (`@item.level`,
 *    `@item.system.level.value`); anything else (e.g. `@actor.level`) is left
 *    in place and still only works from the sheet. No manual flagging is needed:
 *    a formula that still contains an item-level reference is adopted as the
 *    template (copied to the flag) and baked on creation or on the item's next
 *    update — so typing a new scaling formula on the sheet replaces the
 *    template, while a reference-free hand edit is overwritten on the next
 *    level change.
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
    name: "Misc: Darkness spell regions get a darkness light",
    hint: "Regions placed from the Darkness spell get a linked darkness-source Ambient Light of the same size, removed when the region is deleted. Needs an online GM.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
  game.settings.register(MODULE_ID, "consumableFormulaTemplates", {
    name: "Misc: bake consumable damage formula templates",
    hint: "Consumable damage/healing formulas that reference @item.level (e.g. \"(@item.level)d8\") are resolved to plain dice on creation and whenever the item's level changes, so scaling consumables roll correctly from PF2e HUD. The scaling formula is kept in flags.world.damageFormulaTemplate.",
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

/** Cast rank of the Darkness spell a region was placed from, or null if it isn't one. */
function darknessRegionRank(region) {
  const origin = region.flags?.pf2e?.origin;
  if (origin?.slug !== "darkness") return null;
  return Number(origin.castRank) || 2;
}

function linkedDarknessLights(region) {
  return region.parent?.lights.filter((l) => l.flags[MODULE_ID]?.darknessRegion === region.id) ?? [];
}

/**
 * Centre and radius (in scene distance units) for a light covering the region.
 * Bursts are a single circle shape; anything else gets its bounding circle.
 */
function darknessLightGeometry(region) {
  const scene = region.parent;
  const shapes = region._source.shapes;
  if (!scene || !shapes.length) return null;
  let x, y, radiusPx;
  const circle = shapes.length === 1 && shapes[0].type === "circle" ? shapes[0] : null;
  if (circle) {
    ({ x, y } = circle);
    radiusPx = circle.radius;
  } else {
    const xs = [], ys = [];
    for (const sh of shapes) {
      const r = sh.radius ?? Math.max(sh.width ?? 0, sh.height ?? 0, sh.length ?? 0);
      xs.push(sh.x - r, sh.x + r);
      ys.push(sh.y - r, sh.y + r);
    }
    x = (Math.min(...xs) + Math.max(...xs)) / 2;
    y = (Math.min(...ys) + Math.max(...ys)) / 2;
    radiusPx = Math.max(Math.max(...xs) - x, Math.max(...ys) - y);
  }
  const radius = (radiusPx / scene.grid.size) * scene.grid.distance;
  return { x: Math.round(x), y: Math.round(y), radius };
}

function darknessLightSource(region, rank) {
  const geo = darknessLightGeometry(region);
  if (!geo) return null;
  return {
    name: `Darkness (Rank ${rank})`,
    x: geo.x,
    y: geo.y,
    elevation: region._source.elevation.bottom ?? 0,
    levels: region._source.levels,
    walls: true,
    vision: false,
    config: { negative: true, bright: geo.radius, dim: geo.radius },
    flags: { [MODULE_ID]: { darknessRegion: region.id, darknessRank: rank } },
  };
}

Hooks.on("createRegion", async (region, options, userId) => {
  try {
    if (game.user !== game.users.activeGM) return;
    if (!game.settings.get(MODULE_ID, "darknessRegions")) return;
    const rank = darknessRegionRank(region);
    if (rank === null || linkedDarknessLights(region).length) return;
    const light = darknessLightSource(region, rank);
    if (!light) return;
    await region.parent.createEmbeddedDocuments("AmbientLight", [light]);
    // The system places spell areas as "Always for Anyone", which paints the
    // caster's hatched fill over the darkness; the light is the visual now.
    if (region.visibility !== CONST.REGION_VISIBILITY.LAYER) {
      await region.update({ visibility: CONST.REGION_VISIBILITY.LAYER });
    }
  } catch (err) {
    console.error(`${MODULE_ID} | darknessRegions create failed`, err);
  }
});

// Keep the light under the region if the GM moves or resizes it.
Hooks.on("updateRegion", async (region, changed, options, userId) => {
  try {
    if (game.user !== game.users.activeGM || !("shapes" in changed)) return;
    const lights = linkedDarknessLights(region);
    const geo = lights.length ? darknessLightGeometry(region) : null;
    if (!geo) return;
    const updates = lights.map((l) => ({
      _id: l.id,
      x: geo.x,
      y: geo.y,
      "config.bright": geo.radius,
      "config.dim": geo.radius,
    }));
    await region.parent.updateEmbeddedDocuments("AmbientLight", updates);
  } catch (err) {
    console.error(`${MODULE_ID} | darknessRegions update failed`, err);
  }
});

// Not gated by the setting: a light we created should always go with its region.
Hooks.on("deleteRegion", async (region, options, userId) => {
  try {
    if (game.user !== game.users.activeGM) return;
    const ids = linkedDarknessLights(region).map((l) => l.id);
    if (ids.length) await region.parent.deleteEmbeddedDocuments("AmbientLight", ids);
  } catch (err) {
    console.error(`${MODULE_ID} | darknessRegions cleanup failed`, err);
  }
});

/* -------------------------------------------- */
/*  Consumable damage formula templates          */
/* -------------------------------------------- */

// Flag scope is "world" (not the module id) because existing items already
// carry it from the world-script version of these hooks.
const TEMPLATE_SCOPE = "world";
const TEMPLATE_FLAG = "damageFormulaTemplate";
const TEMPLATE_PATH = `flags.${TEMPLATE_SCOPE}.${TEMPLATE_FLAG}`;

/** Resolve item-level references; unknown references are left untouched. */
function bakeFormula(template, level) {
  return Roll.replaceFormulaData(template, { item: { level, system: { level: { value: level } } } });
}

/** A usable template is a non-empty string (v14 deletions arrive as ForcedDeletion objects). */
function formulaTemplate(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

/** A formula still holding item-level references is itself a template waiting to be adopted. */
function unbakedFormula(value) {
  return typeof value === "string" && /@item\.(system\.level\.value|level)\b/.test(value) ? value : null;
}

Hooks.on("preCreateItem", (item) => {
  try {
    if (item.type !== "consumable" || !item.system.damage) return;
    // An unbaked formula wins over the flag: it is what the author last typed.
    const adopted = unbakedFormula(item.system.damage.formula);
    const template = adopted ?? formulaTemplate(item.flags?.[TEMPLATE_SCOPE]?.[TEMPLATE_FLAG]);
    if (!template) return;
    if (!game.settings.get(MODULE_ID, "consumableFormulaTemplates")) return;
    const update = { "system.damage.formula": bakeFormula(template, item.system.level?.value ?? 1) };
    if (adopted) update[TEMPLATE_PATH] = adopted;
    item.updateSource(update);
  } catch (err) {
    console.error(`${MODULE_ID} | consumableFormulaTemplates create failed`, err);
  }
});

Hooks.on("preUpdateItem", (item, changes) => {
  try {
    if (item.type !== "consumable") return;

    // Damage must exist after this update: skip if it is absent or being removed.
    const damageChange = foundry.utils.getProperty(changes, "system.damage");
    const damageKept = damageChange === undefined ? !!item.system.damage : foundry.utils.getType(damageChange) === "Object";
    if (!damageKept) return;

    // Template precedence: an unbaked formula (typed just now, or left over on
    // an item that predates this hook — any update then bakes it), else a
    // changed flag (a deletion means nothing to bake), else the stored flag.
    const adopted = unbakedFormula(foundry.utils.getProperty(changes, "system.damage.formula") ?? item._source.system.damage?.formula);
    const levelChanged = foundry.utils.hasProperty(changes, "system.level.value");
    const templateChanged = foundry.utils.hasProperty(changes, TEMPLATE_PATH);
    if (!adopted && !levelChanged && !templateChanged) return;
    const template = adopted ?? formulaTemplate(
      templateChanged ? foundry.utils.getProperty(changes, TEMPLATE_PATH) : item.flags?.[TEMPLATE_SCOPE]?.[TEMPLATE_FLAG],
    );
    if (!template) return;
    if (!game.settings.get(MODULE_ID, "consumableFormulaTemplates")) return;

    const changedLevel = foundry.utils.getProperty(changes, "system.level.value");
    const level = Number.isFinite(changedLevel) ? changedLevel : (item.system.level?.value ?? 1);
    foundry.utils.setProperty(changes, "system.damage.formula", bakeFormula(template, level));
    if (adopted) foundry.utils.setProperty(changes, TEMPLATE_PATH, adopted);
  } catch (err) {
    console.error(`${MODULE_ID} | consumableFormulaTemplates update failed`, err);
  }
});
