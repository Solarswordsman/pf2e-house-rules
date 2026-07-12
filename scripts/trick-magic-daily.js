/**
 * Trick Magic Item — daily preparations house rule.
 *
 * House rule: instead of Tricking a magic item as an action on each activation,
 * you Trick items during daily preparations. Success means the item just works
 * until your next daily preparations, no further checks.
 *
 * Implemented as a pf2e-dailies custom daily (the coffee-mug "Prepare Dailies"
 * flow): one dropdown row per trickable item in inventory (pick the skill, or
 * leave blank to skip), rolls the checks to chat on confirm, and for successes
 * adds a temporary "Tricked Items (<Skill>)" spellcasting entry plus a copy of
 * each tricked spell inside it. pf2e-dailies removes the temporary items at the
 * next rest; our `rest` callback clears the item flags.
 *
 * Load-bearing facts:
 *   - "Trickable" mirrors the system's own gate (consumable/document.ts):
 *     category wand/scroll/spell-gem with an embedded spell (`system.spell`)
 *     that no spellcasting entry can already cast (canCastConsumable). Eligible
 *     skills/DC mirror calculateTrickMagicItemCheckDC: tradition traits →
 *     Arcana/Nature/Occultism/Religion, level-based DC from the item's level.
 *   - The "works without a check" mechanism: `canCastConsumable` passes if any
 *     entry `canCast` the embedded spell. Only prepared/**spontaneous** entries
 *     count for item activation (innate does not: canCast requires
 *     isPrepared || isSpontaneous when an origin item is given), and they match
 *     by `tradition || spell in list`. So the temp entry is a 0-slot
 *     spontaneous entry with the item's tradition, proficiencySlug pointing at
 *     the tricked skill. Known leak: other consumables of the same tradition
 *     also become directly castable while the entry exists.
 *   - Spell copies are wired into the entry via the `pf2e-dailies.identifier`
 *     flag (same mechanism its built-in Staves/Trickster's Ace dailies use:
 *     entry and spells share a random identifier; dailies sets location after
 *     creation). Items added via `addItem` are temporary and auto-removed.
 *   - The daily is condition-based (feat slug "trick-magic-item" + at least one
 *     trickable item), registered via
 *     game.modules.get("pf2e-dailies").api.registerCustomDailies on `ready`.
 *   - Tricked items get `flags.pf2e-house-rules.tricked = { skill, dc }` and a
 *     wand-sparkles marker on their sheet rows; `process` wipes stale
 *     flags/entries first so re-running preparations never stacks.
 */

import { levelBasedDC } from "./expressions-inserter.js";

const MODULE_ID = "pf2e-house-rules";

const SKILL_TO_TRADITION = {
  arcana: "arcane",
  nature: "primal",
  occultism: "occult",
  religion: "divine",
};

/** Consumable category -> settings key gating it. */
const CATEGORY_SETTINGS = {
  wand: "trickDailyWands",
  scroll: "trickDailyScrolls",
  "spell-gem": "trickDailySpellGems",
};

const DC_ADJUSTMENT_CHOICES = {
  "-10": "Incredibly easy (−10)",
  "-5": "Very easy (−5)",
  "-2": "Easy (−2)",
  "0": "Standard (+0)",
  "2": "Hard (+2)",
  "5": "Very hard (+5)",
  "10": "Incredibly hard (+10)",
};

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "trickDailyEnabled", {
    name: "House rule: Trick Magic Item at daily preparations",
    hint: "Adds a Trick Magic Item section to pf2e-dailies' Prepare Dailies for characters with the feat. Tricked items work without further checks until the next daily preparations.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
  game.settings.register(MODULE_ID, "trickDailyDcAdjustment", {
    name: "House rule: Trick Magic Item DC adjustment",
    hint: "Adjustment applied on top of the standard level-based DC for daily Trick checks.",
    scope: "world",
    config: true,
    type: String,
    choices: DC_ADJUSTMENT_CHOICES,
    default: "0",
  });
  const categories = [
    ["trickDailyWands", "Wands"],
    ["trickDailyScrolls", "Scrolls"],
    ["trickDailySpellGems", "Spell gems"],
  ];
  for (const [key, label] of categories) {
    game.settings.register(MODULE_ID, key, {
      name: `House rule: Trick ${label.toLowerCase()} at daily preparations`,
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
    });
  }
});

function trickDC(item) {
  return levelBasedDC(item.level) + Number(game.settings.get(MODULE_ID, "trickDailyDcAdjustment"));
}

/** Skills eligible to Trick this item, from its tradition traits (mirrors calculateTrickMagicItemCheckDC). */
function trickSkillsFor(item) {
  const traditions = new Set([
    ...(item.system.traits?.value ?? []),
    ...(item.system.spell?.system?.traits?.traditions ?? []),
  ]);
  return Object.entries(SKILL_TO_TRADITION)
    .filter(([, tradition]) => traditions.has(tradition))
    .map(([skill]) => skill);
}

