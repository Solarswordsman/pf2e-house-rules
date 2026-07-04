/**
 * PF2e Infiltration Builder
 *
 * GM tool for authoring GM Core Infiltration-subsystem challenges (and any
 * infiltration-shaped skill challenge): sequential objectives, obstacles
 * with one or more skill/save options at party-level DCs (standard /
 * hard / very hard), failure consequences (damage, conditions, extra AP),
 * complications, opportunities, and the standard preparation activities.
 *
 * Output is a journal entry with live inline @Check / @Damage buttons and
 * an Awareness Point threshold table derived from total Infiltration
 * Points (failure at 2x total IP, per GM Core). Everything is ordinary
 * journal text afterward — edit freely.
 *
 * Opens from the "Build Infiltration" button in the Journal directory
 * footer, or game.modules.get("pf2e-house-rules").api.infiltration.open().
 */

import { levelBasedDC, partyLevel } from "./expressions-inserter.js";

const MODULE_ID = "pf2e-house-rules";

/** GM Core difficulty steps applied on top of the level-based DC. */
const DIFFICULTIES = [
  { value: "standard", label: "Standard", mod: 0 },
  { value: "hard", label: "Hard", mod: 2 },
  { value: "very-hard", label: "Very Hard", mod: 5 },
];

/** Preparation activities, IDs taken from the system's GM-screen journal. */
const PREP_ACTIVITIES = [
  ["IGPbMkKjnlFW1w1a", "Bribe Contact"],
  ["7dq6bpYvLArJ5odx", "Forge Documents"],
  ["MLchOIG6uLvzK3r0", "Gain Contact"],
  ["BCp3tn2HATUOUEdQ", "Gossip"],
  ["EcDcowQ8vS6cEfXd", "Scout Location"],
  ["iEYZ5PAim5Cvbila", "Secure Disguises"],
];

const CONDITION_CHOICES = [
  "", "Clumsy", "Drained", "Enfeebled", "Fatigued", "Frightened", "Off-Guard",
  "Sickened", "Slowed", "Stupefied",
];

function difficultyMod(value) {
  return DIFFICULTIES.find((d) => d.value === value)?.mod ?? 0;
}

function statisticChoices() {
  const skills = Object.entries(CONFIG.PF2E.skills ?? {})
    .map(([slug, data]) => [slug, game.i18n.localize(data.label ?? slug)])
    .sort((a, b) => a[1].localeCompare(b[1]));
  return [
    ["auto", "— No check (spell/item, auto 1 IP) —"],
    ["perception", game.i18n.localize("PF2E.PerceptionLabel")],
    ...skills,
    ["fortitude", "Fortitude save"],
    ["reflex", "Reflex save"],
    ["will", "Will save"],
  ];
}

function newCheck() {
  return { statistic: "thievery", difficulty: "standard" };
}

function newObstacle() {
  return {
    name: "",
    ip: 2,
    scope: "group",
    checks: [newCheck()],
    description: "",
    consequence: "",
    damage: "",
    damageType: "bludgeoning",
    condition: "",
    conditionValue: 1,
  };
}

function newObjective() {
  return { name: "", obstacles: [newObstacle()] };
}

function newComplication() {
  return { trigger: "", name: "", checks: [newCheck()], effect: "" };
}

function newOpportunity() {
  return { name: "", requirement: "", checks: [newCheck()], benefit: "" };
}

/* -------------------------------------------- */
/*  Application                                  */
/* -------------------------------------------- */

