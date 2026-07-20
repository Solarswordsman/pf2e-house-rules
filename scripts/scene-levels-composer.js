/**
 * Scene Levels Composer
 *
 * GM tool that combines several single-floor Scenes into one Foundry v14
 * multi-level Scene using the core Scene Levels feature, plus a "Stair
 * Painter" that drags out Region rectangles wired with the changeLevel
 * behavior between two floors.
 *
 * Opens from the "Combine into Levels" button in the Scenes directory footer,
 * or game.modules.get("pf2e-house-rules").api.sceneLevels.compose() /
 * .paintStairs(). System-agnostic; requires Foundry v14 (foundry.documents.Level).
 *
 * Load-bearing facts (verified against the v14 server source):
 *   - Levels are embedded documents (Scene#levels); every v14 scene gets a
 *     default level ("defaultLevel0000") holding its background/foreground,
 *     so each source scene's art lives on `scene.initialLevel`.
 *   - Placeables (walls/tiles/lights/sounds/notes/drawings/regions) carry
 *     `levels: SceneLevelsSetField` (Set of Level ids; EMPTY = all levels).
 *     Tokens instead carry a singular `level` id. Scene.create keeps embedded
 *     _ids by default (keepEmbeddedIds), so pre-generated level ids can be
 *     referenced from placeable data in the same create call.
 *   - Level background/foreground meshes are anchored at
 *     `sceneRect.center + textures.offset` and resized to the scene rect by
 *     `textures.fit`, then multiplied by scaleX/Y (PrimaryCanvasGroup
 *     #drawLevelTexture). So fit "fill" with scale = srcRect/targetRect
 *     reproduces the source scene's rendering scale for any image size, and
 *     placeables translate by the scene-rect center delta (snapped to the
 *     grid so grid-aligned art stays aligned; manual per-floor offsets are
 *     applied unsnapped on top).
 *   - `Level.visibility.levels` on the VIEWED level lists which other levels
 *     render ("from floor X you can see floor Y"); own level is implicit.
 *   - Elevation bottom/top of null means -/+Infinity in source data; prepared
 *     docs convert to Infinity, so always read bands via toObject()/_source.
 *   - A stair is just a Region tagged to both levels with a changeLevel
 *     behavior (its only config is an optional movementActions set); the
 *     destination list is the region's levels minus the token's current one.
 */

const MODULE_ID = "pf2e-house-rules";

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

const rid = () => foundry.utils.randomID();
const esc = (value) => Handlebars.escapeExpression(value ?? "");

