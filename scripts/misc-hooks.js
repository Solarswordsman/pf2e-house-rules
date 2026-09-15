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
