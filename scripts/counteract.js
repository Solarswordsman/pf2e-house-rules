/**
 * PF2e Counteract — one-button counteract checks.
 *
 * Counteracting needs two numbers the sheet never shows (your counteract
 * modifier and rank) and two the GM has to dig up (the target's counteract
 * DC and rank). This dialog infers all four with a visible "why", lets you
 * override any of them, previews the outcome per degree of success, and then
 * rolls through the system's own check pipeline so the chat card resolves the
 * degree of success against the DC (honouring the metagame visibility
 * settings) and shows whether the effect is counteracted.
 *
 * Entry points: a "Counteract" header button on character/NPC sheets, a small
 * icon next to each spellcasting entry's DC, an icon on the Effects panel
 * hover card (prefills that effect as the target), the K keybinding (acts for
 * the controlled token / assigned character), and
 * game.modules.get("pf2e-house-rules").api.counteract.open({ actor }).
 *
 * Load-bearing facts (verified against the system source):
 *   - Every spellcasting entry exposes `entry.counteraction`: a Statistic
 *     built from attribute + proficiency only (plus `counteract`-selector
 *     bonuses), which is the rules-correct counteract modifier — NOT the spell
 *     attack modifier (item/status bonuses to spell attacks don't apply).
 *     Innate entries already resolve Charisma + max(trained, best spell rank).
 *     NPC counteraction statistics reuse the entry's base modifier.
 *   - `actor.getStatistic("counteract")` picks the best entry but reduces an
 *     empty list without an initial value on non-casters (throws) — we build
 *     the candidate list ourselves instead.
 *   - `Statistic#check.roll({ dc, extraRollNotes, target, ... })`: passing a
 *     DC makes the system compute the degree of success and filter the notes
 *     by `outcome`; DC/result visibility on the card follows the metagame
 *     settings (DC shown if the opposing actor has a player owner, or the
 *     world shows DCs). Notes accept plain RollNoteSource objects and a
 *     `visibility: "gm"` restriction for the "why" line.
 *   - Effect items carry `system.context.origin.{actor,item}` (UUIDs),
 *     `system.level.value`, and `system.fromSpell`; afflictions carry
 *     `system.save.value`. Cast spell messages carry
 *     `flags.pf2e.origin = { type: "spell", uuid, castRank, rollOptions }`.
 *   - The `Statistic` class isn't on `game.pf2e`; for a custom modifier the
 *     class is reached via `actor.perception.constructor`.
 *   - The Effects panel hover card is a locked core tooltip: `#tooltip`'s
 *     children are moved into a fresh `aside.locked-tooltip` (classes
 *     `pf2e effect-info application`) appended to <body>, with the effect UUID
 *     on the inner `.content[data-item-uuid]`; a body MutationObserver adds
 *     our icon next to the system's edit / send-to-chat icons.
 *   - Character and NPC sheets are AppV1, so header buttons come from the
 *     `get<ClassName>HeaderButtons` hooks.
 *
 * Requires: the PF2e system. No-ops quietly otherwise.
 */

import { levelBasedDC } from "./expressions-inserter.js";

const MODULE_ID = "pf2e-house-rules";

const DEGREES = ["criticalSuccess", "success", "failure", "criticalFailure"];
const DEGREE_LABELS = {
  criticalSuccess: "Critical Success",
  success: "Success",
  failure: "Failure",
  criticalFailure: "Critical Failure",
};
/** Target rank may be at most (yours + allowance) for the counteract to work. */
const RANK_ALLOWANCE = { criticalSuccess: 3, success: 1, failure: -1 };

/* -------------------------------------------- */
/*  Small helpers                                */
/* -------------------------------------------- */

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const loc = (key) => game.i18n.localize(key);
const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);
const toInt = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

function halfLevelRank(level) {
  return Math.max(0, Math.ceil((Number(level) || 0) / 2));
}

function safeFromUuidSync(uuid) {
  if (!uuid || typeof uuid !== "string") return null;
  try {
    return fromUuidSync(uuid);
  } catch {
    return null;
  }
}

/** Resolve an Actor UUID, including synthetic token actors, without async. */
function resolveActor(uuid) {
  if (!uuid) return null;
  if (uuid.includes(".Token.")) {
    const tokenDoc = safeFromUuidSync(uuid.replace(/\.Actor\..+$/, ""));
    return tokenDoc?.actor ?? null;
  }
  const doc = safeFromUuidSync(uuid);
  return doc?.documentName === "Actor" ? doc : null;
}

function traditionLabel(tradition) {
  return tradition ? loc(CONFIG.PF2E?.magicTraditions?.[tradition] ?? tradition) : "";
}

/* -------------------------------------------- */
/*  Who's counteracting: candidate sources       */
/* -------------------------------------------- */

/**
 * Every statistic the actor could plausibly counteract with. Spellcasting
 * entries first (best modifier first), then class DC − 10, then skills
 * (shown collapsed) and a custom modifier.
 */
