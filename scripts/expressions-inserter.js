/**
 * PF2e Expressions Inserter
 *
 * Quick-Insert-style helper for authoring PF2e inline expressions:
 *   @Check[...]  @Damage[...]  @Template[...]  [[/act ...]]  [[/r ...]]
 *
 * Open with Ctrl+Shift+K (rebindable in Configure Controls) or via
 * Format ▸ "PF2e Expression…" in the rich-text editor menu. If a ProseMirror
 * editor was focused, the result is inserted at the cursor; otherwise it can
 * be copied to the clipboard or posted to chat.
 *
 * Load-bearing facts:
 *   - Param surface verified against the system enricher
 *     (src/module/system/text-editor.ts #createCheck/#createDamageRoll) and
 *     the system's own CheckPromptGenerator: type lists are comma-joined,
 *     numeric adjustments are baked into dc, `against`/`defense` excludes dc.
 *   - EditorViews are captured from `menu.view` in the
 *     getProseMirrorMenuDropDowns hook (WeakMap keyed on view.dom). Foundry
 *     keybindings do not fire while a text field/editor has focus, so an
 *     additional capture-phase keydown listener handles the in-editor hotkey;
 *     the two paths cannot double-fire.
 *   - DC tables mirror src/module/dc.ts (level-based, simple, adjustments)
 *     including the Proficiency-Without-Level variant.
 */

const MODULE_ID = "pf2e-house-rules";

/* -------------------------------------------- */
/*  DC math (mirrors pf2e src/module/dc.ts)     */
/* -------------------------------------------- */

const DC_BY_LEVEL = new Map([
  [-1, 13], [0, 14], [1, 15], [2, 16], [3, 18], [4, 19], [5, 20], [6, 22],
  [7, 23], [8, 24], [9, 26], [10, 27], [11, 28], [12, 30], [13, 31], [14, 32],
  [15, 34], [16, 35], [17, 36], [18, 38], [19, 39], [20, 40], [21, 42],
  [22, 44], [23, 46], [24, 48], [25, 50],
]);

const SIMPLE_DCS = { untrained: 10, trained: 15, expert: 20, master: 30, legendary: 40 };
const SIMPLE_DCS_PWOL = { untrained: 10, trained: 15, expert: 20, master: 25, legendary: 30 };

const DC_ADJUSTMENTS = [
  { value: "incredibly-easy", label: "Incredibly Easy", mod: -10 },
  { value: "very-easy", label: "Very Easy", mod: -5 },
  { value: "easy", label: "Easy", mod: -2 },
  { value: "normal", label: "Normal", mod: 0 },
  { value: "hard", label: "Hard", mod: 2 },
  { value: "very-hard", label: "Very Hard", mod: 5 },
  { value: "incredibly-hard", label: "Incredibly Hard", mod: 10 },
];

function pwolEnabled() {
  return game.pf2e?.settings?.variants?.pwol?.enabled ?? false;
}

export function levelBasedDC(level, { pwol = pwolEnabled() } = {}) {
  const clamped = Math.max(-1, Math.min(25, Math.trunc(Number(level) || 0)));
  const dc = DC_BY_LEVEL.get(clamped) ?? 14;
  return pwol ? dc - Math.max(clamped, 0) : dc;
}

export function simpleDC(rank, { pwol = pwolEnabled() } = {}) {
  return (pwol ? SIMPLE_DCS_PWOL : SIMPLE_DCS)[rank] ?? 10;
}

export function adjustmentModifier(adjustment) {
  return DC_ADJUSTMENTS.find((a) => a.value === adjustment)?.mod ?? 0;
}

export function partyLevel() {
  return game.actors?.party?.level || 1;
}

/* -------------------------------------------- */
/*  Editor-view capture                          */
/* -------------------------------------------- */

/** view.dom -> EditorView, filled as editors construct their menus. */
const editorViews = new WeakMap();

Hooks.on("getProseMirrorMenuDropDowns", (menu, dropdowns) => {
  if (menu.view?.dom) editorViews.set(menu.view.dom, menu.view);
  if ("format" in dropdowns) {
    dropdowns.format.entries.push({
      action: "phr-expression",
      title: "PF2e Expression…",
      priority: 1,
      cmd: () => {
        ExpressionInserter.open({ view: menu.view });
        return true;
      },
    });
  }
});

