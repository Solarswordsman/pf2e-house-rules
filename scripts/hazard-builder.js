/**
 * PF2e Hazard Builder
 *
 * GM tool that assembles a ready-to-play Hazard actor from the GM Core
 * "Building Hazards" tables (2-13 Stealth & Disable, 2-14 Minimum
 * Proficiency, 2-15 Defenses, 2-16 Offense). Pick a level, complexity and a
 * role (extreme/high/low) per statistic; every derived number stays editable
 * before creation, and the finished actor opens for normal sheet editing.
 *
 * Opens from the "Build Hazard" button in the Actors directory footer, or
 * game.modules.get("pf2e-house-rules").api.hazardBuilder.open().
 *
 * Load-bearing facts (verified against the system's packs/pf2e/hazards):
 *   - attributes.stealth.value is the MODIFIER (DC - 10) for both simple and
 *     complex hazards; the minimum-proficiency rank goes in stealth.details.
 *   - Disable/routine/reset live under system.details as HTML; disable text
 *     uses inline @Check buttons with the action trait when applicable.
 *   - Strikes are items of type "melee" (bonus.value + damageRolls record);
 *     trigger/effect blocks are items of type "action" with
 *     actionType "reaction".
 *   - hasHealth:false suppresses AC/saves/HP on the sheet for hazards with
 *     no physical component.
 */

const MODULE_ID = "pf2e-house-rules";

/* -------------------------------------------- */
/*  GM Core building-hazards tables              */
/* -------------------------------------------- */

/** Table 2-13: level -> [extreme, high, low] Stealth/Disable DCs. */
const STEALTH_DISABLE_DCS = {
  "-1": [18, 15, 12], 0: [19, 16, 13], 1: [20, 17, 14], 2: [21, 18, 15],
  3: [23, 20, 17], 4: [25, 22, 18], 5: [26, 23, 20], 6: [28, 25, 21],
  7: [30, 27, 23], 8: [31, 28, 24], 9: [33, 30, 26], 10: [35, 32, 27],
  11: [36, 33, 29], 12: [38, 35, 30], 13: [40, 37, 32], 14: [41, 38, 33],
  15: [43, 40, 35], 16: [45, 42, 36], 17: [46, 43, 38], 18: [48, 45, 39],
  19: [50, 47, 41], 20: [51, 48, 42], 21: [53, 50, 44], 22: [55, 52, 45],
  23: [56, 53, 46], 24: [58, 55, 48],
};

/** Table 2-15: level -> [EAC, HAC, LAC, ESave, HSave, LSave, hardness, HP]
 *  (hardness/HP are midpoints of the listed ranges; BT is half HP). */
const DEFENSES = {
  "-1": [18, 15, 12, 9, 8, 2, 3, 12], 0: [19, 16, 13, 10, 9, 3, 4, 16],
  1: [19, 16, 13, 11, 10, 4, 6, 24], 2: [21, 18, 15, 12, 11, 5, 8, 32],
  3: [22, 19, 16, 14, 12, 6, 11, 44], 4: [24, 21, 18, 15, 14, 8, 12, 48],
  5: [25, 22, 19, 17, 15, 9, 13, 52], 6: [27, 24, 21, 18, 17, 11, 14, 56],
  7: [28, 25, 22, 20, 18, 12, 15, 60], 8: [30, 27, 24, 21, 19, 13, 16, 64],
  9: [31, 28, 25, 23, 21, 15, 17, 68], 10: [33, 30, 27, 24, 22, 16, 18, 72],
  11: [34, 31, 28, 26, 24, 18, 20, 80], 12: [36, 33, 30, 27, 25, 19, 21, 84],
  13: [37, 34, 31, 29, 26, 20, 22, 88], 14: [39, 36, 33, 30, 28, 22, 23, 92],
  15: [40, 37, 34, 32, 29, 23, 24, 96], 16: [42, 39, 36, 33, 30, 25, 26, 104],
  17: [43, 40, 37, 35, 32, 26, 28, 112], 18: [45, 42, 39, 36, 33, 27, 30, 120],
  19: [46, 43, 40, 38, 35, 29, 32, 128], 20: [48, 45, 42, 39, 36, 30, 34, 136],
  21: [49, 46, 43, 41, 38, 32, 37, 148], 22: [51, 48, 45, 43, 39, 33, 40, 160],
  23: [52, 49, 46, 44, 40, 34, 45, 172], 24: [54, 51, 48, 46, 42, 36, 48, 184],
};

/** Table 2-16: level -> [simple atk, complex atk, simple dmg, complex dmg,
 *  extreme DC, hard DC]. */