function collectSources(actor) {
  const sources = [];

  for (const entry of actor.spellcasting?.contents ?? []) {
    if (!entry?.statistic || entry.isRitual || entry.category === "ritual") continue;
    let statistic = null;
    try {
      statistic = entry.counteraction ?? null;
    } catch {
      statistic = null;
    }
    if (!statistic) continue;
    const category = entry.category ? loc(CONFIG.PF2E?.preparationType?.[entry.category] ?? entry.category) : "";
    const why = entry.isInnate
      ? "Innate spells: the entry's attribute (Charisma unless the granting ability says otherwise) + the higher of trained and your best spell proficiency. Bonuses to spell attack rolls don't apply."
      : "Spellcasting attribute + spell proficiency only. Item and status bonuses to spell attack rolls don't apply; only bonuses specific to counteract checks do.";
    const spells = (entry.spells?.contents ?? [])
      .filter((s) => s.system?.counteraction)
      .sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));
    sources.push({
      id: `entry:${entry.id}`,
      kind: "entry",
      entry,
      statistic,
      mod: statistic.mod,
      label: entry.name,
      detail: [traditionLabel(entry.tradition), category].filter(Boolean).join(" · "),
      why,
      defaultRank: Math.min(10, Math.max(1, entry.highestRank || halfLevelRank(actor.level))),
      traits: entry.tradition ? [entry.tradition] : [],
      spells,
    });
  }
  sources.sort((a, b) => b.mod - a.mod);

  for (const stat of Object.values(actor.classDCs ?? {})) {
    if (!stat?.check) continue;
    sources.push({
      id: `classdc:${stat.slug}`,
      kind: "classdc",
      statistic: stat,
      mod: stat.check.mod,
      label: `${loc(stat.label)} − 10`,
      detail: `class DC ${stat.dc.value}`,
      why: "Class DC − 10: for class abilities that counteract without a spell (e.g. the kineticist's Counter Element).",
      defaultRank: halfLevelRank(actor.level),
      traits: [],
      spells: [],
    });
  }

  const skills = Object.values(actor.skills ?? {})
    .filter((s) => s?.check)
    .map((stat) => ({
      id: `skill:${stat.slug}`,
      kind: "skill",
      statistic: stat,
      mod: stat.mod,
      label: loc(stat.label),
      detail: "skill",
      why: "A skill check named by the ability (e.g. Performance for Counter Performance). Normal skill bonuses apply.",
      defaultRank: halfLevelRank(actor.level),
      traits: [],
      spells: [],
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const custom = {
    id: "custom",
    kind: "custom",
    statistic: null,
    mod: null,
    label: "Custom modifier",
    detail: "",
    why: "Use the counteract modifier printed on the ability or item.",
    defaultRank: halfLevelRank(actor.level),
    traits: [],
    spells: [],
  };

  return { sources, skills, custom };
}

/* -------------------------------------------- */
/*  What's being counteracted: candidate targets */
/* -------------------------------------------- */

/** Rank/DC inference for an effect or affliction item sitting on `bearer`. */
function describeEffect(effect, bearer) {
  const ctx = effect.system?.context ?? null;
  const originUuid = ctx?.origin?.actor ?? null;
  const originActor = originUuid ? (originUuid === bearer.uuid ? bearer : resolveActor(originUuid)) : null;
  const originItem = safeFromUuidSync(ctx?.origin?.item);
  const level = Number(effect.system?.level?.value ?? 0) || 0;
  const isAffliction = effect.type === "affliction";
  const isSpell = !!effect.system?.fromSpell || originItem?.type === "spell";

  const rank = isSpell ? Math.max(0, Math.min(10, level)) : halfLevelRank(level);
  const rankWhy = isSpell ? `spell rank ${rank}` : `half of level ${level}, rounded up`;

  let dc = null;
  let dcWhy = "";
  const affDC = Number(effect.system?.save?.value);
  if (isAffliction && Number.isFinite(affDC) && affDC > 0) {
    dc = affDC;
    dcWhy = "the affliction's save DC";
  } else if (originItem?.type === "spell" && originItem.spellcasting?.statistic) {
    dc = originItem.spellcasting.statistic.dc.value;
    dcWhy = `${originActor?.name ?? "the caster"}'s ${traditionLabel(originItem.spellcasting.tradition)} spell DC`.replace(/\s+/g, " ");
  } else if (isSpell && originActor) {
    const stat = originActor.getStatistic?.("spell-dc");
    if (stat) {
      dc = stat.dc.value;
      dcWhy = `${originActor.name}'s spell DC`;
    }
  }
  if (dc === null && originItem?.isOfType?.("physical")) {
    dc = levelBasedDC(originItem.level);
    dcWhy = `level-based DC for ${originItem.name} (item level ${originItem.level})`;
  }
  if (dc === null) {
    const lvl = isSpell ? Math.max(1, 2 * rank - 1) : level;
    dc = levelBasedDC(lvl);
    dcWhy = isSpell
      ? `level-based DC for a rank-${rank} spell (≈ level ${lvl}); the caster couldn't be resolved`
      : `level-based DC for a level-${level} effect`;
  }

  const hostileOrigin = originActor ? originActor.alliance !== bearer.alliance : null;
  return {
    id: effect.uuid,
    kind: "effect",
    effect,
    label: effect.name,
    bearerName: bearer.name,
    originName: originActor?.name ?? null,
    rank,
    rankWhy,
    dc,
    dcWhy,
    hostileOrigin,
  };
}

/** Recent spell casts by the target actor, read from the chat log. */
function castsFromChat(target, tokenDoc, canSeeDetails) {
  const out = [];
  const seen = new Set();
  const messages = game.messages?.contents ?? [];
  for (let i = messages.length - 1, scanned = 0; i >= 0 && scanned < 200 && out.length < 8; i--, scanned++) {
    const message = messages[i];
    const origin = message.flags?.pf2e?.origin;
    if (origin?.type !== "spell" || !message.visible) continue;
    if (Array.isArray(origin.rollOptions) && !origin.rollOptions.includes("origin:action:slug:cast-a-spell")) continue;
    let actor = null;
    try {
      actor = message.actor;
    } catch {
      actor = null;
    }
    const sameToken = tokenDoc && message.speaker?.token === tokenDoc.id && message.speaker?.scene === tokenDoc.parent?.id;
    if (!sameToken && !(actor && actor.uuid === target.uuid)) continue;
    const key = `${origin.uuid}:${origin.castRank ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const spell = safeFromUuidSync(origin.uuid);
    if (spell?.isCantrip) continue;
    const rank = Math.max(0, Math.min(10, Number(origin.castRank) || spell?.rank || 1));
    const stat = spell?.spellcasting?.statistic ?? target.getStatistic?.("spell-dc") ?? null;
    const minutes = Math.max(0, Math.round((Date.now() - (message.timestamp ?? Date.now())) / 60000));
    out.push({
      id: `msg:${message.id}`,
      kind: "cast",
      label: spell?.name ?? message.item?.name ?? "Spell",
      detail: minutes < 1 ? "cast just now" : `cast ${minutes} min ago`,
      bearerName: null,
      originName: target.name,
      rank,
      rankWhy: `cast at rank ${rank}`,
      dc: stat ? stat.dc.value : levelBasedDC(Math.max(1, 2 * rank - 1)),
      dcWhy: stat
        ? `${target.name}'s ${traditionLabel(spell?.spellcasting?.tradition)} spell DC`.replace(/\s+/g, " ")
        : `level-based DC for a rank-${rank} spell`,
      hostileOrigin: null,
      canSeeDetails,
    });
  }
  return out;
}