/** Parse a number input where blank means null (an open-ended elevation bound). */
function numOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** The reference elevation of a band (mirrors Level#prepareBaseData's `base`). */
function bandBase(bottom, top) {
  if (Number.isFinite(bottom ?? NaN)) return bottom;
  return Math.min(top ?? 0, 0);
}

function bandLabel(bottom, top) {
  const b = bottom ?? "−∞";
  const t = top ?? "+∞";
  return `${b}–${t}`;
}

/* -------------------------------------------- */
/*  Composer application                        */
/* -------------------------------------------- */

class SceneLevelsComposer extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "phr-scene-levels-composer",
    classes: ["phr-inserter", "slc-composer"],
    window: {
      title: "Combine Scenes into Levels",
      icon: "fa-solid fa-layer-group",
      resizable: true,
    },
    position: { width: 960, height: "auto" },
  };

  static #instance = null;

  static open() {
    if (!game.user.isGM) return;
    if (!foundry.documents?.Level) {
      return void ui.notifications.error("Scene Levels require Foundry v14 or newer.");
    }
    if (this.#instance?.rendered) return this.#instance.bringToFront();
    this.#instance = new this();
    this.#instance.render(true);
  }

  #bandHeight = 20;
  #startBottom = 0;
  #baseUid = null;
  #sceneName = "";
  #copyTokens = true;
  /** @type {{uid: string, sceneId: string, name: string, bottom: number|null, top: number|null, offsetX: number, offsetY: number, sees: Set<string>}[]} */
  #floors = [this.#newFloor(0), this.#newFloor(1)];

  #newFloor(index) {
    const bottom = this.#startBottom + index * this.#bandHeight;
    return {
      uid: rid(),
      sceneId: "",
      name: "",
      bottom,
      top: bottom + this.#bandHeight,
      offsetX: 0,
      offsetY: 0,
      sees: new Set(),
    };
  }

  #floorLabel(floor, index) {
    return floor.name || game.scenes.get(floor.sceneId)?.name || `Floor ${index + 1}`;
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
    const sceneOptions = game.scenes.contents
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => `<option value="${s.id}">${esc(s.name)}</option>`)
      .join("");

    const floorRows = this.#floors
      .map((f, i) => {
        const options = sceneOptions.replace(`value="${f.sceneId}"`, `value="${f.sceneId}" selected`);
        return `
        <div class="slc-floor" data-uid="${f.uid}">
          <span class="slc-idx" title="Floor ${i + 1} (bottom of the list is the lowest floor)">${i + 1}</span>
          <span class="slc-move">
            <button type="button" data-action="up" title="Move up (higher floor)"><i class="fa-solid fa-caret-up"></i></button>
            <button type="button" data-action="down" title="Move down (lower floor)"><i class="fa-solid fa-caret-down"></i></button>
          </span>
          <select data-f="scene"><option value="">— pick a scene —</option>${f.sceneId ? options : sceneOptions}</select>
          <input type="text" data-f="name" value="${esc(f.name)}" placeholder="Level name">
          <label title="Band bottom elevation (blank = −∞)">⇩ <input type="number" data-f="bottom" step="any" value="${f.bottom ?? ""}" placeholder="−∞"></label>
          <label title="Band top elevation (blank = +∞)">⇧ <input type="number" data-f="top" step="any" value="${f.top ?? ""}" placeholder="+∞"></label>
          <label title="Manual art/placeable offset in pixels, applied on top of auto-centering">Offset
            <input type="number" data-f="offsetX" step="1" value="${f.offsetX}">
            <input type="number" data-f="offsetY" step="1" value="${f.offsetY}">
          </label>
          <button type="button" data-action="remove" title="Remove floor"><i class="fa-solid fa-xmark"></i></button>
        </div>`;
      })
      .reverse()
      .join("");

    const matrixHead = this.#floors
      .map((f, i) => `<th title="…sees ${esc(this.#floorLabel(f, i))}">${esc(this.#floorLabel(f, i))}</th>`)
      .join("");
    const matrixRows = this.#floors
      .map((viewer, vi) => {
        const cells = this.#floors
          .map((seen, si) => {
            if (viewer === seen) return "<td>—</td>";
            const checked = viewer.sees.has(seen.uid) ? "checked" : "";
            return `<td><input type="checkbox" data-viewer="${viewer.uid}" data-seen="${seen.uid}" ${checked}></td>`;
          })
          .join("");
        return `<tr><th>${esc(this.#floorLabel(viewer, vi))}</th>${cells}</tr>`;
      })
      .join("");

    const baseOptions = this.#floors
      .map((f, i) => {
        const selected = f.uid === (this.#baseUid ?? this.#floors[0].uid) ? "selected" : "";
        return `<option value="${f.uid}" ${selected}>${esc(this.#floorLabel(f, i))}</option>`;
      })
      .join("");

    return `
    <form class="phr-body slc-form" autocomplete="off">
      <fieldset class="phr-dc"><legend>Floors</legend>
        <p class="slc-hint">Listed top-to-bottom like a building: the last row is the lowest floor. Elevation bands default to ${this.#bandHeight}&nbsp;ft per floor.</p>
        <div class="slc-floors">${floorRows}</div>
        <div class="phr-row">
          <button type="button" data-action="add" class="phr-add-row"><i class="fa-solid fa-plus"></i> Add floor</button>
          <label>Band height <input type="number" name="bandHeight" step="any" min="1" value="${this.#bandHeight}"></label>
          <label>Lowest bottom <input type="number" name="startBottom" step="any" value="${this.#startBottom}"></label>
          <button type="button" data-action="recalc" title="Refill every band from the current order, band height and lowest bottom">Recalculate bands</button>
        </div>
      </fieldset>

      <fieldset class="phr-dc"><legend>Cross-level visibility</legend>
        <p class="slc-hint">When viewing the row's floor, which other floors are rendered? Useful when upper floors have alpha cutouts to see below.</p>
        <div class="slc-matrix-wrap"><table class="slc-matrix">
          <tr><th>Viewing ↓ / sees →</th>${matrixHead}</tr>
          ${matrixRows}
        </table></div>
        <div class="phr-row">
          <button type="button" data-action="vis-none">None</button>
          <button type="button" data-action="vis-below">Each floor sees the floor below</button>
          <button type="button" data-action="vis-all">All</button>
        </div>
      </fieldset>

      <fieldset class="phr-dc"><legend>Composite scene</legend>
        <div class="phr-row">
          <label class="phr-label-field">Name <input type="text" name="sceneName" value="${esc(this.#sceneName)}" placeholder="Base scene name (Levels)"></label>
          <label>Base scene <select name="baseScene" title="Supplies grid, padding, lighting environment, playlist and other scene settings">${baseOptions}</select></label>
          <label class="phr-check"><input type="checkbox" name="copyTokens" ${this.#copyTokens ? "checked" : ""}> Copy tokens</label>
        </div>
      </fieldset>

      <footer class="phr-buttons">
        <button type="button" data-action="paint" title="Paint stair regions on the currently viewed scene"><i class="fa-solid fa-stairs"></i> Stair Painter</button>
        <button type="submit" class="phr-primary"><i class="fa-solid fa-layer-group"></i> Create composite scene</button>
        <button type="button" data-action="cancel">Cancel</button>
      </footer>
    </form>`;
  }

  _onRender() {
    const form = this.element.querySelector("form.slc-form");
    form.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      event.preventDefault();
      this.#onAction(button);
    });
    form.addEventListener("change", (event) => this.#onChange(event));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.#create();
    });
  }

  /* ---------- state <-> form ---------- */

  #readForm() {
    const form = this.element?.querySelector("form.slc-form");
    if (!form) return;
    const rows = [...form.querySelectorAll(".slc-floor")].reverse(); // DOM shows top floor first
    this.#floors = rows.map((row) => {
      const old = this.#floors.find((f) => f.uid === row.dataset.uid) ?? this.#newFloor(0);
      return {
        ...old,
        sceneId: row.querySelector('[data-f="scene"]').value,
        name: row.querySelector('[data-f="name"]').value.trim(),
        bottom: numOrNull(row.querySelector('[data-f="bottom"]').value),
        top: numOrNull(row.querySelector('[data-f="top"]').value),
        offsetX: Number(row.querySelector('[data-f="offsetX"]').value) || 0,
        offsetY: Number(row.querySelector('[data-f="offsetY"]').value) || 0,
      };
    });
    for (const floor of this.#floors) {
      floor.sees = new Set(
        [...form.querySelectorAll(`input[data-viewer="${floor.uid}"]:checked`)].map((el) => el.dataset.seen),
      );
    }
    this.#bandHeight = Math.max(Number(form.elements.bandHeight.value) || 20, 1);
    this.#startBottom = Number(form.elements.startBottom.value) || 0;
    this.#baseUid = form.elements.baseScene?.value || this.#baseUid;
    this.#sceneName = form.elements.sceneName.value;
    this.#copyTokens = form.elements.copyTokens.checked;
  }

  #autofillBands() {
    this.#floors.forEach((floor, i) => {
      floor.bottom = this.#startBottom + i * this.#bandHeight;
      floor.top = floor.bottom + this.#bandHeight;
    });
  }

  #onAction(button) {
    const action = button.dataset.action;
    if (action === "cancel") return void this.close();
    if (action === "paint") return void StairPainter.open();

    this.#readForm();
    const uid = button.closest(".slc-floor")?.dataset.uid;
    const index = this.#floors.findIndex((f) => f.uid === uid);
    switch (action) {
      case "add":
        this.#floors.push(this.#newFloor(this.#floors.length));
        break;
      case "remove":
        if (this.#floors.length > 1) this.#floors.splice(index, 1);
        break;
      case "up": // higher floor = later in the bottom→top array
        if (index >= 0 && index < this.#floors.length - 1) {
          [this.#floors[index], this.#floors[index + 1]] = [this.#floors[index + 1], this.#floors[index]];
        }
        break;
      case "down":
        if (index > 0) {
          [this.#floors[index], this.#floors[index - 1]] = [this.#floors[index - 1], this.#floors[index]];
        }
        break;
      case "recalc":
        this.#autofillBands();
        break;
      case "vis-none":
        for (const f of this.#floors) f.sees.clear();
        break;
      case "vis-below":
        this.#floors.forEach((f, i) => {
          f.sees.clear();
          if (i > 0) f.sees.add(this.#floors[i - 1].uid);
        });
        break;
      case "vis-all":
        for (const f of this.#floors) {
          f.sees = new Set(this.#floors.filter((o) => o !== f).map((o) => o.uid));
        }
        break;
      default:
        return;
    }
    this.render();
  }

  #onChange(event) {
    const target = event.target;
    if (target.matches('[data-f="scene"]')) {
      this.#readForm();
      const floor = this.#floors.find((f) => f.uid === target.closest(".slc-floor").dataset.uid);
      if (floor) floor.name = game.scenes.get(floor.sceneId)?.name ?? "";
      this.render();
    } else if (target.matches('[name="bandHeight"], [name="startBottom"]')) {
      this.#readForm();
      this.#autofillBands();
      this.render();
    }
    // Other inputs stay in the DOM until the next #readForm.
  }

  /* ---------- creation ---------- */

  async #create() {
    this.#readForm();
    const entries = this.#floors
      .filter((f) => f.sceneId)
      .map((f) => ({ ...f, scene: game.scenes.get(f.sceneId) }));
    if (entries.length < 2 || entries.some((e) => !e.scene)) {
      return void ui.notifications.warn("Pick a scene for at least two floors.");
    }

    const base = entries.find((e) => e.uid === this.#baseUid)?.scene ?? entries[0].scene;
    for (const e of entries) {
      if (e.scene.grid.type !== base.grid.type) {
        return void ui.notifications.error(
          `Grid type of "${e.scene.name}" differs from the base scene — cannot combine.`,
        );
      }
      if (e.scene.grid.distance !== base.grid.distance || e.scene.grid.units !== base.grid.units) {
        ui.notifications.warn(
          `Grid distance/units of "${e.scene.name}" differ from the base scene; distances and elevations are copied unconverted.`,
        );
      }
      if (e.scene.levels.size > 1) {
        ui.notifications.warn(
          `"${e.scene.name}" already has multiple levels; only its initial level's art is used (all placeables are still copied).`,
        );
      }
    }

    const baseObj = base.toObject();
    const gsize = base.grid.size;
    const gridless = base.grid.type === CONST.GRID_TYPES.GRIDLESS;

    // Target canvas: base scene's grid/padding, sized to the largest floor
    // (source pixels scaled by the grid-size ratio when grids differ).
    let width = 0;
    let height = 0;
    for (const e of entries) {
      const k = gsize / e.scene.grid.size;
      width = Math.max(width, Math.ceil(k * e.scene.width));
      height = Math.max(height, Math.ceil(k * e.scene.height));
    }
    const SceneCls = CONFIG.Scene.documentClass;
    const probe = new SceneCls({ name: "probe", width, height, padding: baseObj.padding, grid: baseObj.grid });
    const tRect = probe.dimensions.sceneRect;
    const tCx = tRect.x + tRect.width / 2;
    const tCy = tRect.y + tRect.height / 2;

    // Pre-generate the composite scene's id so intra-scene UUID references in
    // region behavior data (e.g. teleport destinations, "Scene.<id>.Region.<id>")
    // can be re-pointed at the new scene instead of the source scene.
    const newSceneId = rid();

    const levels = [];
    const collections = {
      walls: [], tiles: [], lights: [], sounds: [], notes: [], drawings: [], regions: [], tokens: [],
    };
    const usedIds = Object.fromEntries(Object.keys(collections).map((key) => [key, new Set()]));

    entries.forEach((e, i) => {
      const scene = e.scene;
      const k = gsize / scene.grid.size;
      const sRect = scene.dimensions.sceneRect;
      const snap = (v) => (gridless ? Math.round(v) : Math.round(v / gsize) * gsize);
      const rawDx = tCx - k * (sRect.x + sRect.width / 2);
      const rawDy = tCy - k * (sRect.y + sRect.height / 2);
      const dx = snap(rawDx) + e.offsetX;
      const dy = snap(rawDy) + e.offsetY;

      const srcLevel = scene.initialLevel?.toObject() ?? {};
      const dE = bandBase(e.bottom, e.top) - bandBase(srcLevel.elevation?.bottom ?? null, srcLevel.elevation?.top ?? null);

      const levelId = rid();
      const sT = srcLevel.textures ?? {};
      levels.push({
        _id: levelId,
        name: e.name || scene.name,
        sort: (i + 1) * 100000,
        elevation: { bottom: e.bottom, top: e.top },
        background: srcLevel.background ?? {},
        foreground: srcLevel.foreground ?? {},
        fog: srcLevel.fog ?? {},
        textures: {
          anchorX: 0.5,
          anchorY: 0.5,
          offsetX: Math.round(snap(rawDx) - rawDx + k * (sT.offsetX ?? 0) + e.offsetX),
          offsetY: Math.round(snap(rawDy) - rawDy + k * (sT.offsetY ?? 0) + e.offsetY),
          fit: "fill",
          scaleX: ((sT.scaleX ?? 1) * (k * sRect.width)) / tRect.width,
          scaleY: ((sT.scaleY ?? 1) * (k * sRect.height)) / tRect.height,
          rotation: sT.rotation ?? 0,
        },
        visibility: { levels: [] }, // filled below once every level id exists
      });

      const tx = (v) => Math.round(k * v + dx);
      const ty = (v) => Math.round(k * v + dy);
      const shiftE = (v) => (v == null ? v : v + dE);
      const push = (key, data) => {
        if (usedIds[key].has(data._id)) data._id = rid();
        usedIds[key].add(data._id);
        if (key === "tokens") data.level = levelId;
        else data.levels = [levelId];
        collections[key].push(data);
      };

      for (const doc of scene.walls) {
        const d = doc.toObject();
        d.c = [tx(d.c[0]), ty(d.c[1]), tx(d.c[2]), ty(d.c[3])];
        push("walls", d);
      }
      for (const doc of scene.tiles) {
        const d = doc.toObject();
        d.x = tx(d.x);
        d.y = ty(d.y);
        d.width = k * d.width;
        d.height = k * d.height;
        d.elevation = shiftE(d.elevation);
        push("tiles", d);
      }
      for (const [key, collection] of [["lights", scene.lights], ["sounds", scene.sounds], ["notes", scene.notes]]) {
        for (const doc of collection) {
          const d = doc.toObject();
          d.x = tx(d.x);
          d.y = ty(d.y);
          d.elevation = shiftE(d.elevation);
          push(key, d);
        }
      }
      for (const doc of scene.drawings) {
        const d = doc.toObject();
        d.x = tx(d.x);
        d.y = ty(d.y);
        d.elevation = shiftE(d.elevation);
        if (d.shape) {
          if (d.shape.width != null) d.shape.width = k * d.shape.width;
          if (d.shape.height != null) d.shape.height = k * d.shape.height;
          if (d.shape.points?.length) d.shape.points = d.shape.points.map((p) => k * p); // relative to x/y
        }
        push("drawings", d);
      }
      for (const doc of scene.regions) {
        const d = doc.toObject();
        d.shapes = (d.shapes ?? []).map((sh) => {
          switch (sh.type) {
            case "rectangle":
              return { ...sh, x: tx(sh.x), y: ty(sh.y), width: k * sh.width, height: k * sh.height };
            case "ellipse":
              return { ...sh, x: tx(sh.x), y: ty(sh.y), radiusX: k * sh.radiusX, radiusY: k * sh.radiusY };
            case "circle":
              return { ...sh, x: tx(sh.x), y: ty(sh.y), radius: k * sh.radius };
            case "polygon":
              return { ...sh, points: sh.points.map((p, j) => (j % 2 ? ty(p) : tx(p))) };
            default:
              return sh;
          }
        });
        d.elevation = {
          bottom: shiftE(d.elevation?.bottom ?? null),
          top: shiftE(d.elevation?.top ?? null),
          topInclusive: d.elevation?.topInclusive ?? false,
        };
        if (d.behaviors?.length) {
          d.behaviors = JSON.parse(
            JSON.stringify(d.behaviors).replaceAll(`Scene.${scene.id}.`, `Scene.${newSceneId}.`),
          );
        }
        push("regions", d);
      }
      if (this.#copyTokens) {
        for (const doc of scene.tokens) {
          const d = doc.toObject();
          d.x = tx(d.x);
          d.y = ty(d.y);
          d.elevation = (d.elevation ?? 0) + dE;
          push("tokens", d);
        }
      }
    });

    const uidToLevel = new Map(entries.map((e, i) => [e.uid, levels[i]._id]));
    entries.forEach((e, i) => {
      levels[i].visibility.levels = [...e.sees]
        .map((uid) => uidToLevel.get(uid))
        .filter((id) => id && id !== levels[i]._id);
    });

    // Initial level: the band containing elevation 0, else the lowest floor.
    const initial =
      levels.find((lv, i) => (entries[i].bottom ?? -Infinity) <= 0 && 0 < (entries[i].top ?? Infinity)) ?? levels[0];

    const sceneData = {
      _id: newSceneId,
      name: this.#sceneName.trim() || `${base.name} (Levels)`,
      width,
      height,
      padding: baseObj.padding,
      grid: baseObj.grid,
      tokenVision: baseObj.tokenVision,
      fog: baseObj.fog,
      environment: baseObj.environment,
      transition: baseObj.transition,
      playlist: baseObj.playlist,
      playlistSound: baseObj.playlistSound,
      journal: baseObj.journal,
      journalEntryPage: baseObj.journalEntryPage,
      weather: baseObj.weather,
      folder: baseObj.folder,
      navigation: false,
      initialLevel: initial._id,
      levels,
      ...collections,
    };

    let scene;
    try {
      scene = await SceneCls.create(sceneData, { keepId: true });
    } catch (error) {
      console.error(`${MODULE_ID} | Scene Levels Composer failed`, error);
      return void ui.notifications.error(`Failed to create the composite scene: ${error.message}`);
    }
    if (!scene) return;
    const counts = Object.entries(collections)
      .filter(([, arr]) => arr.length)
      .map(([key, arr]) => `${arr.length} ${key}`)
      .join(", ");
    ui.notifications.info(`Created "${scene.name}" with ${levels.length} levels${counts ? ` (${counts})` : ""}.`);
    this.close();

    const paint = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Paint stairs?", icon: "fa-solid fa-stairs" },
      content: `<p>View <strong>${esc(scene.name)}</strong> now and paint stair regions between floors?</p>`,
    });
    if (paint) {
      await scene.view();
      StairPainter.open();
    }
  }
}