const OFFENSE = {
  "-1": [10, 8, "2d4+1", "1d4+1", 19, 16], 0: [11, 8, "2d6+3", "1d6+2", 19, 16],
  1: [13, 9, "2d6+5", "1d6+3", 20, 17], 2: [14, 11, "2d10+7", "1d10+4", 22, 18],
  3: [16, 12, "2d10+13", "1d10+6", 23, 20], 4: [17, 14, "4d8+10", "2d8+5", 25, 21],
  5: [19, 15, "4d8+14", "2d8+7", 26, 22], 6: [20, 17, "4d8+18", "2d8+9", 27, 24],
  7: [22, 18, "4d10+18", "2d10+9", 29, 25], 8: [23, 20, "4d10+22", "2d10+11", 30, 26],
  9: [25, 21, "4d10+26", "2d10+13", 32, 28], 10: [26, 23, "4d12+26", "2d12+13", 33, 29],
  11: [28, 24, "4d12+30", "2d12+15", 34, 30], 12: [29, 26, "6d10+27", "3d10+14", 36, 32],
  13: [31, 27, "6d10+31", "3d10+16", 37, 33], 14: [32, 29, "6d10+35", "3d10+18", 39, 34],
  15: [34, 30, "6d12+33", "3d12+17", 40, 36], 16: [35, 32, "6d12+35", "3d12+18", 41, 37],
  17: [37, 33, "6d12+37", "3d12+19", 43, 38], 18: [38, 35, "6d12+41", "3d12+20", 44, 40],
  19: [40, 36, "8d10+40", "4d10+20", 46, 41], 20: [41, 38, "8d10+44", "4d10+22", 47, 42],
  21: [43, 39, "8d10+48", "4d10+24", 48, 44], 22: [44, 41, "8d10+52", "4d10+26", 50, 45],
  23: [46, 42, "8d12+48", "4d12+24", 51, 46], 24: [47, 44, "8d12+52", "4d12+26", 52, 48],
};

/** Table 2-14: minimum proficiency rank to find (high column). */
function minimumProficiency(level) {
  if (level <= 0) return "untrained";
  if (level <= 4) return "trained";
  if (level <= 8) return "expert";
  if (level <= 18) return "master";
  return "legendary";
}

function clampLevel(level) {
  return Math.max(-1, Math.min(24, Math.trunc(Number(level) || 0)));
}

const HAZARD_TRAITS = ["trap", "environmental", "haunt", "mechanical", "magical", "fire", "electricity", "poison", "curse"];

const ROLE_OPTIONS = `
  <option value="extreme">Extreme</option>
  <option value="high" selected>High</option>
  <option value="low">Low</option>`;

/* -------------------------------------------- */
/*  Application                                  */
/* -------------------------------------------- */