/** Everything the current target could be: effects on it, and effects/casts it originated. */
function collectTargets(roller, targetActor, tokenDoc) {
  if (!targetActor) return { onTarget: [], castBy: [], fallback: null, allied: false, canSeeDetails: true };
  const isGM = game.user.isGM;
  const canSeeDetails = isGM || targetActor.isOwner;
  const allied = !!roller.alliance && roller.alliance === targetActor.alliance;

  const onTarget = [...(targetActor.itemTypes?.effect ?? []), ...(targetActor.itemTypes?.affliction ?? [])]
    .filter((e) => isGM || e.isIdentified !== false)
    .map((e) => describeEffect(e, targetActor));

  const castBy = [];
  const seen = new Set();
  for (const tok of canvas?.scene?.tokens ?? []) {
    const bearer = tok.actor;
    if (!bearer || bearer.uuid === targetActor.uuid) continue;
    if (!isGM && tok.object && !tok.object.visible) continue;
    for (const e of [...(bearer.itemTypes?.effect ?? []), ...(bearer.itemTypes?.affliction ?? [])]) {
      const origin = e.system?.context?.origin;
      if (!origin?.actor) continue;
      const fromTarget = origin.actor === targetActor.uuid || (tokenDoc && origin.token === tokenDoc.uuid);
      if (!fromTarget || seen.has(e.uuid)) continue;
      if (!isGM && e.isIdentified === false) continue;
      seen.add(e.uuid);
      const d = describeEffect(e, bearer);
      d.detail = `on ${bearer.name}`;
      castBy.push(d);
    }
  }
  castBy.push(...castsFromChat(targetActor, tokenDoc, canSeeDetails));

  // What to assume when no specific effect is picked: the target's own spell DC.
  const spellDC = targetActor.getStatistic?.("spell-dc") ?? null;
  const fallback = spellDC
    ? { dc: spellDC.dc.value, dcWhy: `${targetActor.name}'s spell DC`, rank: null, rankWhy: "unknown — pick an effect or enter it" }
    : {
        dc: levelBasedDC(targetActor.level),
        dcWhy: `level-based DC for ${targetActor.name} (level ${targetActor.level}; no spellcasting found)`,
        rank: halfLevelRank(targetActor.level),
        rankWhy: `half of ${targetActor.name}'s level (${targetActor.level}), rounded up`,
      };

  return { onTarget, castBy, fallback, allied, canSeeDetails };
}

/* -------------------------------------------- */
/*  Outcome math                                 */
/* -------------------------------------------- */

/** Degree index (0 = crit fail … 3 = crit success) for one d20 face. */
function degreeIndex(face, mod, dc) {
  const total = face + mod;
  let i = total >= dc + 10 ? 3 : total >= dc ? 2 : total >= dc - 9 ? 1 : 0;
  if (face === 20) i = Math.min(3, i + 1);
  if (face === 1) i = Math.max(0, i - 1);
  return i;
}

/** Percent chance of each degree, keyed by degree string. */
function degreeOdds(mod, dc) {
  const counts = [0, 0, 0, 0];
  for (let face = 1; face <= 20; face++) counts[degreeIndex(face, mod, dc)]++;
  return {
    criticalFailure: counts[0] * 5,
    failure: counts[1] * 5,
    success: counts[2] * 5,
    criticalSuccess: counts[3] * 5,
  };
}

function totalRange(degree, dc) {
  switch (degree) {
    case "criticalSuccess":
      return `${dc + 10}+`;
    case "success":
      return `${dc}–${dc + 9}`;
    case "failure":
      return `${dc - 9}–${dc - 1}`;
    default:
      return `≤ ${dc - 10}`;
  }
}