/** Find the insertion target based on the currently focused element. */
function captureTarget() {
  const active = document.activeElement;
  const pmDom = active?.closest?.(".ProseMirror");
  if (pmDom && editorViews.has(pmDom)) return { view: editorViews.get(pmDom) };
  if (active instanceof HTMLTextAreaElement || (active instanceof HTMLInputElement && active.type === "text")) {
    return { field: active, start: active.selectionStart, end: active.selectionEnd };
  }
  return {};
}

function insertIntoTarget(target, text) {
  if (target.view) {
    const view = target.view;
    view.dispatch(view.state.tr.insertText(text).scrollIntoView());
    view.focus();
    return true;
  }
  if (target.field?.isConnected) {
    const { field, start, end } = target;
    field.setRangeText(text, start ?? field.value.length, end ?? field.value.length, "end");
    field.dispatchEvent(new Event("change", { bubbles: true }));
    field.focus();
    return true;
  }
  return false;
}

async function copyText(text) {
  if (game.clipboard?.copyPlainText) await game.clipboard.copyPlainText(text);
  else await navigator.clipboard.writeText(text);
  ui.notifications.info(`Copied: ${text}`);
}

/* -------------------------------------------- */
/*  Expression assembly                          */
/* -------------------------------------------- */

function slugifyLore(value) {
  const slug = value.toLowerCase().trim().replaceAll(/\s+/g, "-");
  return slug && !slug.includes("lore") ? `${slug}-lore` : slug;
}

function listValue(raw) {
  return (raw ?? "").split(",").map((s) => s.trim()).filter((s) => s);
}

/** Build an @Check[...] string from the check-tab form state. */
function buildCheckExpression(f) {
  const types = [...(f.statistics ?? [])];
  for (const lore of listValue(f.lores).map(slugifyLore)) types.push(lore);
  if (!types.length) return "";

  const dc = (() => {
    if (f.defense) return null;
    let base;
    switch (f.dcMode) {
      case "static": base = Number(f.staticDC); break;
      case "simple": base = simpleDC(f.simpleRank); break;
      default: base = levelBasedDC(f.level);
    }
    if (!Number.isFinite(base)) return null;
    return base + adjustmentModifier(f.adjustment);
  })();

  const traits = listValue(f.traits);
  if (f.action) traits.push(`action:${f.action.toLowerCase().trim().replace(/^action:/, "")}`);
  if (f.secret && !traits.includes("secret")) traits.push("secret");

  const parts = [
    types.join(","),
    Number.isInteger(dc) ? `dc:${dc}` : null,
    f.defense ? `against:${f.defense}` : null,
    f.basic ? "basic" : null,
    traits.length ? `traits:${traits.join(",")}` : null,
    listValue(f.options).length ? `options:${listValue(f.options).join(",")}` : null,
    f.name ? `name:${f.name}` : null,
    f.showDC && f.showDC !== "default" ? `showDC:${f.showDC}` : null,
    f.immutable ? "immutable" : null,
    f.overrideTraits ? "overrideTraits" : null,
  ].filter((p) => p);
  const label = f.label ? `{${f.label}}` : "";
  return `@Check[${parts.join("|")}]${label}`;
}

/** Build an @Damage[...] string from the damage-tab form state. */
function buildDamageExpression(f) {
  const instances = (f.rows ?? [])
    .filter((r) => r.formula?.trim())
    .map((r) => {
      const formula = r.formula.trim();
      const categories = [];
      if (r.persistent) categories.push("persistent");
      const typed = [...categories, r.type].filter((c) => c).join(",");
      if (r.category && r.category !== "none") {
        // splash/precision wrap as (formula[category])[type]
        return typed ? `(${formula}[${r.category}])[${typed}]` : `${formula}[${r.category}]`;
      }
      return typed ? `${formula}[${typed}]` : formula;
    });
  if (!instances.length) return "";

  const parts = [
    instances.join(","),
    listValue(f.traits).length ? `traits:${listValue(f.traits).join(",")}` : null,
    listValue(f.options).length ? `options:${listValue(f.options).join(",")}` : null,
    f.name ? `name:${f.name}` : null,
    f.shortLabel ? "shortLabel" : null,
    f.immutable ? "immutable" : null,
  ].filter((p) => p);
  const label = f.label ? `{${f.label}}` : "";
  return `@Damage[${parts.join("|")}]${label}`;
}