class HazardBuilder extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "phr-hazard-builder",
    classes: ["phr-inserter", "phr-hazard"],
    window: {
      title: "Build Hazard",
      icon: "fa-solid fa-triangle-exclamation",
      resizable: true,
    },
    position: { width: 640, height: "auto" },
  };

  static #instance = null;

  static open() {
    if (game.system.id !== "pf2e" || !game.user.isGM) return;
    if (this.#instance?.rendered) return this.#instance.bringToFront();
    this.#instance = new this();
    this.#instance.render(true);
  }

  async _renderHTML() {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = this.#buildHTML();
    return wrapper;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(...result.children);
  }

  #buildHTML() {
    const level = game.actors?.party?.level || 1;
    const skills = Object.entries(CONFIG.PF2E.skills ?? {})
      .map(([slug, data]) => ({ slug, label: game.i18n.localize(data.label ?? slug) }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const skillOptions = skills
      .map((s) => `<option value="${s.slug}" ${s.slug === "thievery" ? "selected" : ""}>${s.label}</option>`)
      .join("");
    const damageTypes = Object.keys(CONFIG.PF2E.damageTypes ?? { untyped: "" })
      .sort()
      .map((t) => `<option value="${t}" ${t === "piercing" ? "selected" : ""}>${t}</option>`)
      .join("");

    return `
    <form class="phr-body" autocomplete="off">
      <fieldset class="phr-dc"><legend>Basics</legend>
        <div class="phr-row">
          <label class="phr-label-field">Name <input type="text" name="name" placeholder="e.g. Collapsing Bridge" required></label>
          <label>Level <input type="number" name="level" value="${level}" min="-1" max="24" step="1" data-recompute></label>
        </div>
        <div class="phr-row">
          <label class="phr-radio"><input type="radio" name="complexity" value="simple" checked data-recompute> Simple</label>
          <label class="phr-radio"><input type="radio" name="complexity" value="complex" data-recompute> Complex</label>
          <label>Rarity <select name="rarity">
            <option value="common">Common</option>
            <option value="uncommon">Uncommon</option>
            <option value="rare">Rare</option>
            <option value="unique">Unique</option>
          </select></label>
        </div>
        <div class="phr-chips">
          ${HAZARD_TRAITS.map((t) => `<label class="phr-chip"><input type="checkbox" name="traits" value="${t}" ${["trap", "mechanical"].includes(t) ? "checked" : ""}><span>${t}</span></label>`).join("")}
          <label>Other <input type="text" name="extraTraits" placeholder="comma,separated"></label>
        </div>
      </fieldset>

      <fieldset class="phr-dc"><legend>Detection &amp; Disable</legend>
        <div class="phr-row">
          <label>Stealth <select name="stealthRole" data-recompute>${ROLE_OPTIONS}</select></label>
          <label>DC <input type="number" name="stealthDC" step="1" data-auto="stealth"></label>
          <span class="phr-computed" data-minprof></span>
        </div>
        <div class="phr-row">
          <label>Disable skill <select name="disableSkill">${skillOptions}</select></label>
          <label>DC role <select name="disableRole" data-recompute>${ROLE_OPTIONS}</select></label>
          <label>DC <input type="number" name="disableDC" step="1" data-auto="disable"></label>
        </div>
        <div class="phr-row">
          <label class="phr-label-field">Disable goal <input type="text" name="disableGoal" placeholder="e.g. to jam the mechanism"></label>
        </div>
      </fieldset>

      <fieldset class="phr-dc"><legend>Defenses</legend>
        <div class="phr-row">
          <label class="phr-check"><input type="checkbox" name="physical" checked data-recompute> Has a physical component (AC, saves, Hardness, HP)</label>
        </div>
        <div class="phr-row" data-defenses>
          <label>AC <select name="acRole" data-recompute>${ROLE_OPTIONS}</select>
            <input type="number" name="ac" step="1" data-auto="ac"></label>
          <label>Fort <select name="fortRole" data-recompute>${ROLE_OPTIONS}</select>
            <input type="number" name="fort" step="1" data-auto="fort"></label>
          <label>Ref <select name="refRole" data-recompute><option value="extreme">Extreme</option><option value="high">High</option><option value="low" selected>Low</option></select>
            <input type="number" name="ref" step="1" data-auto="ref"></label>
        </div>
        <div class="phr-row" data-defenses>
          <label>Hardness <input type="number" name="hardness" step="1" data-auto="hardness"></label>
          <label>HP <input type="number" name="hp" step="1" data-auto="hp"></label>
          <label class="phr-check"><input type="checkbox" name="stdImmunities" checked> Immune to critical hits &amp; precision</label>
        </div>
      </fieldset>

      <fieldset class="phr-dc"><legend>Offense</legend>
        <div class="phr-row">
          <label class="phr-radio"><input type="radio" name="offense" value="strike" checked data-recompute> Strike</label>
          <label class="phr-radio"><input type="radio" name="offense" value="save" data-recompute> Save vs. damage</label>
          <label class="phr-radio"><input type="radio" name="offense" value="none" data-recompute> None / manual</label>
        </div>
        <div class="phr-row" data-offense-strike>
          <label>Strike name <input type="text" name="strikeName" placeholder="e.g. Scythe"></label>
          <label>Attack <input type="number" name="attackBonus" step="1" data-auto="attack"></label>
        </div>
        <div class="phr-row" data-offense-save hidden>
          <label>Save <select name="saveType">
            <option value="reflex" selected>Reflex</option>
            <option value="fortitude">Fortitude</option>
            <option value="will">Will</option>
          </select></label>
          <label>DC role <select name="saveDCRole" data-recompute>
            <option value="extreme">Extreme</option>
            <option value="hard" selected>Hard</option>
          </select></label>
          <label>DC <input type="number" name="saveDC" step="1" data-auto="savedc"></label>
          <label class="phr-check"><input type="checkbox" name="basicSave" checked> Basic</label>
        </div>
        <div class="phr-row" data-offense-damage>
          <label>Damage <input type="text" name="damage" data-auto="damage" placeholder="e.g. 4d8+10"></label>
          <label>Type <select name="damageType">${damageTypes}</select></label>
        </div>
      </fieldset>

      <fieldset class="phr-dc"><legend>Text</legend>
        <div class="phr-row">
          <label class="phr-label-field">Trigger <input type="text" name="trigger" placeholder="e.g. A creature steps on the pressure plate"></label>
        </div>
        <div class="phr-row">
          <label class="phr-label-field">Description <input type="text" name="description" placeholder="What the hazard looks like / is"></label>
        </div>
        <div class="phr-row">
          <label class="phr-label-field">Reset <input type="text" name="reset" placeholder="e.g. The trap resets after 1 minute"></label>
        </div>
        <div class="phr-row" data-complex-only hidden>
          <label>Routine actions <input type="number" name="routineActions" value="2" min="1" max="4" step="1"></label>
          <label class="phr-label-field">Routine <input type="text" name="routine" placeholder="What the hazard does each round on its initiative"></label>
        </div>
      </fieldset>

      <footer class="phr-buttons">
        <button type="submit" class="phr-primary"><i class="fa-solid fa-triangle-exclamation"></i> Create Hazard</button>
        <button type="button" data-cancel>Cancel</button>
      </footer>
    </form>`;
  }

  _onRender() {
    const html = this.element;
    const form = html.querySelector("form.phr-body");

    form.addEventListener("change", (event) => {
      if (event.target.matches("[data-recompute]")) this.#recompute();
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.#create();
    });
    html.querySelector("[data-cancel]").addEventListener("click", () => this.close());
    this.#recompute();
    html.querySelector("input[name=name]").focus();
  }

  /** Refill all table-derived fields from level/complexity/role selections. */
  #recompute() {
    const html = this.element;
    const form = html.querySelector("form.phr-body");
    const data = new foundry.applications.ux.FormDataExtended(form).object;
    const level = clampLevel(data.level);
    const complex = data.complexity === "complex";
    const sd = STEALTH_DISABLE_DCS[level];
    const def = DEFENSES[level];
    const off = OFFENSE[level];
    const roleIndex = { extreme: 0, high: 1, low: 2 };

    const set = (name, value) => {
      const el = form.querySelector(`[name="${name}"]`);
      if (el) el.value = value;
    };
    set("stealthDC", sd[roleIndex[data.stealthRole]]);
    set("disableDC", sd[roleIndex[data.disableRole]]);
    set("ac", def[roleIndex[data.acRole]]);
    set("fort", def[3 + roleIndex[data.fortRole]]);
    set("ref", def[3 + roleIndex[data.refRole]]);
    set("hardness", def[6]);
    set("hp", def[7]);
    set("attackBonus", complex ? off[1] : off[0]);
    set("damage", complex ? off[3] : off[2]);
    set("saveDC", data.saveDCRole === "extreme" ? off[4] : off[5]);

    html.querySelector("[data-minprof]").textContent = `min. proficiency: ${minimumProficiency(level)}`;
    for (const el of html.querySelectorAll("[data-defenses]")) el.hidden = !data.physical;
    for (const el of html.querySelectorAll("[data-complex-only]")) el.hidden = !complex;
    html.querySelector("[data-offense-strike]").hidden = data.offense !== "strike";
    html.querySelector("[data-offense-save]").hidden = data.offense !== "save";
    html.querySelector("[data-offense-damage]").hidden = data.offense === "none";
  }

  async #create() {
    const form = this.element.querySelector("form.phr-body");
    const f = new foundry.applications.ux.FormDataExtended(form).object;
    if (!f.name?.trim()) return void ui.notifications.warn("Give the hazard a name.");

    const level = clampLevel(f.level);
    const complex = f.complexity === "complex";
    const traits = [
      ...new Set(
        [...form.querySelectorAll("input[name=traits]:checked")]
          .map((el) => el.value)
          .concat((f.extraTraits ?? "").split(",").map((t) => t.trim().toLowerCase()).filter((t) => t)),
      ),
    ];
    const complexity = complex ? "complex" : "simple";
    const damageInline = f.damage?.trim() ? `@Damage[${f.damage.trim()}[${f.damageType}]]` : "";
    const rank = minimumProficiency(level);

    // Disable text with a live check button, matching published hazards
    const disableSkillLabel = game.i18n.localize(CONFIG.PF2E.skills[f.disableSkill]?.label ?? f.disableSkill);
    const disableTraits = f.disableSkill === "thievery" ? "|traits:action:disable-a-device" : "";
    const disable = `<p>@Check[${f.disableSkill}|dc:${f.disableDC}${disableTraits}]{${disableSkillLabel}} (${rank}) ${f.disableGoal?.trim() || "to disable the hazard"}</p>`;

    // Trigger/effect reaction item
    const trigger = f.trigger?.trim() || "A creature enters the hazard's area";
    const effect = (() => {
      const parts = [];
      if (f.offense === "strike") {
        parts.push(`The hazard makes ${f.strikeName?.trim() ? `a ${f.strikeName.trim().toLowerCase()}` : "a"} Strike against the triggering creature`);
      } else if (f.offense === "save") {
        parts.push(
          `The triggering creature takes ${damageInline} damage` +
            ` (@Check[${f.saveType}|dc:${f.saveDC}${f.basicSave ? "|basic" : ""}])`,
        );
      } else {
        parts.push("Describe the hazard's effect here");
      }
      if (complex) parts.push("then the hazard rolls initiative");
      return `${parts.join(", ")}.`;
    })();

    const items = [
      {
        name: f.name.trim(),
        type: "action",
        img: "systems/pf2e/icons/actions/Reaction.webp",
        system: {
          actionType: { value: "reaction" },
          actions: { value: null },
          description: {
            value: `<p><strong>Trigger</strong> ${trigger}</p>\n<hr />\n<p><strong>Effect</strong> ${effect}</p>`,
          },
          traits: { rarity: "common", value: f.offense === "strike" ? ["attack"] : [] },
        },
      },
    ];

    if (f.offense === "strike") {
      items.push({
        name: f.strikeName?.trim() || "Strike",
        type: "melee",
        img: "systems/pf2e/icons/default-icons/melee.svg",
        system: {
          bonus: { value: Number(f.attackBonus) || 0 },
          damageRolls: {
            [foundry.utils.randomID(20).toLowerCase()]: {
              damage: f.damage?.trim() || "1d6",
              damageType: f.damageType,
            },
          },
          traits: { rarity: "common", value: [] },
        },
      });
    }

    const routineText = complex
      ? `<p>(${Number(f.routineActions) || 2} actions) ${f.routine?.trim() || "Describe what the hazard does on each of its turns."}${
          f.offense === "strike" ? ` The hazard makes a ${f.strikeName?.trim().toLowerCase() || "strike"} Strike (no multiple attack penalty).` : ""
        }${f.offense === "save" ? ` Each creature in the area takes ${damageInline} damage (@Check[${f.saveType}|dc:${f.saveDC}${f.basicSave ? "|basic" : ""}]).` : ""}</p>`
      : "";

    const physical = !!f.physical;
    const actorData = {
      name: f.name.trim(),
      type: "hazard",
      img: "systems/pf2e/icons/default-icons/hazard.svg",
      items,
      system: {
        attributes: {
          ac: { value: physical ? Number(f.ac) || 0 : 0 },
          hardness: physical ? Number(f.hardness) || 0 : 0,
          hasHealth: physical,
          hp: physical
            ? { value: Number(f.hp) || 0, max: Number(f.hp) || 0, details: `BT ${Math.floor((Number(f.hp) || 0) / 2)}` }
            : { value: 0, max: 0, details: "" },
          immunities: physical && f.stdImmunities ? [{ type: "critical-hits" }, { type: "precision" }] : [],
          stealth: {
            value: (Number(f.stealthDC) || 10) - 10,
            details: `<p>(${rank})</p>`,
          },
          emitsSound: "encounter",
        },
        details: {
          level: { value: level },
          isComplex: complex,
          description: f.description?.trim() ? `<p>${f.description.trim()}</p>` : "",
          disable,
          reset: f.reset?.trim() ? `<p>${f.reset.trim()}</p>` : "",
          routine: routineText,
        },
        saves: {
          fortitude: { value: physical ? Number(f.fort) || 0 : 0, saveDetail: "" },
          reflex: { value: physical ? Number(f.ref) || 0 : 0, saveDetail: "" },
          will: { value: 0, saveDetail: "" },
        },
        traits: { rarity: f.rarity, size: { value: "med" }, value: traits },
      },
    };

    const actor = await Actor.create(actorData);
    if (actor) {
      ui.notifications.info(`Created ${complexity} hazard "${actor.name}" (level ${level}).`);
      actor.sheet.render(true);
      this.close();
    }
  }
}

/* -------------------------------------------- */
/*  Entry points                                 */
/* -------------------------------------------- */

Hooks.on("renderActorDirectory", (app, html) => {
  if (game.system.id !== "pf2e" || !game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root || root.querySelector(".phr-build-hazard")) return;
  const footer = root.querySelector(".directory-footer");
  if (!footer) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "phr-build-hazard";
  button.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Build Hazard';
  button.addEventListener("click", () => HazardBuilder.open());
  footer.append(button);
});

Hooks.once("ready", () => {
  if (game.system.id !== "pf2e") return;
  const module = game.modules.get(MODULE_ID);
  module.api ??= {};
  module.api.hazardBuilder = { open: () => HazardBuilder.open() };
});