/** Whether a given degree counteracts, or null when a rank is unknown. */
function counteracts(degree, myRank, targetRank) {
  if (degree === "criticalFailure") return false;
  if (myRank === null || targetRank === null) return null;
  return targetRank <= myRank + RANK_ALLOWANCE[degree];
}

/* -------------------------------------------- */
/*  Dialog                                       */
/* -------------------------------------------- */

class CounteractDialog extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "phr-counteract",
    classes: ["phr-inserter", "phr-counteract"],
    window: { title: "Counteract Check", icon: "fa-solid fa-hand-sparkles", resizable: true },
    position: { width: 720, height: "auto" },
  };

  static #instance = null;

  /**
   * @param {object} opts
   * @param {Actor} opts.actor            who is counteracting
   * @param {TokenDocument} [opts.token]  their token, if known
   * @param {string} [opts.sourceId]      preselected source id (e.g. "entry:<id>")
   * @param {Item} [opts.effect]          an effect to preselect as the target (overrides user targets)
   */
  static open(opts) {
    if (game.system.id !== "pf2e") return null;
    if (!opts?.actor?.isOfType?.("character", "npc")) {
      ui.notifications.warn("Counteract: select a character or NPC token first.");
      return null;
    }
    if (this.#instance?.rendered) this.#instance.close();
    this.#instance = new this(opts);
    this.#instance.render(true);
    return this.#instance;
  }

  #skipDialog = false;

  constructor(opts) {
    super();
    this.presetEffect = opts.effect ?? null;
    this.#setActor(opts.actor, opts.token ?? null, opts.sourceId ?? null);
    this.#readTarget();
  }

  /** Set (or switch) who is counteracting: rebuilds the source list and its defaults. */
  #setActor(actor, token = null, sourceId = null) {
    this.actor = actor;
    this.token = token ?? actor.token ?? actor.getActiveTokens?.(true, true)?.[0] ?? null;

    const { sources, skills, custom } = collectSources(actor);
    this.sources = sources;
    this.skills = skills;
    this.custom = custom;

    const preferred = sourceId && [...sources, custom].find((s) => s.id === sourceId);
    const initial = preferred || sources.find((s) => s.kind === "entry") || sources[0] || custom;
    this.values = {
      sourceId: initial.id,
      skill: skills[0]?.statistic?.slug ?? "",
      customMod: 0,
      spellId: "",
      rank: initial.defaultRank,
      candidateId: this.values?.candidateId ?? "",
      dc: this.values?.dc ?? null,
      targetRank: this.values?.targetRank ?? null,
    };
  }

  /**
   * Actors this user could counteract with: the current one, controlled tokens,
   * owned tokens on the scene, the assigned character, and (for players) every
   * owned character in the world — players running several PCs need to switch.
   */
  #rollerChoices() {
    const choices = new Map();
    const add = (actor, token = null) => {
      if (!actor?.isOwner || !actor.isOfType?.("character", "npc") || choices.has(actor.uuid)) return;
      choices.set(actor.uuid, { actor, token });
    };
    add(this.actor, this.token);
    for (const t of canvas?.tokens?.controlled ?? []) add(t.actor, t.document);
    for (const t of canvas?.scene?.tokens ?? []) add(t.actor, t);
    add(game.user.character);
    if (!game.user.isGM) for (const a of game.actors ?? []) if (a.type === "character") add(a);
    return [...choices.values()];
  }

  /** (Re)read the target from a preset effect or the user's current targets. */
  #readTarget() {
    let actor = null;
    let tokenDoc = null;
    if (this.presetEffect?.actor) {
      actor = this.presetEffect.actor;
      tokenDoc = actor.token ?? actor.getActiveTokens?.(true, true)?.[0] ?? null;
    } else {
      const targets = [...(game.user.targets ?? [])];
      const token = targets.find((t) => t.actor) ?? null;
      actor = token?.actor ?? null;
      tokenDoc = token?.document ?? null;
    }
    this.target = { actor, token: tokenDoc };
    this.targets = collectTargets(this.actor, actor, tokenDoc);

    // Default pick: the preset effect; otherwise a lone candidate; otherwise,
    // for an allied target, the first effect on them from a hostile source.
    const all = [...this.targets.onTarget, ...this.targets.castBy];
    let pick = null;
    if (this.presetEffect) pick = all.find((c) => c.id === this.presetEffect.uuid) ?? null;
    else if (all.length === 1) pick = all[0];
    else if (this.targets.allied) pick = this.targets.onTarget.find((c) => c.hostileOrigin === true) ?? this.targets.onTarget[0] ?? null;
    this.#applyCandidate(pick?.id ?? "");
  }

  #candidate(id) {
    if (!id) return null;
    return [...this.targets.onTarget, ...this.targets.castBy].find((c) => c.id === id) ?? null;
  }

  #applyCandidate(id) {
    const cand = this.#candidate(id);
    this.values.candidateId = cand ? id : "";
    const info = cand ?? this.targets.fallback;
    this.values.dc = info?.dc ?? null;
    this.values.targetRank = info?.rank ?? null;
  }

  #currentSource() {
    const { sourceId } = this.values;
    if (sourceId === "custom") return { ...this.custom, mod: toInt(this.values.customMod) ?? 0 };
    if (sourceId === "skill") {
      return this.skills.find((s) => s.statistic.slug === this.values.skill) ?? this.skills[0] ?? this.custom;
    }
    return this.sources.find((s) => s.id === sourceId) ?? this.custom;
  }

  /* ---------- rendering ---------- */

  async _renderHTML() {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = this.#buildHTML();
    return wrapper;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(...result.children);
  }

  #buildHTML() {
    const src = this.#currentSource();
    const s = this.values;
    const sourceOptions = [
      ...this.sources.map(
        (x) =>
          `<option value="${esc(x.id)}" ${x.id === s.sourceId ? "selected" : ""}>${esc(x.label)}${x.detail ? ` (${esc(x.detail)})` : ""} ${signed(x.mod)}</option>`,
      ),
      `<option value="skill" ${s.sourceId === "skill" ? "selected" : ""}>Skill…</option>`,
      `<option value="custom" ${s.sourceId === "custom" ? "selected" : ""}>Custom modifier…</option>`,
    ].join("");
    const skillOptions = this.skills
      .map((x) => `<option value="${esc(x.statistic.slug)}" ${x.statistic.slug === s.skill ? "selected" : ""}>${esc(x.label)} ${signed(x.mod)}</option>`)
      .join("");
    const spellOptions = src.spells?.length
      ? `<option value="">— any —</option>` +
        src.spells
          .map((sp) => `<option value="${esc(sp.id)}" ${sp.id === s.spellId ? "selected" : ""}>${esc(sp.name)} (rank ${sp.rank})</option>`)
          .join("")
      : "";
    const breakdown = src.statistic?.check?.breakdown ?? "";
    this.rollers = this.#rollerChoices();
    const rollerPicker =
      this.rollers.length > 1
        ? `<select name="roller" class="phr-ct-roller">${this.rollers
            .map((r) => `<option value="${esc(r.actor.uuid)}" ${r.actor.uuid === this.actor.uuid ? "selected" : ""}>${esc(r.actor.name)}</option>`)
            .join("")}</select>`
        : esc(this.actor.name);

    const T = this.target.actor;
    const { onTarget, castBy, fallback, canSeeDetails } = this.targets;
    const candLabel = (c) => {
      const from = c.originName && c.originName !== T?.name && c.kind !== "cast" ? ` from ${c.originName}` : "";
      const where = c.detail ? ` — ${c.detail}` : "";
      const nums = canSeeDetails ? `rank ${c.rank}, DC ${c.dc}` : `rank ${c.rank}`;
      return `${c.label}${from}${where} (${nums})`;
    };
    const group = (label, list) =>
      list.length
        ? `<optgroup label="${esc(label)}">${list
            .map((c) => `<option value="${esc(c.id)}" ${c.id === s.candidateId ? "selected" : ""}>${esc(candLabel(c))}</option>`)
            .join("")}</optgroup>`
        : "";
    const cand = this.#candidate(s.candidateId);
    const info = cand ?? fallback;

    const targetBlock = T
      ? `
        <select name="candidate">
          <option value="" ${!s.candidateId ? "selected" : ""}>No specific effect — just use ${esc(T.name)}'s DC</option>
          ${group(`On ${T.name}`, onTarget)}
          ${group(`Cast by ${T.name}`, castBy)}
        </select>
        <div class="phr-ct-why" data-target-why>
          ${canSeeDetails ? `<b>DC ${esc(info.dc)}</b>` : "<b>DC hidden</b> (the GM sees it on the card)"} — ${esc(info.dcWhy)}<br>
          <b>Rank ${info.rank ?? "?"}</b> — ${esc(info.rankWhy)}
        </div>
        <div class="phr-row">
          ${
            canSeeDetails
              ? `<label>DC <input type="number" name="dc" value="${s.dc ?? ""}" step="1" min="0"></label>
                 <label data-tooltip="Sets DC and rank from an effect or creature level (GM Core level-based DCs; rank = half level, rounded up)">from level <input type="number" name="level" step="1" min="-1" max="25" placeholder="lvl"></label>`
              : ""
          }
          <label>Target rank <input type="number" name="targetRank" value="${s.targetRank ?? ""}" min="0" max="10" step="1" placeholder="?"></label>
          <a class="phr-ct-refresh" data-refresh-target data-tooltip="Re-read your current target"><i class="fa-solid fa-rotate"></i></a>
        </div>`
      : `
        <p class="phr-ct-empty">No token targeted. The roll posts the full result table and the GM resolves it — or target a token and <a data-refresh-target>re-read</a>.</p>
        <div class="phr-row">
          <label>DC <input type="number" name="dc" value="${s.dc ?? ""}" step="1" min="0" placeholder="?"></label>
          <label data-tooltip="Sets DC and rank from an effect or creature level (GM Core level-based DCs; rank = half level, rounded up)">from level <input type="number" name="level" step="1" min="-1" max="25" placeholder="lvl"></label>
          <label>Target rank <input type="number" name="targetRank" value="${s.targetRank ?? ""}" min="0" max="10" step="1" placeholder="?"></label>
        </div>`;

    return `
    <form class="phr-body phr-ct-form" autocomplete="off">
      <div class="phr-ct-columns">
        <fieldset class="phr-dc"><legend>Who's counteracting — ${rollerPicker}</legend>
          <select name="source">${sourceOptions}</select>
          <div class="phr-row" data-skill-row ${s.sourceId === "skill" ? "" : "hidden"}>
            <label>Skill <select name="skill">${skillOptions}</select></label>
          </div>
          <div class="phr-row" data-custom-row ${s.sourceId === "custom" ? "" : "hidden"}>
            <label>Modifier <input type="number" name="customMod" value="${s.customMod}" step="1"></label>
          </div>
          <div class="phr-ct-mod" data-mod-line>
            <span class="phr-ct-modvalue" data-mod>${src.mod === null ? "?" : signed(src.mod)}</span>
            <span class="phr-ct-breakdown" data-breakdown>${esc(breakdown)}</span>
          </div>
          <div class="phr-ct-why" data-source-why>${esc(src.why)}</div>
          <div class="phr-row">
            <label>Counteract rank <input type="number" name="rank" value="${s.rank}" min="0" max="10" step="1"></label>
            ${spellOptions ? `<label>Spell <select name="spell">${spellOptions}</select></label>` : ""}
          </div>
        </fieldset>
        <fieldset class="phr-dc"><legend>What's being counteracted — ${T ? esc(T.name) : "no target"}</legend>
          ${targetBlock}
        </fieldset>
      </div>

      <table class="phr-ct-verdict">
        <thead><tr><th>Result</th><th>Total needed</th><th>Odds</th><th>Outcome</th></tr></thead>
        <tbody data-verdict-rows></tbody>
      </table>
      <div class="phr-ct-summary" data-summary></div>

      <footer class="phr-buttons">
        <button type="submit" class="phr-primary"><i class="fa-solid fa-dice-d20"></i> Roll Counteract Check</button>
        <button type="button" data-cancel>Cancel</button>
      </footer>
    </form>`;
  }

  _onRender() {
    const form = this.element.querySelector("form.phr-ct-form");
    if (!form) return;
    const s = this.values;

    form.addEventListener("change", (event) => {
      const el = event.target;
      switch (el.name) {
        case "roller": {
          const choice = this.rollers?.find((r) => r.actor.uuid === el.value);
          if (!choice) return;
          this.#setActor(choice.actor, choice.token);
          this.#readTarget();
          this.render();
          return;
        }
        case "source": {
          s.sourceId = el.value;
          s.spellId = "";
          s.rank = this.#currentSource().defaultRank;
          this.render();
          return;
        }
        case "skill":
          s.skill = el.value;
          this.render();
          return;
        case "spell": {
          s.spellId = el.value;
          const spell = this.#currentSource().spells?.find((sp) => sp.id === el.value);
          if (spell) {
            s.rank = spell.rank;
            form.querySelector("[name=rank]").value = spell.rank;
          }
          this.#refreshVerdict();
          return;
        }
        case "candidate":
          this.#applyCandidate(el.value);
          this.render();
          return;
        default:
          return;
      }
    });

    form.addEventListener("input", (event) => {
      const el = event.target;
      switch (el.name) {
        case "customMod":
          s.customMod = toInt(el.value) ?? 0;
          break;
        case "rank":
          s.rank = Math.max(0, Math.min(10, toInt(el.value) ?? 0));
          break;
        case "dc":
          s.dc = toInt(el.value);
          break;
        case "targetRank":
          s.targetRank = toInt(el.value);
          if (s.targetRank !== null) s.targetRank = Math.max(0, Math.min(10, s.targetRank));
          break;
        case "level": {
          const level = toInt(el.value);
          if (level === null) return;
          s.dc = levelBasedDC(level);
          s.targetRank = halfLevelRank(level);
          const dcEl = form.querySelector("[name=dc]");
          if (dcEl) dcEl.value = s.dc;
          form.querySelector("[name=targetRank]").value = s.targetRank;
          break;
        }
        default:
          return;
      }
      this.#refreshVerdict();
    });

    form.addEventListener("click", (event) => {
      // Submit events carry no modifier keys: remember shift from the button click.
      if (event.target.closest("button[type=submit]")) this.#skipDialog = !!event.shiftKey;
      if (event.target.closest("[data-refresh-target]")) {
        event.preventDefault();
        this.presetEffect = null;
        this.#readTarget();
        this.render();
      }
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.#roll(event);
    });
    form.querySelector("[data-cancel]").addEventListener("click", () => this.close());

    this.#refreshVerdict();
  }

  /* ---------- verdict table ---------- */

  #refreshVerdict() {
    const form = this.element?.querySelector("form.phr-ct-form");
    if (!form) return;
    const src = this.#currentSource();
    const mod = src.mod;
    const myRank = this.values.rank;
    const targetRank = this.values.targetRank;
    const dc = this.values.dc;
    const showNumbers = this.targets.canSeeDetails !== false;

    const modEl = form.querySelector("[data-mod]");
    if (modEl) modEl.textContent = mod === null ? "?" : signed(mod);

    const odds = mod !== null && dc !== null ? degreeOdds(mod, dc) : null;
    const rows = DEGREES.map((degree) => {
      const ok = counteracts(degree, myRank, targetRank);
      let outcome;
      let cls;
      if (ok === true) {
        outcome = "✦ Counteracted";
        cls = "ok";
      } else if (ok === false) {
        outcome = degree === "criticalFailure" ? "✗ Fails" : "✗ Rank too high";
        cls = "bad";
      } else {
        const limit = myRank + RANK_ALLOWANCE[degree];
        outcome = degree === "failure" ? `if target rank < ${myRank}` : `if target rank ≤ ${limit}`;
        cls = "na";
      }
      const totals = dc !== null && showNumbers ? totalRange(degree, dc) : "—";
      const chance = odds && showNumbers ? `${odds[degree]}%` : "—";
      return `<tr class="${cls}"><td>${DEGREE_LABELS[degree]}</td><td>${totals}</td><td>${chance}</td><td class="outcome">${outcome}</td></tr>`;
    });
    form.querySelector("[data-verdict-rows]").innerHTML = rows.join("");

    // Summary sentence
    let summary;
    if (targetRank === null) {
      summary = `Target rank unknown: the card will list what each result can counteract (rank ≤ ${myRank + 3} on a crit, ≤ ${myRank + 1} on a success, < ${myRank} on a failure).`;
    } else {
      const fOk = counteracts("failure", myRank, targetRank);
      const sOk = counteracts("success", myRank, targetRank);
      const csOk = counteracts("criticalSuccess", myRank, targetRank);
      if (fOk) summary = `Your rank ${myRank} beats the target's ${targetRank}: anything but a critical failure counteracts it.`;
      else if (sOk) summary = `Rank ${myRank} vs ${targetRank}: a success or better counteracts it.`;
      else if (csOk) summary = `Rank ${myRank} is 2–3 below ${targetRank}: only a critical success counteracts it.`;
      else summary = `Rank ${myRank} is more than 3 below ${targetRank}: it can't be counteracted. You'd need rank ${targetRank - 3}.`;
      if (odds && showNumbers) {
        const chance = DEGREES.filter((d) => counteracts(d, myRank, targetRank)).reduce((sum, d) => sum + odds[d], 0);
        summary += ` Chance to counteract: ${chance}%.`;
      }
    }
    if (dc === null) summary += " No DC set — the GM determines the result.";
    form.querySelector("[data-summary]").textContent = summary;
  }

  /* ---------- rolling ---------- */

  #customStatistic(mod) {
    const Statistic = this.actor.perception?.constructor;
    if (!Statistic || !game.pf2e?.Modifier) return null;
    return new Statistic(this.actor, {
      slug: "counteract",
      label: "Counteract Check",
      domains: ["counteract"],
      modifiers: [new game.pf2e.Modifier({ slug: "custom", label: "Counteract modifier", modifier: mod, type: "untyped" })],
      check: { type: "check" },
    });
  }

  async #roll(event) {
    const src = this.#currentSource();
    const statistic = src.kind === "custom" ? this.#customStatistic(src.mod) : src.statistic;
    if (!statistic?.check) return void ui.notifications.warn("Counteract: no statistic to roll with.");

    const myRank = this.values.rank;
    const targetRank = this.values.targetRank;
    const dc = this.values.dc;
    const cand = this.#candidate(this.values.candidateId);
    const T = this.target.actor ?? null;
    const dcWhy = cand?.dcWhy ?? this.targets.fallback?.dcWhy ?? null;
    const spell = src.kind === "entry" && this.values.spellId ? src.spells.find((sp) => sp.id === this.values.spellId) ?? null : null;

    const what = cand
      ? `<b>${esc(cand.label)}</b>${cand.bearerName && cand.bearerName !== T?.name ? ` on ${esc(cand.bearerName)}` : T ? ` on ${esc(T.name)}` : ""}`
      : T
        ? `an effect of <b>${esc(T.name)}</b>`
        : "an effect";
    const notes = [
      {
        selector: "counteract-check",
        text: `Counteracting ${what}${targetRank !== null ? ` (rank ${targetRank})` : ""} with ${esc(src.label)}${spell ? `, ${esc(spell.name)}` : ""} at counteract rank <b>${myRank}</b>.`,
      },
    ];
    if (dc !== null && dcWhy) {
      notes.push({
        selector: "counteract-check",
        text: `DC ${dc}: ${esc(dcWhy)}.${cand ? ` Rank ${cand.rank}: ${esc(cand.rankWhy)}.` : ""}`,
        visibility: "gm",
      });
    }
    for (const degree of DEGREES) {
      const ok = counteracts(degree, myRank, targetRank);
      const limit = myRank + (RANK_ALLOWANCE[degree] ?? 0);
      let text;
      if (degree === "criticalFailure") text = "You fail to counteract the target.";
      else if (ok === true) text = `<b>Counteracted!</b> Target rank ${targetRank} is ${degree === "failure" ? "below" : "within reach of"} your rank ${myRank}.`;
      else if (ok === false) text = `Not counteracted: target rank ${targetRank} exceeds the rank ${limit} this result can reach.`;
      else text = degree === "failure" ? `Counteract the target if its counteract rank is less than ${myRank}.` : `Counteract the target if its counteract rank is ${limit} or less.`;
      notes.push({
        selector: "counteract-check",
        title: `PF2E.Check.Result.Degree.Check.${degree}`,
        text,
        outcome: [degree],
      });
    }

    const rollOptions = ["counteract", `counteract:rank:${myRank}`];
    if (targetRank !== null) rollOptions.push(`counteract:target:rank:${targetRank}`);
    const traits = [...new Set([...(src.traits ?? []), ...(spell?.system?.traits?.value ?? [])])];

    const params = {
      dc: dc !== null ? { value: dc, label: "Counteract DC" } : null,
      label: "Counteract Check",
      title: `Counteract Check — ${src.label}`,
      extraRollNotes: notes,
      extraRollOptions: rollOptions,
      traits,
      target: T,
      item: spell ?? null,
    };
    if (this.token) params.token = this.token;
    if (event?.shiftKey || this.#skipDialog) params.skipDialog = true;
    this.#skipDialog = false;

    try {
      await statistic.check.roll(params);
      this.close();
    } catch (error) {
      console.error(`${MODULE_ID} | counteract roll failed`, error);
      ui.notifications.error("Counteract: the roll failed — see the console.");
    }
  }
}