function buildTemplateExpression(f) {
  if (!Number.isFinite(Number(f.distance)) || Number(f.distance) <= 0) return "";
  const parts = [
    `type:${f.shape}`,
    `distance:${Number(f.distance)}`,
    f.shape === "line" && Number(f.width) > 0 ? `width:${Number(f.width)}` : null,
    listValue(f.traits).length ? `traits:${listValue(f.traits).join(",")}` : null,
  ].filter((p) => p);
  const label = f.label ? `{${f.label}}` : "";
  return `@Template[${parts.join("|")}]${label}`;
}

function buildActionExpression(f) {
  const slug = f.action?.toLowerCase().trim();
  if (!slug) return "";
  const parts = [slug];
  if (f.variant?.trim()) parts.push(`variant=${f.variant.trim()}`);
  if (f.statistic?.trim()) parts.push(`statistic=${f.statistic.trim()}`);
  if (f.dc !== "" && Number.isFinite(Number(f.dc))) {
    parts.push(`dc=${Number(f.dc) + adjustmentModifier(f.adjustment)}`);
  } else if (f.defense) {
    parts.push(`dc=${f.defense}`);
  }
  const label = f.label ? `{${f.label}}` : "";
  return `[[/act ${parts.join(" ")}]]${label}`;
}

function buildRollExpression(f) {
  const formula = f.formula?.trim();
  if (!formula) return "";
  const command = f.gm ? "/gmr" : "/r";
  const flavor = f.flavor?.trim() ? ` #${f.flavor.trim()}` : "";
  return `[[${command} ${formula}${flavor}]]${f.label ? `{${f.label}}` : ""}`;
}

/* -------------------------------------------- */
/*  Application                                  */
/* -------------------------------------------- */

const STATISTIC_GROUPS = () => {
  const skills = Object.entries(CONFIG.PF2E.skills ?? {}).map(([slug, data]) => ({
    slug,
    label: game.i18n.localize(data.label ?? slug),
  }));
  const saves = Object.entries(CONFIG.PF2E.saves ?? {}).map(([slug, label]) => ({
    slug,
    label: game.i18n.localize(label),
  }));
  return {
    core: [
      { slug: "perception", label: game.i18n.localize("PF2E.PerceptionLabel") },
      { slug: "flat", label: "Flat Check" },
    ],
    saves,
    skills: skills.sort((a, b) => a.label.localeCompare(b.label)),
  };
};