function trickableItems(actor) {
  if (!game.settings.get(MODULE_ID, "trickDailyEnabled")) return [];
  return actor.itemTypes.consumable.filter((item) => {
    const settingKey = CATEGORY_SETTINGS[item.category];
    if (!settingKey || !game.settings.get(MODULE_ID, settingKey)) return false;
    if (!item.system.spell || trickSkillsFor(item).length === 0) return false;
    return !actor.spellcasting?.canCastConsumable(item);
  });
}

function skillLabel(skill) {
  const label = CONFIG.PF2E.skills[skill]?.label;
  return label ? game.i18n.localize(label) : skill;
}

function createTrickDaily(api) {
  return {
    key: "trick-magic-item",
    label: "Trick Magic Item",

    condition: (actor) =>
      actor.itemTypes.feat.some((feat) => feat.slug === "trick-magic-item") &&
      trickableItems(actor).length > 0,

    rows: (actor) =>
      trickableItems(actor).map((item) => ({
        type: "select",
        slug: item.id,
        label: `${item.name} — DC ${trickDC(item)}`,
        save: true,
        empty: true,
        options: trickSkillsFor(item).map((skill) => {
          const mod = actor.skills[skill].mod;
          return { value: skill, label: `${skillLabel(skill)} (${mod >= 0 ? "+" : ""}${mod})` };
        }),
      })),

    async process({ actor, rows, messages, addItem, updateItem, deleteItem }) {
      // Wipe any previous day's state so re-running preparations never stacks.
      for (const entry of actor.itemTypes.spellcastingEntry) {
        if (entry.flags?.[MODULE_ID]?.trickedEntry) deleteItem(entry);
      }
      for (const item of actor.itemTypes.consumable) {
        if (item.flags?.[MODULE_ID]?.tricked) {
          updateItem({ _id: item.id, [`flags.${MODULE_ID}.-=tricked`]: null });
        }
      }

      messages.addGroup("trickMagicItem", "Trick Magic Item");

      const entryIdentifiers = new Map(); // skill -> shared dailies identifier
      for (const [itemId, skill] of Object.entries(rows)) {
        const tradition = SKILL_TO_TRADITION[skill];
        if (!tradition) continue; // row left blank
        const item = actor.inventory.get(itemId);
        if (!item?.system.spell) continue;

        const dc = trickDC(item);
        const roll = await actor.skills[skill].check.roll({
          dc: { value: dc },
          item,
          extraRollOptions: ["action:trick-magic-item"],
        });
        if ((roll?.degreeOfSuccess ?? 0) < 2) {
          messages.add("trickMagicItem", {
            uuid: item.uuid,
            label: `${item.name} — failed (${skillLabel(skill)})`,
          });
          continue;
        }

        let identifier = entryIdentifiers.get(skill);
        if (!identifier) {
          identifier = foundry.utils.randomID();
          entryIdentifiers.set(skill, identifier);
          addItem(
            api.utils.createSpellcastingEntrySource({
              category: "spontaneous",
              identifier,
              name: `Tricked Items (${skillLabel(skill)})`,
              tradition,
              proficiencySlug: skill,
              showSlotlessRanks: true,
              flags: { [MODULE_ID]: { trickedEntry: true } },
            })
          );
        }

        const spellSource = foundry.utils.deepClone(item.system.spell);
        spellSource._id = foundry.utils.randomID();
        foundry.utils.setProperty(spellSource, "flags.pf2e-dailies.identifier", identifier);
        addItem(spellSource);

        updateItem({ _id: item.id, [`flags.${MODULE_ID}.tricked`]: { skill, dc } });
        messages.add("trickMagicItem", {
          uuid: item.uuid,
          label: `${item.name} — Tricked (${skillLabel(skill)})`,
        });
      }
    },

    // Temporary entries/spells are removed by pf2e-dailies itself; only our item flags remain.
    rest({ actor, updateItem }) {
      for (const item of actor.itemTypes.consumable) {
        if (item.flags?.[MODULE_ID]?.tricked) {
          updateItem({ _id: item.id, [`flags.${MODULE_ID}.-=tricked`]: null });
        }
      }
    },
  };
}

Hooks.once("ready", () => {
  const module = game.modules.get("pf2e-dailies");
  const api = module?.active ? module.api : null;
  if (!api?.registerCustomDailies || !api.utils?.createSpellcastingEntrySource) return;
  api.registerCustomDailies([createTrickDaily(api)]);
});

/* -------------------------------------------- */
/*  Sheet marker for tricked items              */
/* -------------------------------------------- */

Hooks.on("renderCharacterSheetPF2e", (sheet, html) => {
  const root = html instanceof HTMLElement ? html : html[0];
  const actor = sheet.actor;
  if (!actor) return;

  for (const item of actor.itemTypes.consumable) {
    if (!item.flags?.[MODULE_ID]?.tricked) continue;
    for (const row of root.querySelectorAll(`li[data-item-id="${item.id}"]`)) {
      const name = row.querySelector(".item-name h4, .item-name h3, h4.name");
      if (!name || name.querySelector(".phr-tricked-marker")) continue;
      const icon = document.createElement("i");
      icon.className = "fa-solid fa-wand-sparkles phr-tricked-marker";
      icon.dataset.tooltip = "Tricked — usable until next daily preparations";
      name.append(icon);
    }
  }
});