/* -------------------------------------------- */
/*  Entry points                                 */
/* -------------------------------------------- */

/** Best guess at "who is acting": a controlled token, else the assigned character. */
function rollerFor() {
  const controlled = canvas?.tokens?.controlled ?? [];
  const token = controlled.find((t) => t.actor?.isOfType?.("character", "npc"));
  if (token) return { actor: token.actor, token: token.document };
  const character = game.user.character;
  if (character) return { actor: character, token: character.getActiveTokens?.(true, true)?.[0] ?? null };
  return null;
}

/** From an effect's hover card: the controlled token (usually the bearer itself) counteracts; the picker allows switching. */
function openForEffect(effect) {
  const bearer = effect.actor;
  const roller =
    rollerFor() ??
    (bearer?.isOwner ? { actor: bearer, token: bearer.token ?? bearer.getActiveTokens?.(true, true)?.[0] ?? null } : null);
  if (!roller) {
    ui.notifications.warn("Counteract: select the token that's counteracting (or assign yourself a character).");
    return;
  }
  CounteractDialog.open({ ...roller, effect });
}

/** Add our icon to the Effects panel hover card (a locked core tooltip). */
function decorateEffectTooltip(aside) {
  const content = aside.querySelector(".content[data-item-uuid]");
  const heading = content?.querySelector("h1");
  if (!content || !heading || heading.querySelector(".phr-ct-effect")) return;
  const effect = safeFromUuidSync(content.dataset.itemUuid);
  if (!effect?.isOfType?.("effect", "affliction")) return;
  const link = document.createElement("a");
  link.className = "phr-ct-effect";
  link.dataset.tooltip = "Counteract this effect";
  link.innerHTML = '<i class="fa-solid fa-fw fa-hand-sparkles"></i>';
  link.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    game.tooltip?.dismissLockedTooltips?.();
    openForEffect(effect);
  });
  heading.append(link);
}