/* -------------------------------------------- */
/*  Stair painter                               */
/* -------------------------------------------- */

class StairPainter extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "phr-stair-painter",
    classes: ["phr-inserter", "slc-painter"],
    window: { title: "Stair Painter", icon: "fa-solid fa-stairs" },
    position: { width: 620, height: "auto" },
  };

  static #instance = null;

  static open() {
    if (!game.user.isGM) return;
    const scene = canvas?.scene;
    if (!scene || scene.levels.size < 2) {
      return void ui.notifications.warn("View a scene with at least two levels to paint stairs.");
    }
    if (this.#instance?.rendered) {
      this.#instance.render();
      return this.#instance.bringToFront();
    }
    this.#instance = new this();
    this.#instance.render(true);
  }

  /** Active paint state: {a, b, g, origin, handlers} or null. */
  #paint = null;

  #sortedLevels() {
    return canvas.scene.levels.contents
      .slice()
      .sort(
        (a, b) =>
          (a._source.elevation.bottom ?? -Infinity) - (b._source.elevation.bottom ?? -Infinity) || a.sort - b.sort,
      );
  }

  async _renderHTML() {
    const wrapper = document.createElement("div");
    const levels = this.#sortedLevels();
    const pairs = levels.slice(0, -1).map((lo, i) => [lo, levels[i + 1]]);
    const pairRows = pairs
      .map(
        ([lo, hi]) => `
        <div class="slc-pair">
          <button type="button" data-action="paint" data-a="${lo.id}" data-b="${hi.id}"><i class="fa-solid fa-stairs"></i> Paint</button>
          <span>${esc(lo.name)} <i class="fa-solid fa-arrows-up-down"></i> ${esc(hi.name)}</span>
          <span class="slc-hint">(${bandLabel(lo._source.elevation.bottom, lo._source.elevation.top)} ↔ ${bandLabel(hi._source.elevation.bottom, hi._source.elevation.top)})</span>
        </div>`,
      )
      .join("");
    const levelOptions = levels.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join("");

    wrapper.innerHTML = `
    <form class="phr-body slc-painter-body" autocomplete="off">
      <p class="slc-hint">Click Paint, then drag a rectangle over the staircase on the canvas. The region is created on both levels with a Change Level behavior. Esc cancels. Right-drag still pans.</p>
      <div class="slc-pairs">${pairRows}</div>
      <div class="slc-pair">
        <button type="button" data-action="paint-custom"><i class="fa-solid fa-elevator"></i> Paint</button>
        <select name="customA">${levelOptions}</select>
        <i class="fa-solid fa-arrows-up-down"></i>
        <select name="customB">${levelOptions}</select>
        <span class="slc-hint">custom pair (elevators!)</span>
      </div>
    </form>`;
    return wrapper;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(...result.children);
  }

  _onRender() {
    const form = this.element.querySelector("form.slc-painter-body");
    form.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      event.preventDefault();
      const levels = canvas.scene.levels;
      if (button.dataset.action === "paint") {
        this.#beginPaint(levels.get(button.dataset.a), levels.get(button.dataset.b));
      } else if (button.dataset.action === "paint-custom") {
        const a = levels.get(form.elements.customA.value);
        const b = levels.get(form.elements.customB.value);
        if (!a || !b || a === b) return void ui.notifications.warn("Pick two different levels.");
        this.#beginPaint(a, b);
      }
    });
  }

  /* ---------- canvas drag capture ---------- */

  // Listeners go on window in the capture phase and stop propagation before
  // PIXI's event system (which listens on the canvas element) sees them, so
  // the current layer's own drag handling can't fight the paint gesture.
  // canvas.mousePosition therefore does NOT update mid-drag; coordinates come
  // from canvas.canvasCoordinatesFromClient instead.
  #beginPaint(a, b) {
    if (!a || !b) return;
    if (this.#paint) this.#endPaint(false);
    const board = document.getElementById("board");
    if (!board) return;
    const g = new PIXI.Graphics();
    canvas.controls.addChild(g);
    const state = (this.#paint = { a, b, g, origin: null, handlers: {} });

    state.handlers.pointerdown = (event) => {
      if (event.target !== board || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      state.origin = canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
    };
    state.handlers.pointermove = (event) => {
      if (!state.origin) return;
      event.stopPropagation();
      const r = this.#rect(state.origin, canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY }));
      g.clear().lineStyle(3, 0xe08a00, 1).beginFill(0xe08a00, 0.15).drawRect(r.x, r.y, r.width, r.height).endFill();
    };
    state.handlers.pointerup = async (event) => {
      if (!state.origin || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const r = this.#rect(state.origin, canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY }));
      this.#endPaint(true);
      if (r.width < 5 || r.height < 5) {
        return void ui.notifications.warn("Stair region too small — nothing created.");
      }
      await this.#createStairRegion(a, b, r);
    };
    state.handlers.keydown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      this.#endPaint(true);
      ui.notifications.info("Stair painting cancelled.");
    };

    for (const [name, handler] of Object.entries(state.handlers)) {
      window.addEventListener(name, handler, { capture: true });
    }
    this.minimize();
    ui.notifications.info(`Drag a rectangle over the stairs between "${a.name}" and "${b.name}" (Esc cancels).`);
  }

  #rect(origin, current) {
    let x1 = Math.min(origin.x, current.x);
    let y1 = Math.min(origin.y, current.y);
    let x2 = Math.max(origin.x, current.x);
    let y2 = Math.max(origin.y, current.y);
    if (canvas.grid.type === CONST.GRID_TYPES.SQUARE) {
      const gs = canvas.grid.size;
      const snap = (v) => Math.round(v / gs) * gs;
      [x1, y1, x2, y2] = [snap(x1), snap(y1), snap(x2), snap(y2)];
    }
    return { x: Math.round(x1), y: Math.round(y1), width: Math.round(x2 - x1), height: Math.round(y2 - y1) };
  }

  #endPaint(restore) {
    const state = this.#paint;
    if (!state) return;
    this.#paint = null;
    for (const [name, handler] of Object.entries(state.handlers)) {
      window.removeEventListener(name, handler, { capture: true });
    }
    state.g.destroy();
    if (restore) this.maximize();
  }

  async #createStairRegion(a, b, rect) {
    const [lo, hi] =
      bandBase(a._source.elevation.bottom, a._source.elevation.top) <=
      bandBase(b._source.elevation.bottom, b._source.elevation.top)
        ? [a, b]
        : [b, a];
    const data = {
      name: `Stairs: ${lo.name} ↔ ${hi.name}`,
      color: "#e08a00",
      shapes: [{ type: "rectangle", x: rect.x, y: rect.y, width: rect.width, height: rect.height, rotation: 0 }],
      elevation: {
        bottom: lo._source.elevation.bottom,
        top: hi._source.elevation.top,
        topInclusive: false,
      },
      levels: [lo.id, hi.id],
      behaviors: [{ type: "changeLevel", name: "Change Level" }],
    };
    try {
      const [region] = await canvas.scene.createEmbeddedDocuments("Region", [data]);
      if (region) ui.notifications.info(`Created "${region.name}". Click Paint again for another staircase.`);
    } catch (error) {
      console.error(`${MODULE_ID} | Stair Painter failed`, error);
      ui.notifications.error(`Failed to create the stair region: ${error.message}`);
    }
  }

  async close(options) {
    this.#endPaint(false);
    return super.close(options);
  }
}

/* -------------------------------------------- */
/*  Entry points                                */
/* -------------------------------------------- */

Hooks.on("renderSceneDirectory", (app, html) => {
  if (!game.user.isGM || !foundry.documents?.Level) return;
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root || root.querySelector(".slc-open")) return;
  const footer = root.querySelector(".directory-footer");
  if (!footer) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "slc-open";
  button.innerHTML = '<i class="fa-solid fa-layer-group"></i> Combine into Levels';
  button.addEventListener("click", () => SceneLevelsComposer.open());
  footer.append(button);
});

Hooks.once("ready", () => {
  if (!foundry.documents?.Level) return;
  const module = game.modules.get(MODULE_ID);
  module.api ??= {};
  module.api.sceneLevels = {
    compose: () => SceneLevelsComposer.open(),
    paintStairs: () => StairPainter.open(),
  };
});