class ExpressionInserter extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "phr-expression-inserter",
    classes: ["phr-inserter"],
    window: {
      title: "Insert PF2e Expression",
      icon: "fa-solid fa-dice-d20",
      resizable: false,
    },
    position: { width: 620, height: "auto" },
  };

  static #instance = null;
  static #actionIndex = null;

  #target;
  #tab = "check";
  #damageRows = [{ formula: "", type: "fire", persistent: false, category: "none" }];

  constructor(options = {}) {
    super(options);
    this.#target = options.target ?? {};
  }

  /** Open (or refocus) the singleton, capturing the insertion target. */
  static open({ view = null } = {}) {
    if (game.system.id !== "pf2e") return;
    if (this.#instance?.rendered) return this.#instance.bringToFront();
    const target = view ? { view } : captureTarget();
    this.#instance = new this({ target });
    this.#instance.render(true);
    this.#loadActionIndex();
  }

  static async #loadActionIndex() {
    if (this.#actionIndex) return;
    const pack = game.packs.get("pf2e.actionspf2e");
    if (!pack) return void (this.#actionIndex = []);
    const index = await pack.getIndex({ fields: ["system.slug"] });
    this.#actionIndex = index
      .map((a) => ({ slug: a.system?.slug, name: a.name }))
      .filter((a) => a.slug)
      .sort((a, b) => a.slug.localeCompare(b.slug));
    // Populate the datalist if the app is already rendered
    const list = this.#instance?.element?.querySelector("#phr-action-list");
    if (list) list.innerHTML = this.#actionIndex.map((a) => `<option value="${a.slug}">${a.name}</option>`).join("");
  }

  static get actionIndex() {
    return this.#actionIndex ?? [];
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
    const stats = STATISTIC_GROUPS();
    const chip = (s, group) =>
      `<label class="phr-chip" data-group="${group}"><input type="checkbox" name="statistics" value="${s.slug}"><span>${s.label}</span></label>`;
    const adjustmentOptions = DC_ADJUSTMENTS.map(
      (a) => `<option value="${a.value}" ${a.value === "normal" ? "selected" : ""}>${a.label} (${a.mod >= 0 ? "+" : ""}${a.mod})</option>`,
    ).join("");
    const damageTypes = Object.keys(CONFIG.PF2E.damageTypes ?? { untyped: "" })
      .sort()
      .map((t) => `<option value="${t}">${t}</option>`)
      .join("");
    const actionOptions = ExpressionInserter.actionIndex
      .map((a) => `<option value="${a.slug}">${a.name}</option>`)
      .join("");
    const lvl = partyLevel();

    return `
    <nav class="phr-tabs" role="tablist">
      ${["check", "damage", "template", "action", "roll"].map(
        (t) => `<button type="button" class="phr-tab ${t === this.#tab ? "active" : ""}" data-tab="${t}">${t.charAt(0).toUpperCase() + t.slice(1)}</button>`,
      ).join("")}
    </nav>
    <form class="phr-body" autocomplete="off">
      <section class="phr-pane" data-pane="check" ${this.#tab !== "check" ? "hidden" : ""}>
        <div class="phr-chips">
          ${stats.core.map((s) => chip(s, "core")).join("")}
          ${stats.saves.map((s) => chip(s, "save")).join("")}
        </div>
        <div class="phr-chips phr-chips-skills">
          ${stats.skills.map((s) => chip(s, "skill")).join("")}
        </div>
        <div class="phr-row">
          <label>Lore(s) <input type="text" name="lores" placeholder="e.g. Fishing Lore, Herbalism"></label>
        </div>
        <fieldset class="phr-dc">
          <legend>DC</legend>
          <div class="phr-row">
            <label class="phr-radio"><input type="radio" name="dcMode" value="level" checked> Level-based</label>
            <label>Level <input type="number" name="level" value="${lvl}" min="-1" max="25" step="1" title="Defaults to party level"></label>
            <label class="phr-radio"><input type="radio" name="dcMode" value="static"> Static</label>
            <label><input type="number" name="staticDC" placeholder="DC" min="0" step="1"></label>
            <label class="phr-radio"><input type="radio" name="dcMode" value="simple"> Simple</label>
            <select name="simpleRank">
              ${Object.keys(SIMPLE_DCS).map((r) => `<option value="${r}">${r.charAt(0).toUpperCase() + r.slice(1)} (${simpleDC(r)})</option>`).join("")}
            </select>
          </div>
          <div class="phr-row">
            <label>Adjustment <select name="adjustment">${adjustmentOptions}</select></label>
            <label>vs. Defense <select name="defense">
              <option value="">— use DC —</option>
              <option value="ac">AC</option>
              <option value="perception">Perception</option>
              <option value="fortitude">Fortitude</option>
              <option value="reflex">Reflex</option>
              <option value="will">Will</option>
            </select></label>
            <span class="phr-computed" data-computed-dc></span>
          </div>
        </fieldset>
        <details class="phr-advanced"><summary>More options</summary>
          <div class="phr-row">
            <label class="phr-check"><input type="checkbox" name="basic"> Basic save</label>
            <label class="phr-check"><input type="checkbox" name="secret"> Secret</label>
            <label class="phr-check"><input type="checkbox" name="immutable"> Immutable DC</label>
            <label class="phr-check"><input type="checkbox" name="overrideTraits"> Override item traits</label>
          </div>
          <div class="phr-row">
            <label>Action <input type="text" name="action" list="phr-action-list" placeholder="e.g. sense-motive"></label>
            <datalist id="phr-action-list">${actionOptions}</datalist>
            <label>Traits <input type="text" name="traits" placeholder="comma,separated"></label>
          </div>
          <div class="phr-row">
            <label>Roll options <input type="text" name="options" placeholder="e.g. area-effect"></label>
            <label>Name <input type="text" name="name" placeholder="Custom chat title"></label>
            <label>Show DC <select name="showDC">
              <option value="default">Default</option>
              <option value="all">All</option>
              <option value="gm">GM</option>
              <option value="owner">Owner</option>
              <option value="none">None</option>
            </select></label>
          </div>
        </details>
      </section>

      <section class="phr-pane" data-pane="damage" ${this.#tab !== "damage" ? "hidden" : ""}>
        <div class="phr-damage-rows">
          ${this.#damageRows.map((r, i) => this.#damageRowHTML(r, i, damageTypes)).join("")}
        </div>
        <button type="button" class="phr-add-row"><i class="fa-solid fa-plus"></i> Add damage instance</button>
        <details class="phr-advanced"><summary>More options</summary>
          <div class="phr-row">
            <label>Traits <input type="text" name="dmg-traits"></label>
            <label>Roll options <input type="text" name="dmg-options"></label>
          </div>
          <div class="phr-row">
            <label>Name <input type="text" name="dmg-name"></label>
            <label class="phr-check"><input type="checkbox" name="dmg-shortLabel"> Short label</label>
            <label class="phr-check"><input type="checkbox" name="dmg-immutable"> Immutable</label>
          </div>
        </details>
      </section>

      <section class="phr-pane" data-pane="template" ${this.#tab !== "template" ? "hidden" : ""}>
        <div class="phr-row">
          <label>Shape <select name="tpl-shape">
            <option value="burst">Burst</option>
            <option value="cone">Cone</option>
            <option value="emanation">Emanation</option>
            <option value="line">Line</option>
          </select></label>
          <label>Distance (ft) <input type="number" name="tpl-distance" value="30" min="5" step="5"></label>
          <label data-line-only hidden>Width (ft) <input type="number" name="tpl-width" min="5" step="5" placeholder="5"></label>
          <label>Traits <input type="text" name="tpl-traits"></label>
        </div>
      </section>

      <section class="phr-pane" data-pane="action" ${this.#tab !== "action" ? "hidden" : ""}>
        <div class="phr-row">
          <label>Action <input type="text" name="act-action" list="phr-action-list" placeholder="e.g. administer-first-aid"></label>
          <label>Variant <input type="text" name="act-variant" placeholder="e.g. stop-bleeding"></label>
        </div>
        <div class="phr-row">
          <label>Statistic <input type="text" name="act-statistic" placeholder="e.g. thievery (optional)"></label>
          <label>DC <input type="number" name="act-dc" min="0" step="1" placeholder="optional"></label>
          <label>Adjustment <select name="act-adjustment">${adjustmentOptions}</select></label>
        </div>
        <p class="hint">Rolls the action macro with full traits and degrees of success.</p>
      </section>

      <section class="phr-pane" data-pane="roll" ${this.#tab !== "roll" ? "hidden" : ""}>
        <div class="phr-row">
          <label>Formula <input type="text" name="roll-formula" placeholder="e.g. 1d20+17"></label>
          <label>Flavor <input type="text" name="roll-flavor" placeholder="e.g. Counteract"></label>
          <label class="phr-check"><input type="checkbox" name="roll-gm"> GM-only roll</label>
        </div>
      </section>

      <div class="phr-row">
        <label class="phr-label-field">Link label <input type="text" name="label" placeholder="optional {display text}"></label>
      </div>
      <div class="phr-preview">
        <output data-preview></output>
        <span class="phr-preview-rendered" data-rendered></span>
      </div>
      <footer class="phr-buttons">
        <button type="submit" class="phr-primary" data-action-btn="primary">
          ${this.#target.view || this.#target.field ? '<i class="fa-solid fa-arrow-down-to-line"></i> Insert' : '<i class="fa-solid fa-copy"></i> Copy'}
        </button>
        <button type="button" data-action-btn="copy"><i class="fa-solid fa-copy"></i> Copy</button>
        <button type="button" data-action-btn="chat"><i class="fa-solid fa-comment"></i> To Chat</button>
        <button type="button" data-action-btn="cancel">Cancel</button>
      </footer>
    </form>`;
  }

  #damageRowHTML(row, i, damageTypes) {
    return `<div class="phr-row phr-damage-row" data-index="${i}">
      <input type="text" name="dmg-formula-${i}" value="${row.formula}" placeholder="e.g. 2d6+3">
      <select name="dmg-type-${i}">${damageTypes.replace(`value="${row.type}"`, `value="${row.type}" selected`)}</select>
      <label class="phr-check"><input type="checkbox" name="dmg-persistent-${i}" ${row.persistent ? "checked" : ""}> Persistent</label>
      <select name="dmg-category-${i}">
        <option value="none" ${row.category === "none" ? "selected" : ""}>—</option>
        <option value="precision" ${row.category === "precision" ? "selected" : ""}>Precision</option>
        <option value="splash" ${row.category === "splash" ? "selected" : ""}>Splash</option>
      </select>
      <button type="button" class="phr-remove-row" ${this.#damageRows.length === 1 ? "disabled" : ""}><i class="fa-solid fa-trash"></i></button>
    </div>`;
  }

  /* ------------------------------------------ */

  _onRender() {
    const html = this.element;
    const form = html.querySelector("form.phr-body");

    for (const tabBtn of html.querySelectorAll(".phr-tab")) {
      tabBtn.addEventListener("click", () => this.#activateTab(tabBtn.dataset.tab));
    }

    form.addEventListener("input", () => this.#refreshPreview());
    form.addEventListener("change", (event) => {
      // keep damage-row state so re-renders don't lose entries
      const rowEl = event.target.closest(".phr-damage-row");
      if (rowEl) this.#syncDamageRows();
      if (event.target.name === "tpl-shape") {
        html.querySelector("[data-line-only]").hidden = event.target.value !== "line";
      }
      this.#refreshPreview();
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.#submit("primary");
    });

    html.querySelector(".phr-add-row")?.addEventListener("click", () => {
      this.#syncDamageRows();
      this.#damageRows.push({ formula: "", type: "fire", persistent: false, category: "none" });
      this.render();
    });
    html.addEventListener("click", (event) => {
      const remove = event.target.closest(".phr-remove-row");
      if (remove) {
        this.#syncDamageRows();
        this.#damageRows.splice(Number(remove.closest(".phr-damage-row").dataset.index), 1);
        this.render();
      }
      const btn = event.target.closest("[data-action-btn]");
      if (btn && btn.dataset.actionBtn !== "primary") {
        event.preventDefault();
        this.#submit(btn.dataset.actionBtn);
      }
    });

    this.#refreshPreview();
    // Focus the first meaningful field for keyboard flow
    html.querySelector(this.#tab === "check" ? ".phr-chip input" : ".phr-pane:not([hidden]) input")?.focus();
  }

  #activateTab(tab) {
    this.#syncDamageRows();
    this.#tab = tab;
    for (const btn of this.element.querySelectorAll(".phr-tab")) {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    }
    for (const pane of this.element.querySelectorAll(".phr-pane")) {
      pane.hidden = pane.dataset.pane !== tab;
    }
    this.#refreshPreview();
    this.element.querySelector(".phr-pane:not([hidden]) input, .phr-pane:not([hidden]) select")?.focus();
  }

  #formState() {
    const form = this.element.querySelector("form.phr-body");
    const data = new FormData(form);
    const get = (name) => data.get(name)?.toString() ?? "";
    const has = (name) => data.has(name);
    return {
      check: {
        statistics: data.getAll("statistics").map((v) => v.toString()),
        lores: get("lores"),
        dcMode: get("dcMode"),
        level: get("level"),
        staticDC: get("staticDC"),
        simpleRank: get("simpleRank"),
        adjustment: get("adjustment"),
        defense: get("defense"),
        basic: has("basic"),
        secret: has("secret"),
        immutable: has("immutable"),
        overrideTraits: has("overrideTraits"),
        action: get("action"),
        traits: get("traits"),
        options: get("options"),
        name: get("name"),
        showDC: get("showDC"),
        label: get("label"),
      },
      damage: {
        rows: this.element ? this.#readDamageRows() : [],
        traits: get("dmg-traits"),
        options: get("dmg-options"),
        name: get("dmg-name"),
        shortLabel: has("dmg-shortLabel"),
        immutable: has("dmg-immutable"),
        label: get("label"),
      },
      template: {
        shape: get("tpl-shape"),
        distance: get("tpl-distance"),
        width: get("tpl-width"),
        traits: get("tpl-traits"),
        label: get("label"),
      },
      action: {
        action: get("act-action"),
        variant: get("act-variant"),
        statistic: get("act-statistic"),
        dc: get("act-dc"),
        adjustment: get("act-adjustment"),
        label: get("label"),
      },
      roll: {
        formula: get("roll-formula"),
        flavor: get("roll-flavor"),
        gm: has("roll-gm"),
        label: get("label"),
      },
    };
  }

  #readDamageRows() {
    return [...this.element.querySelectorAll(".phr-damage-row")].map((rowEl) => {
      const i = rowEl.dataset.index;
      return {
        formula: rowEl.querySelector(`[name="dmg-formula-${i}"]`)?.value ?? "",
        type: rowEl.querySelector(`[name="dmg-type-${i}"]`)?.value ?? "untyped",
        persistent: rowEl.querySelector(`[name="dmg-persistent-${i}"]`)?.checked ?? false,
        category: rowEl.querySelector(`[name="dmg-category-${i}"]`)?.value ?? "none",
      };
    });
  }

  #syncDamageRows() {
    if (this.element?.querySelector(".phr-damage-row")) this.#damageRows = this.#readDamageRows();
    if (!this.#damageRows.length) this.#damageRows = [{ formula: "", type: "fire", persistent: false, category: "none" }];
  }

  #currentExpression() {
    const state = this.#formState();
    switch (this.#tab) {
      case "check": return buildCheckExpression(state.check);
      case "damage": return buildDamageExpression(state.damage);
      case "template": return buildTemplateExpression(state.template);
      case "action": return buildActionExpression(state.action);
      case "roll": return buildRollExpression(state.roll);
      default: return "";
    }
  }

  async #refreshPreview() {
    const expression = this.#currentExpression();
    const preview = this.element.querySelector("[data-preview]");
    if (preview) preview.textContent = expression || "—";

    // computed DC hint
    const state = this.#formState().check;
    const computedEl = this.element.querySelector("[data-computed-dc]");
    if (computedEl) {
      if (state.defense) {
        computedEl.textContent = `vs. ${state.defense}`;
      } else {
        const base = state.dcMode === "static" ? Number(state.staticDC)
          : state.dcMode === "simple" ? simpleDC(state.simpleRank)
          : levelBasedDC(state.level);
        computedEl.textContent = Number.isFinite(base) ? `DC ${base + adjustmentModifier(state.adjustment)}` : "";
      }
    }

    // Live enriched render so the button can be eyeballed before inserting
    const rendered = this.element.querySelector("[data-rendered]");
    if (rendered) {
      if (expression) {
        try {
          rendered.innerHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(expression);
        } catch {
          rendered.textContent = "";
        }
      } else {
        rendered.textContent = "";
      }
    }
  }

  async #submit(mode) {
    if (mode === "cancel") return this.close();
    const expression = this.#currentExpression();
    if (!expression) {
      ui.notifications.warn("Nothing to insert yet — fill in the required fields.");
      return;
    }
    switch (mode) {
      case "primary":
        if (insertIntoTarget(this.#target, expression)) break;
        await copyText(expression);
        break;
      case "copy":
        await copyText(expression);
        return; // keep the dialog open for further copies
      case "chat":
        await ChatMessage.create({ content: expression, speaker: { alias: game.user.name } });
        return;
    }
    this.close();
  }
}