function headerButton(sheet, buttons) {
  const actor = sheet.actor;
  if (!actor?.isOwner || !actor.isOfType?.("character", "npc")) return;
  if (buttons.some((b) => b.class === "phr-counteract")) return;
  buttons.unshift({
    label: "Counteract",
    class: "phr-counteract",
    icon: "fa-solid fa-hand-sparkles",
    onclick: () => CounteractDialog.open({ actor, token: sheet.token ?? null }),
  });
}

/** Icon beside each spellcasting entry's DC, preselecting that entry. */
function decorateSheet(sheet, html) {
  const actor = sheet.actor;
  if (!actor?.isOwner || !actor.isOfType?.("character", "npc")) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  for (const li of root.querySelectorAll("li.spellcasting-entry[data-item-id]")) {
    if (li.querySelector(".phr-ct-entry")) continue;
    const anchor = li.querySelector(".statistic-values") ?? li.querySelector(".spellDC");
    if (!anchor) continue;
    const entryId = li.dataset.itemId;
    const link = document.createElement("a");
    link.className = "phr-ct-entry";
    link.dataset.tooltip = "Counteract check with this entry";
    link.innerHTML = '<i class="fa-solid fa-fw fa-hand-sparkles"></i>';
    link.addEventListener("click", (event) => {
      event.preventDefault();
      CounteractDialog.open({ actor, token: sheet.token ?? null, sourceId: `entry:${entryId}` });
    });
    if (anchor.classList.contains("statistic-values")) {
      const section = document.createElement("section");
      section.className = "phr-ct-entry-wrap";
      section.append(link);
      anchor.append(section);
    } else {
      anchor.after(link);
    }
  }
}