class InfiltrationBuilder extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "phr-infiltration-builder",
    classes: ["phr-inserter", "phr-infiltration"],
    window: {
      title: "Build Infiltration",
      icon: "fa-solid fa-user-ninja",
      resizable: true,
    },
    position: { width: 720, height: 700 },
  };

  static #instance = null;

  static open() {
    if (game.system.id !== "pf2e" || !game.user.isGM) return;
    if (this.#instance?.rendered) return this.#instance.bringToFront();
    this.#instance = new this();
    this.#instance.render(true);
  }

  #state = {
    title: "",
    level: null, // filled on first render
    objectives: [newObjective()],
    complications: [newComplication()],
    opportunities: [],
    includePrep: true,
  };

  async _renderHTML() {
    this.#state.level ??= partyLevel();
    const wrapper = document.createElement("div");
    wrapper.innerHTML = this.#buildHTML();
    return wrapper;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(...result.children);
  }

  /* ------------------------------------------ */
  /*  Rendering                                  */
  /* ------------------------------------------ */

  #checkRowHTML(check, path) {
    const stats = statisticChoices()
      .map(([slug, label]) => `<option value="${slug}" ${slug === check.statistic ? "selected" : ""}>${label}</option>`)
      .join("");
    const diffs = DIFFICULTIES.map(
      (d) =>
        `<option value="${d.value}" ${d.value === check.difficulty ? "selected" : ""}>${d.label} (DC ${levelBasedDC(this.#state.level) + d.mod})</option>`,
    ).join("");
    return `<div class="phr-row phr-check-row" data-path="${path}">
      <select data-field="statistic">${stats}</select>
      <select data-field="difficulty" ${check.statistic === "auto" ? "disabled" : ""}>${diffs}</select>
      <button type="button" data-add-check="${path}" title="Add alternative check"><i class="fa-solid fa-plus"></i></button>
      <button type="button" data-remove-check="${path}" title="Remove check"><i class="fa-solid fa-minus"></i></button>
    </div>`;
  }

  #obstacleHTML(obstacle, oi, bi) {
    const base = `objectives.${oi}.obstacles.${bi}`;
    const conditions = CONDITION_CHOICES.map(
      (c) => `<option value="${c}" ${c === obstacle.condition ? "selected" : ""}>${c || "— no condition —"}</option>`,
    ).join("");
    return `<div class="phr-obstacle" data-path="${base}">
      <div class="phr-row">
        <label class="phr-label-field">Obstacle <input type="text" data-field="name" value="${foundry.utils.escapeHTML(obstacle.name)}" placeholder="e.g. Guard Post"></label>
        <label>IP <input type="number" data-field="ip" value="${obstacle.ip}" min="1" max="9" step="1"></label>
        <label><select data-field="scope">
          <option value="group" ${obstacle.scope === "group" ? "selected" : ""}>Group</option>
          <option value="individual" ${obstacle.scope === "individual" ? "selected" : ""}>Individual</option>
        </select></label>
        <button type="button" data-remove-obstacle="${base}" title="Remove obstacle"><i class="fa-solid fa-trash"></i></button>
      </div>
      ${obstacle.checks.map((c, ci) => this.#checkRowHTML(c, `${base}.checks.${ci}`)).join("")}
      <div class="phr-row">
        <label class="phr-label-field">Description <input type="text" data-field="description" value="${foundry.utils.escapeHTML(obstacle.description)}" placeholder="What stands in the way, and what overcoming it looks like"></label>
      </div>
      <div class="phr-row">
        <label class="phr-label-field">Failure consequence <input type="text" data-field="consequence" value="${foundry.utils.escapeHTML(obstacle.consequence)}" placeholder="Besides Awareness Points, e.g. the PC is spotted by a patrol"></label>
        <label>Damage <input type="text" data-field="damage" value="${foundry.utils.escapeHTML(obstacle.damage)}" placeholder="e.g. 2d6" size="6"></label>
        <select data-field="damageType">${Object.keys(CONFIG.PF2E.damageTypes ?? { untyped: "" })
          .sort()
          .map((t) => `<option value="${t}" ${t === obstacle.damageType ? "selected" : ""}>${t}</option>`)
          .join("")}</select>
        <select data-field="condition">${conditions}</select>
        <input type="number" data-field="conditionValue" value="${obstacle.conditionValue}" min="1" max="4" step="1" title="Condition value" style="width:3.5rem">
      </div>
    </div>`;
  }

  #buildHTML() {
    const s = this.#state;
    const totalIP = this.#totalIP();
    return `
    <form class="phr-body" autocomplete="off">
      <div class="phr-row">
        <label class="phr-label-field">Title <input type="text" data-field="title" data-path="" value="${foundry.utils.escapeHTML(s.title)}" placeholder="e.g. Heist at the Silk Consortium"></label>
        <label>Party level <input type="number" data-field="level" data-path="" value="${s.level}" min="-1" max="25" step="1"></label>
        <span class="phr-computed">Standard DC ${levelBasedDC(s.level)} · total ${totalIP} IP · fails at ${totalIP * 2} AP</span>
      </div>

      ${s.objectives
        .map(
          (objective, oi) => `
      <fieldset class="phr-dc" data-path="objectives.${oi}">
        <legend>Objective ${oi + 1}</legend>
        <div class="phr-row">
          <label class="phr-label-field">Name <input type="text" data-field="name" value="${foundry.utils.escapeHTML(objective.name)}" placeholder="e.g. Get inside the compound"></label>
          <button type="button" data-remove-objective="${oi}" ${s.objectives.length === 1 ? "disabled" : ""} title="Remove objective"><i class="fa-solid fa-trash"></i></button>
        </div>
        ${objective.obstacles.map((o, bi) => this.#obstacleHTML(o, oi, bi)).join("")}
        <button type="button" data-add-obstacle="${oi}"><i class="fa-solid fa-plus"></i> Add obstacle</button>
      </fieldset>`,
        )
        .join("")}
      <button type="button" data-add-objective><i class="fa-solid fa-plus"></i> Add objective</button>

      <fieldset class="phr-dc"><legend>Complications</legend>
        ${s.complications
          .map(
            (c, ci) => `
        <div class="phr-obstacle" data-path="complications.${ci}">
          <div class="phr-row">
            <label>Trigger <input type="text" data-field="trigger" value="${foundry.utils.escapeHTML(c.trigger)}" placeholder="e.g. Reaching 5 AP"></label>
            <label class="phr-label-field">Name <input type="text" data-field="name" value="${foundry.utils.escapeHTML(c.name)}" placeholder="e.g. Do I Know You?"></label>
            <button type="button" data-remove-complication="${ci}" title="Remove"><i class="fa-solid fa-trash"></i></button>
          </div>
          ${c.checks.map((ch, xi) => this.#checkRowHTML(ch, `complications.${ci}.checks.${xi}`)).join("")}
          <div class="phr-row">
            <label class="phr-label-field">Effect / overcoming <input type="text" data-field="effect" value="${foundry.utils.escapeHTML(c.effect)}" placeholder="What happens and how the PCs get out of it"></label>
          </div>
        </div>`,
          )
          .join("")}
        <button type="button" data-add-complication><i class="fa-solid fa-plus"></i> Add complication</button>
      </fieldset>

      <fieldset class="phr-dc"><legend>Opportunities</legend>
        ${s.opportunities
          .map(
            (o, pi) => `
        <div class="phr-obstacle" data-path="opportunities.${pi}">
          <div class="phr-row">
            <label class="phr-label-field">Name <input type="text" data-field="name" value="${foundry.utils.escapeHTML(o.name)}" placeholder="e.g. Smooth the Path"></label>
            <label>Requirement <input type="text" data-field="requirement" value="${foundry.utils.escapeHTML(o.requirement)}" placeholder="optional"></label>
            <button type="button" data-remove-opportunity="${pi}" title="Remove"><i class="fa-solid fa-trash"></i></button>
          </div>
          ${o.checks.map((ch, xi) => this.#checkRowHTML(ch, `opportunities.${pi}.checks.${xi}`)).join("")}
          <div class="phr-row">
            <label class="phr-label-field">Benefit <input type="text" data-field="benefit" value="${foundry.utils.escapeHTML(o.benefit)}" placeholder="e.g. Reduce AP by 1, or the next PC gets a +2 circumstance bonus"></label>
          </div>
        </div>`,
          )
          .join("")}
        <button type="button" data-add-opportunity><i class="fa-solid fa-plus"></i> Add opportunity</button>
      </fieldset>

      <div class="phr-row">
        <label class="phr-check"><input type="checkbox" data-field="includePrep" data-path="" ${s.includePrep ? "checked" : ""}> Include preparation activities page (Edge Points)</label>
      </div>

      <footer class="phr-buttons">
        <button type="submit" class="phr-primary"><i class="fa-solid fa-user-ninja"></i> Create Journal</button>
        <button type="button" data-cancel>Cancel</button>
      </footer>
    </form>`;
  }

  /* ------------------------------------------ */
  /*  State plumbing                             */
  /* ------------------------------------------ */

  #totalIP() {
    return this.#state.objectives
      .flatMap((o) => o.obstacles)
      .reduce((sum, o) => sum + (Number(o.ip) || 0), 0);
  }

  #resolvePath(path) {
    if (!path) return this.#state;
    return path.split(".").reduce((node, key) => node?.[key], this.#state);
  }

  /** Persist every data-field input back into #state (called before re-render). */
  #syncState() {
    for (const el of this.element.querySelectorAll("[data-field]")) {
      const path = el.dataset.path ?? el.closest("[data-path]")?.dataset.path ?? "";
      const node = this.#resolvePath(path);
      if (!node) continue;
      const field = el.dataset.field;
      if (el.type === "checkbox") node[field] = el.checked;
      else if (el.type === "number") node[field] = Number(el.value);
      else node[field] = el.value;
    }
  }

  _onRender() {
    const html = this.element;
    const form = html.querySelector("form.phr-body");

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.#syncState();
      this.#create();
    });
    html.querySelector("[data-cancel]").addEventListener("click", () => this.close());

    form.addEventListener("change", (event) => {
      // Level changes re-render so all displayed DCs update
      if (event.target.dataset.field === "level") {
        this.#syncState();
        this.render();
      }
      // Statistic "auto" disables the difficulty select
      if (event.target.dataset.field === "statistic") {
        const row = event.target.closest(".phr-check-row");
        row.querySelector("[data-field=difficulty]").disabled = event.target.value === "auto";
      }
      if (event.target.dataset.field === "ip") {
        this.#syncState();
        this.render();
      }
    });

    form.addEventListener("click", (event) => {
      const button = event.target.closest("button[type=button]");
      if (!button || button.hasAttribute("data-cancel")) return;
      const d = button.dataset;
      const mutate = (fn) => {
        this.#syncState();
        fn();
        this.render();
      };
      if ("addObjective" in d) return mutate(() => this.#state.objectives.push(newObjective()));
      if ("removeObjective" in d) return mutate(() => this.#state.objectives.splice(Number(d.removeObjective), 1));
      if ("addObstacle" in d) return mutate(() => this.#state.objectives[Number(d.addObstacle)].obstacles.push(newObstacle()));
      if ("removeObstacle" in d)
        return mutate(() => {
          const parts = d.removeObstacle.split(".");
          this.#state.objectives[Number(parts[1])].obstacles.splice(Number(parts[3]), 1);
        });
      if ("addComplication" in d) return mutate(() => this.#state.complications.push(newComplication()));
      if ("removeComplication" in d) return mutate(() => this.#state.complications.splice(Number(d.removeComplication), 1));
      if ("addOpportunity" in d) return mutate(() => this.#state.opportunities.push(newOpportunity()));
      if ("removeOpportunity" in d) return mutate(() => this.#state.opportunities.splice(Number(d.removeOpportunity), 1));
      if ("addCheck" in d)
        return mutate(() => {
          const checks = this.#resolvePath(d.addCheck.split(".").slice(0, -1).join("."));
          checks.splice(Number(d.addCheck.split(".").at(-1)) + 1, 0, newCheck());
        });
      if ("removeCheck" in d)
        return mutate(() => {
          const parts = d.removeCheck.split(".");
          const checks = this.#resolvePath(parts.slice(0, -1).join("."));
          if (checks.length > 1) checks.splice(Number(parts.at(-1)), 1);
        });
    });
  }

  /* ------------------------------------------ */
  /*  Journal generation                         */
  /* ------------------------------------------ */

  #checkInline(check) {
    if (check.statistic === "auto") return "<em>no check — a relevant spell, item, or clever plan grants 1 IP automatically (2 if exceptional)</em>";
    const dc = levelBasedDC(this.#state.level) + difficultyMod(check.difficulty);
    const diffLabel = DIFFICULTIES.find((diff) => diff.value === check.difficulty)?.label ?? "";
    return `@Check[${check.statistic}|dc:${dc}] <em>(${diffLabel.toLowerCase()})</em>`;
  }

  async #consequenceHTML(obstacle, conditionUUIDs) {
    const parts = [];
    if (obstacle.consequence?.trim()) parts.push(obstacle.consequence.trim());
    if (obstacle.damage?.trim()) parts.push(`the PC takes @Damage[${obstacle.damage.trim()}[${obstacle.damageType}]] damage`);
    if (obstacle.condition) {
      const uuid = conditionUUIDs.get(obstacle.condition);
      const withValue = ["Clumsy", "Drained", "Enfeebled", "Frightened", "Sickened", "Slowed", "Stupefied"].includes(obstacle.condition);
      const label = withValue ? `${obstacle.condition} ${obstacle.conditionValue || 1}` : obstacle.condition;
      parts.push(`the PC becomes ${uuid ? `@UUID[${uuid}]{${label}}` : label}`);
    }
    if (!parts.length) return "";
    return `<p><strong>Failure</strong> In addition to Awareness Points, ${parts.join("; ")}.</p>`;
  }

  async #create() {
    const s = this.#state;
    if (!s.title?.trim()) return void ui.notifications.warn("Give the infiltration a title.");

    // Resolve condition UUIDs from the system pack (fall back to plain text)
    const conditionUUIDs = new Map();
    const wanted = new Set(
      s.objectives.flatMap((o) => o.obstacles).map((o) => o.condition).filter((c) => c),
    );
    if (wanted.size) {
      const pack = game.packs.get("pf2e.conditionitems");
      const index = pack ? await pack.getIndex() : [];
      for (const name of wanted) {
        const entry = index.find?.((e) => e.name === name);
        if (entry) conditionUUIDs.set(name, `Compendium.pf2e.conditionitems.Item.${entry._id}`);
      }
    }

    const totalIP = this.#totalIP();
    const failAP = Math.max(4, totalIP * 2);
    const step = failAP / 4;
    const thresholds = [
      [Math.round(step), "Suspicions are raised. Increase the DCs of all remaining obstacles by 1."],
      [Math.round(step * 2), "The first complication occurs, and patrols step up."],
      [Math.round(step * 3), "Increase the DCs of all remaining obstacles by a total of 2."],
      [failAP, "The infiltration fails: the opposition locates the PCs and responds in force."],
    ];

    const obstacleBlock = async (o) => `
      <h3>${foundry.utils.escapeHTML(o.name?.trim() || "Obstacle")}
        <small>— ${o.ip} IP (${o.scope === "individual" ? "each PC" : "group"})</small></h3>
      ${o.description?.trim() ? `<p>${foundry.utils.escapeHTML(o.description.trim())}</p>` : ""}
      <p><strong>Overcome</strong> ${o.checks.map((c) => this.#checkInline(c)).join(" or ")}</p>
      ${await this.#consequenceHTML(o, conditionUUIDs)}`;

    const pages = [];

    // Overview page
    pages.push({
      name: "Overview",
      type: "text",
      title: { show: true, level: 1 },
      text: {
        format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML,
        content: `
        <p><strong>Party level</strong> ${s.level} · <strong>Standard DC</strong> ${levelBasedDC(s.level)} ·
           <strong>Total Infiltration Points</strong> ${totalIP}</p>
        <h2>Objectives</h2>
        <ol>${s.objectives.map((o) => `<li>${foundry.utils.escapeHTML(o.name?.trim() || "Objective")} (${o.obstacles.reduce((n, ob) => n + (Number(ob.ip) || 0), 0)} IP)</li>`).join("")}</ol>
        <h2>Point Economy</h2>
        <ul>
          <li><strong>Critical Success</strong> 2 Infiltration Points</li>
          <li><strong>Success</strong> 1 Infiltration Point</li>
          <li><strong>Failure</strong> 1 Awareness Point</li>
          <li><strong>Critical Failure</strong> 2 Awareness Points</li>
          <li>+1 Awareness Point at the end of each round of the infiltration.</li>
        </ul>
        <h2>Awareness Thresholds</h2>
        <table>
          <thead><tr><th>AP</th><th>Effect</th></tr></thead>
          <tbody>
          ${thresholds.map(([ap, effect]) => `<tr><td>${ap}</td><td>${effect}</td></tr>`).join("")}
          </tbody>
        </table>
        <p><em>Track current AP here:</em> ☐☐☐☐☐</p>`,
      },
    });

    // One page per objective
    for (const [oi, objective] of s.objectives.entries()) {
      const blocks = [];
      for (const o of objective.obstacles) blocks.push(await obstacleBlock(o));
      pages.push({
        name: `${oi + 1}. ${objective.name?.trim() || `Objective ${oi + 1}`}`,
        type: "text",
        title: { show: true, level: 1 },
        text: { format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML, content: blocks.join("\n<hr />\n") },
      });
    }

    // Complications & opportunities
    const compBlocks = s.complications
      .filter((c) => c.name?.trim() || c.trigger?.trim() || c.effect?.trim())
      .map(
        (c) => `
      <h3>${foundry.utils.escapeHTML(c.name?.trim() || "Complication")}</h3>
      <p><strong>Trigger</strong> ${foundry.utils.escapeHTML(c.trigger?.trim() || "GM discretion")}</p>
      <p><strong>Overcome</strong> ${c.checks.map((ch) => this.#checkInline(ch)).join(" or ")}</p>
      ${c.effect?.trim() ? `<p>${foundry.utils.escapeHTML(c.effect.trim())}</p>` : ""}`,
      );
    const oppBlocks = s.opportunities
      .filter((o) => o.name?.trim() || o.benefit?.trim())
      .map(
        (o) => `
      <h3>${foundry.utils.escapeHTML(o.name?.trim() || "Opportunity")}</h3>
      ${o.requirement?.trim() ? `<p><strong>Requirements</strong> ${foundry.utils.escapeHTML(o.requirement.trim())}</p>` : ""}
      <p><strong>Attempt</strong> ${o.checks.map((ch) => this.#checkInline(ch)).join(" or ")}</p>
      ${o.benefit?.trim() ? `<p><strong>Benefit</strong> ${foundry.utils.escapeHTML(o.benefit.trim())}</p>` : ""}`,
      );
    if (compBlocks.length || oppBlocks.length) {
      pages.push({
        name: "Complications & Opportunities",
        type: "text",
        title: { show: true, level: 1 },
        text: {
          format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML,
          content: [
            compBlocks.length ? `<h2>Complications</h2>${compBlocks.join("\n")}` : "",
            oppBlocks.length ? `<h2>Opportunities</h2>${oppBlocks.join("\n")}` : "",
          ].join("\n"),
        },
      });
    }

    // Preparation page
    if (s.includePrep) {
      pages.push({
        name: "Preparation (Edge Points)",
        type: "text",
        title: { show: true, level: 1 },
        text: {
          format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML,
          content: `
          <p>Before the infiltration begins, each PC can attempt preparation activities to earn
          <strong>Edge Points</strong> — spend an Edge Point to improve a failed infiltration check
          to a success (or apply the activity's specific benefit).</p>
          <ul>
          ${PREP_ACTIVITIES.map(([id, name]) => `<li>@UUID[Compendium.pf2e.actionspf2e.Item.${id}]{${name}}</li>`).join("")}
          </ul>
          <p>Failed preparations can add Awareness Points before the infiltration even begins —
          keep preparation totals secret from the players when appropriate.</p>`,
        },
      });
    }

    const entry = await JournalEntry.create({ name: s.title.trim(), pages });
    if (entry) {
      ui.notifications.info(`Created infiltration "${entry.name}" (${totalIP} IP, fails at ${failAP} AP).`);
      entry.sheet.render(true);
      this.close();
    }
  }
}

/* -------------------------------------------- */
/*  Entry points                                 */
/* -------------------------------------------- */

Hooks.on("renderJournalDirectory", (app, html) => {
  if (game.system.id !== "pf2e" || !game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root || root.querySelector(".phr-build-infiltration")) return;
  const footer = root.querySelector(".directory-footer");
  if (!footer) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "phr-build-infiltration";
  button.innerHTML = '<i class="fa-solid fa-user-ninja"></i> Build Infiltration';
  button.addEventListener("click", () => InfiltrationBuilder.open());
  footer.append(button);
});

Hooks.once("ready", () => {
  if (game.system.id !== "pf2e") return;
  const module = game.modules.get(MODULE_ID);
  module.api ??= {};
  module.api.infiltration = { open: () => InfiltrationBuilder.open() };
});