/* -------------------------------------------- */
/*  Entry points                                 */
/* -------------------------------------------- */

Hooks.once("init", () => {
  if (game.system.id !== "pf2e") return;

  game.keybindings.register(MODULE_ID, "openExpressionInserter", {
    name: "Open PF2e Expression Inserter",
    hint: "Build an inline @Check/@Damage/@Template expression. Inserts into the focused editor, otherwise copies to the clipboard.",
    editable: [{ key: "KeyK", modifiers: ["Control", "Shift"] }],
    onDown: () => {
      ExpressionInserter.open();
      return true;
    },
  });

  // Foundry keybindings are suppressed while a text field or editor has
  // focus, so catch the default combo ourselves inside ProseMirror editors.
  document.addEventListener(
    "keydown",
    (event) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.code !== "KeyK") return;
      if (!document.activeElement?.closest?.(".ProseMirror")) return;
      event.preventDefault();
      event.stopPropagation();
      ExpressionInserter.open();
    },
    true,
  );
});

/** Console/macro access: game.modules.get("pf2e-house-rules").api.expressions */
Hooks.once("ready", () => {
  if (game.system.id !== "pf2e") return;
  const module = game.modules.get(MODULE_ID);
  module.api ??= {};
  module.api.expressions = { open: (options) => ExpressionInserter.open(options), levelBasedDC, simpleDC, partyLevel };
});