Hooks.once("init", () => {
  if (game.system.id !== "pf2e") return;
  game.keybindings.register(MODULE_ID, "counteract", {
    name: "Counteract Check",
    hint: "Open the Counteract dialog for the controlled token (or your assigned character), targeting your current target.",
    editable: [{ key: "KeyK" }],
    onDown: () => {
      const roller = rollerFor();
      if (!roller) {
        ui.notifications.warn("Counteract: select a token or assign yourself a character.");
        return true;
      }
      CounteractDialog.open(roller);
      return true;
    },
  });
});

Hooks.once("ready", () => {
  if (game.system.id !== "pf2e") return;

  for (const cls of ["CharacterSheetPF2e", "NPCSheetPF2e", "SimpleNPCSheet"]) {
    Hooks.on(`get${cls}HeaderButtons`, headerButton);
  }
  Hooks.on("renderCharacterSheetPF2e", decorateSheet);
  Hooks.on("renderNPCSheetPF2e", decorateSheet);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        const aside = node.matches(".effect-info") ? node : node.querySelector?.(".effect-info");
        if (aside) decorateEffectTooltip(aside);
      }
    }
  });
  observer.observe(document.body, { childList: true });

  const module = game.modules.get(MODULE_ID);
  module.api ??= {};
  module.api.counteract = {
    open: (opts) => CounteractDialog.open(opts ?? rollerFor() ?? {}),
    openForEffect,
  };
});
