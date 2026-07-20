/**
 * Level Alpha Mask Cutter
 *
 * GM tool that cuts see-through holes into a Level's background (or
 * foreground) art on a v14 multi-level scene, by drawing rectangles,
 * polygons, or brush strokes directly on the canvas. Cuts preview live —
 * the level mesh's texture is swapped in place, so each shape immediately
 * reveals the floor below. Applying composites a NEW image file next to the
 * original and points the level at it; the original is never modified.
 *
 * Nondestructive: mask shapes (in image-pixel space), the original image
 * path, and feather setting persist in flags.pf2e-house-rules.alphaMask on
 * the Level document, so masks stay editable and revertible forever.
 *
 * Opens from the "Mask Cutter" button in the Scenes directory footer
 * (visible while the viewed scene has 2+ levels), or
 * game.modules.get("pf2e-house-rules").api.levelAlphaMask.open().
 * System-agnostic; requires Foundry v14.
 *
 * Load-bearing facts (verified against the v14 server source):
 *   - Level texture meshes live in the public `canvas.primary.levelTextures`
 *     array, named `Level.<level.index>.<background|foreground>` (see
 *     PrimaryCanvasGroup#drawLevelTextures / Scene#_configureLevelTextures);
 *     the array is rebuilt on every canvas draw, so meshes are re-resolved by
 *     name each time and never held across draws.
 *   - Mesh placement: anchored at sceneRect.center + textures.offset, base
 *     scale from textures.fit against the scene rect, multiplied by
 *     textures.scaleX/Y (PrimarySpriteMesh#resize). Inverting that maps world
 *     coords -> image pixels; rotation is not supported (tool refuses).
 *   - Transparent texture pixels simply reveal whatever renders beneath —
 *     lower-level meshes — which is how pre-cut multi-level art works;
 *     `alphaThreshold` only gates occlusion/vision, not the visual.
 *   - FilePicker.upload(source, path, file) is at
 *     foundry.applications.apps.FilePicker.implementation. Re-uploading the
 *     same filename would be served from texture caches, so each Apply writes
 *     a fresh `-masked-<rev>.webp` (rev tracked in the flag).
 */

const MODULE_ID = "pf2e-house-rules";
const FLAG_KEY = "alphaMask";

const esc = (value) => Handlebars.escapeExpression(value ?? "");

/** Effective mesh scale for a texture config (mirrors PrimarySpriteMesh#resize). */
function effectiveScale(config, rectW, rectH, texW, texH) {
  let bx;
  let by;
  switch (config.fit) {
    case "cover":
      bx = by = Math.max(rectW / texW, rectH / texH);
      break;
    case "contain":
      bx = by = Math.min(rectW / texW, rectH / texH);
      break;
    case "width":
      bx = by = rectW / texW;
      break;
    case "height":
      bx = by = rectH / texH;
      break;
    case "fill":
    default:
      bx = rectW / texW;
      by = rectH / texH;
  }
  return { sx: bx * (config.scaleX ?? 1), sy: by * (config.scaleY ?? 1) };
}

class AlphaMaskCutter extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "phr-alpha-mask-cutter",
    classes: ["phr-inserter", "slc-mask"],
    window: { title: "Level Alpha Mask Cutter", icon: "fa-solid fa-scissors" },
    position: { width: 560, height: "auto" },
  };

  static #instance = null;

  static open() {
    if (!game.user.isGM) return;
    const scene = canvas?.scene;
    if (!scene || !scene.levels.size) {
      return void ui.notifications.warn("View a scene with levels to cut alpha masks.");
    }
    if (this.#instance?.rendered) {
      this.#instance.render();
      return this.#instance.bringToFront();
    }
    this.#instance = new this();
    this.#instance.render(true);
  }

  #levelId = null;
  #texKey = "background";
  #tool = null; // null | "rect" | "poly" | "brush"
  #brushSize = 0; // world px diameter; 0 = init from grid on first load
  #feather = 4; // image px
  /** @type {({type:"rect",x:number,y:number,w:number,h:number}|{type:"poly",points:number[]}|{type:"brush",points:number[],radius:number})[]} */
  #shapes = [];
  /** Loaded session: {level, img, texW, texH, sx, sy, cx, cy, originalSrc, rev} or null. */
  #session = null;
  #cvs = null;
  #maskTexture = null;
  #savedTexture = null;
  /** In-progress canvas gesture: {handlers, g, origin, points} or null. */
  #capture = null;
  #loading = false;

  /* ---------- session loading ---------- */

  #level() {
    return canvas.scene?.levels.get(this.#levelId) ?? canvas.level ?? canvas.scene?.firstLevel;
  }

  #meshName() {
    const level = this.#level();
    return level ? `Level.${level.index}.${this.#texKey}` : null;
  }

  async #loadSession() {
    this.#teardownSession();
    const level = this.#level();
    if (!level) return;
    this.#levelId = level.id;
    if (this.#brushSize <= 0) this.#brushSize = canvas.grid.size;

    const flag = level.getFlag(MODULE_ID, FLAG_KEY)?.[this.#texKey];
    const currentSrc = level[this.#texKey]?.src ?? null;
    const originalSrc = flag?.originalSrc || currentSrc;
    if (!originalSrc) {
      ui.notifications.warn(`Level "${level.name}" has no ${this.#texKey} image.`);
      return;
    }
    if (/\.(mp4|webm|m4v|ogv)(\?.*)?$/i.test(originalSrc)) {
      ui.notifications.error("Video textures can't be alpha-masked.");
      return;
    }
    if (level.textures.rotation) {
      ui.notifications.error("This level's texture rotation is non-zero — the mask cutter only supports unrotated art.");
      return;
    }

    this.#loading = true;
    this.render();
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = originalSrc;
    try {
      await img.decode();
    } catch {
      this.#loading = false;
      this.render();
      return void ui.notifications.error(`Could not load "${originalSrc}".`);
    }

    const rect = canvas.scene.dimensions.sceneRect;
    const { sx, sy } = effectiveScale(level.textures, rect.width, rect.height, img.naturalWidth, img.naturalHeight);
    this.#session = {
      level,
      img,
      texW: img.naturalWidth,
      texH: img.naturalHeight,
      sx,
      sy,
      cx: rect.x + rect.width / 2 + level.textures.offsetX,
      cy: rect.y + rect.height / 2 + level.textures.offsetY,
      originalSrc,
      rev: flag?.rev || 0,
    };
    this.#shapes = Array.isArray(flag?.shapes) ? foundry.utils.deepClone(flag.shapes) : [];
    if (flag?.feather != null) this.#feather = flag.feather;
    this.#cvs = document.createElement("canvas");
    this.#cvs.width = this.#session.texW;
    this.#cvs.height = this.#session.texH;
    this.#loading = false;
    this.#recomposite();
    this.render();
  }

  #teardownSession() {
    this.#endCapture();
    this.#restorePreview();
    this.#maskTexture?.destroy(true);
    this.#maskTexture = null;
    this.#savedTexture = null;
    this.#session = null;
    this.#cvs = null;
    this.#shapes = [];
  }

  /* ---------- world <-> image ---------- */

  #worldToImage({ x, y }) {
    const s = this.#session;
    return {
      x: (x - s.cx) / s.sx + s.texW / 2,
      y: (y - s.cy) / s.sy + s.texH / 2,
    };
  }

  #imageRadius(worldDiameter) {
    const s = this.#session;
    return worldDiameter / 2 / ((Math.abs(s.sx) + Math.abs(s.sy)) / 2);
  }

  /* ---------- compositing & live preview ---------- */

  #recomposite() {
    const s = this.#session;
    if (!s || !this.#cvs) return;
    const ctx = this.#cvs.getContext("2d");
    ctx.clearRect(0, 0, s.texW, s.texH);
    ctx.drawImage(s.img, 0, 0);
    if (this.#shapes.length) {
      const mask = document.createElement("canvas");
      mask.width = s.texW;
      mask.height = s.texH;
      const mctx = mask.getContext("2d");
      mctx.fillStyle = "#fff";
      mctx.strokeStyle = "#fff";
      mctx.lineCap = "round";
      mctx.lineJoin = "round";
      for (const shape of this.#shapes) {
        if (shape.type === "rect") {
          mctx.fillRect(shape.x, shape.y, shape.w, shape.h);
        } else if (shape.type === "poly") {
          mctx.beginPath();
          mctx.moveTo(shape.points[0], shape.points[1]);
          for (let i = 2; i < shape.points.length; i += 2) mctx.lineTo(shape.points[i], shape.points[i + 1]);
          mctx.closePath();
          mctx.fill();
        } else if (shape.type === "brush") {
          mctx.lineWidth = shape.radius * 2;
          mctx.beginPath();
          mctx.moveTo(shape.points[0], shape.points[1]);
          if (shape.points.length === 2) mctx.lineTo(shape.points[0] + 0.01, shape.points[1]);
          for (let i = 2; i < shape.points.length; i += 2) mctx.lineTo(shape.points[i], shape.points[i + 1]);
          mctx.stroke();
        }
      }
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      if (this.#feather > 0) ctx.filter = `blur(${this.#feather}px)`;
      ctx.drawImage(mask, 0, 0);
      ctx.restore();
    }
    this.#applyPreview();
  }

  #findMesh() {
    const name = this.#meshName();
    return name ? canvas.primary?.levelTextures?.find((m) => m.name === name && !m.destroyed) : null;
  }

  // The levelTextures array is rebuilt on every canvas draw, so the mesh is
  // resolved fresh each time; if a redraw replaced it, the new mesh carries
  // the untouched texture and we simply re-save and re-swap.
  #applyPreview() {
    const mesh = this.#findMesh();
    if (!mesh || !this.#cvs) return;
    if (!this.#maskTexture) this.#maskTexture = PIXI.Texture.from(this.#cvs);
    else this.#maskTexture.baseTexture.update();
    if (mesh.texture !== this.#maskTexture) {
      this.#savedTexture = mesh.texture;
      mesh.texture = this.#maskTexture;
    }
  }

  #restorePreview() {
    try {
      const mesh = this.#findMesh();
      if (mesh && this.#maskTexture && mesh.texture === this.#maskTexture && this.#savedTexture) {
        mesh.texture = this.#savedTexture;
      }
    } catch {
      /* canvas mid-teardown — nothing to restore */
    }
  }

  /* ---------- rendering ---------- */

  async _renderHTML() {
    const wrapper = document.createElement("div");
    const levels = canvas.scene.levels.contents
      .slice()
      .sort((a, b) => (a._source.elevation.bottom ?? -Infinity) - (b._source.elevation.bottom ?? -Infinity));
    const current = this.#level();
    const levelOptions = levels
      .map((l) => `<option value="${l.id}" ${l.id === current?.id ? "selected" : ""}>${esc(l.name)}</option>`)
      .join("");
    const toolButton = (tool, icon, label) => `
      <button type="button" data-action="tool" data-tool="${tool}"
        class="slc-tool ${this.#tool === tool ? "active" : ""}"><i class="fa-solid ${icon}"></i> ${label}</button>`;
    const s = this.#session;
    const status = this.#loading
      ? "Loading image…"
      : s
        ? `${s.texW}×${s.texH}px, ${this.#shapes.length} cut${this.#shapes.length === 1 ? "" : "s"}`
        : "No image loaded.";

    wrapper.innerHTML = `
    <form class="phr-body slc-mask-body" autocomplete="off">
      <div class="phr-row">
        <label>Level <select name="level">${levelOptions}</select></label>
        <label>Texture <select name="texKey">
          <option value="background" ${this.#texKey === "background" ? "selected" : ""}>Background</option>
          <option value="foreground" ${this.#texKey === "foreground" ? "selected" : ""}>Foreground</option>
        </select></label>
        <span class="phr-computed">${esc(status)}</span>
      </div>
      <div class="phr-row">
        ${toolButton("rect", "fa-vector-square", "Rect")}
        ${toolButton("poly", "fa-draw-polygon", "Polygon")}
        ${toolButton("brush", "fa-paintbrush", "Brush")}
        <label title="Brush diameter in world pixels">Size <input type="number" name="brushSize" min="4" step="1" value="${Math.round(this.#brushSize)}"></label>
        <label title="Soften cut edges by blurring the mask (image pixels)">Feather <input type="number" name="feather" min="0" step="1" value="${this.#feather}"></label>
      </div>
      <div class="phr-row">
        <button type="button" data-action="undo"><i class="fa-solid fa-rotate-left"></i> Undo cut</button>
        <button type="button" data-action="clear"><i class="fa-solid fa-eraser"></i> Clear cuts</button>
        <button type="button" data-action="forget" title="Delete stored mask data for this level texture and reload from its current image"><i class="fa-solid fa-broom"></i> Forget mask</button>
      </div>
      <p class="slc-hint">Cuts preview live on the canvas. Rect/Brush: drag. Polygon: click vertices, Enter or double-click closes, Backspace removes a vertex. Esc stops the tool. Tip: make the floor below visible (visibility matrix) to see through your cuts while editing.</p>
      <footer class="phr-buttons">
        <button type="button" data-action="revert" title="Point the level back at the original, uncut image (cuts stay stored for later)">Revert to original</button>
        <button type="button" data-action="apply" class="phr-primary"><i class="fa-solid fa-scissors"></i> Apply mask</button>
        <button type="button" data-action="close">Close</button>
      </footer>
    </form>`;
    return wrapper;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(...result.children);
  }

  async _onFirstRender(context, options) {
    await super._onFirstRender?.(context, options);
    this.#loadSession();
  }

  _onRender() {
    const form = this.element.querySelector("form.slc-mask-body");
    form.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      event.preventDefault();
      this.#onAction(button);
    });
    form.addEventListener("change", (event) => {
      const t = event.target;
      if (t.name === "level" || t.name === "texKey") {
        this.#levelId = form.elements.level.value;
        this.#texKey = form.elements.texKey.value;
        this.#loadSession();
      } else if (t.name === "brushSize") {
        this.#brushSize = Math.max(Number(t.value) || canvas.grid.size, 4);
      } else if (t.name === "feather") {
        this.#feather = Math.max(Number(t.value) || 0, 0);
        this.#recomposite();
      }
    });
  }

  #onAction(button) {
    switch (button.dataset.action) {
      case "tool": {
        const tool = button.dataset.tool;
        this.#endCapture();
        this.#tool = this.#tool === tool ? null : tool;
        if (this.#tool && !this.#session) {
          this.#tool = null;
          ui.notifications.warn("Load a level image first.");
        }
        if (this.#tool) this.#beginCapture();
        this.render();
        break;
      }
      case "undo":
        this.#shapes.pop();
        this.#recomposite();
        this.render();
        break;
      case "clear":
        this.#shapes = [];
        this.#recomposite();
        this.render();
        break;
      case "forget":
        this.#forget();
        break;
      case "revert":
        this.#revert();
        break;
      case "apply":
        this.#apply();
        break;
      case "close":
        this.close();
        break;
    }
  }

  /* ---------- canvas capture (same window-capture pattern as the stair painter) ---------- */

  #beginCapture() {
    const board = document.getElementById("board");
    if (!board) return;
    const g = new PIXI.Graphics();
    canvas.controls.addChild(g);
    const state = (this.#capture = { g, origin: null, points: [], handlers: {} });
    const world = (event) => canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });

    state.handlers.pointerdown = (event) => {
      if (event.target !== board || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const p = world(event);
      if (this.#tool === "poly") {
        if (event.detail >= 2 && state.points.length >= 6) return this.#commitPoly();
        state.points.push(p.x, p.y);
        this.#drawGuide(p);
      } else {
        state.origin = p;
        state.points = [p.x, p.y];
      }
    };
    state.handlers.pointermove = (event) => {
      const p = world(event);
      if (this.#tool === "poly") {
        if (state.points.length) this.#drawGuide(p);
        return; // observe only; don't block hover/other listeners
      }
      if (!state.origin) return;
      event.stopPropagation();
      if (this.#tool === "rect") {
        const x = Math.min(state.origin.x, p.x);
        const y = Math.min(state.origin.y, p.y);
        g.clear()
          .lineStyle(2, 0xe04040, 1)
          .beginFill(0xe04040, 0.25)
          .drawRect(x, y, Math.abs(p.x - state.origin.x), Math.abs(p.y - state.origin.y))
          .endFill();
      } else if (this.#tool === "brush") {
        const lx = state.points[state.points.length - 2];
        const ly = state.points[state.points.length - 1];
        if (Math.hypot(p.x - lx, p.y - ly) >= this.#brushSize / 4) state.points.push(p.x, p.y);
        g.clear().lineStyle({
          width: this.#brushSize,
          color: 0xe04040,
          alpha: 0.35,
          cap: PIXI.LINE_CAP.ROUND,
          join: PIXI.LINE_JOIN.ROUND,
        });
        g.moveTo(state.points[0], state.points[1]);
        for (let i = 2; i < state.points.length; i += 2) g.lineTo(state.points[i], state.points[i + 1]);
      }
    };
    state.handlers.pointerup = (event) => {
      if (this.#tool === "poly" || !state.origin || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const p = world(event);
      if (this.#tool === "rect") {
        const a = this.#worldToImage(state.origin);
        const b = this.#worldToImage(p);
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        const w = Math.abs(b.x - a.x);
        const h = Math.abs(b.y - a.y);
        if (w >= 2 && h >= 2) this.#shapes.push({ type: "rect", x, y, w, h });
      } else if (this.#tool === "brush" && state.points.length >= 2) {
        const points = [];
        for (let i = 0; i < state.points.length; i += 2) {
          const q = this.#worldToImage({ x: state.points[i], y: state.points[i + 1] });
          points.push(q.x, q.y);
        }
        this.#shapes.push({ type: "brush", points, radius: this.#imageRadius(this.#brushSize) });
      }
      state.origin = null;
      state.points = [];
      g.clear();
      this.#recomposite();
      this.render();
    };
    state.handlers.keydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (this.#tool === "poly" && state.points.length) {
          state.points = [];
          g.clear();
        } else {
          this.#endCapture();
          this.#tool = null;
          this.render();
        }
      } else if (event.key === "Enter" && this.#tool === "poly" && state.points.length >= 6) {
        event.preventDefault();
        event.stopPropagation();
        this.#commitPoly();
      } else if (event.key === "Backspace" && this.#tool === "poly" && state.points.length) {
        event.preventDefault();
        event.stopPropagation();
        state.points.splice(-2, 2);
        this.#drawGuide(null);
      }
    };

    for (const [name, handler] of Object.entries(state.handlers)) {
      window.addEventListener(name, handler, { capture: true });
    }
  }

  /** Redraw the in-progress polygon outline, optionally with a rubber line to the cursor. */
  #drawGuide(cursor) {
    const state = this.#capture;
    if (!state) return;
    const g = state.g;
    g.clear();
    if (!state.points.length) return;
    g.lineStyle(2, 0xe04040, 1).beginFill(0xe04040, 0.15);
    g.moveTo(state.points[0], state.points[1]);
    for (let i = 2; i < state.points.length; i += 2) g.lineTo(state.points[i], state.points[i + 1]);
    if (cursor) g.lineTo(cursor.x, cursor.y);
    g.closePath().endFill();
  }

  #commitPoly() {
    const state = this.#capture;
    if (!state || state.points.length < 6) return;
    const points = [];
    for (let i = 0; i < state.points.length; i += 2) {
      const q = this.#worldToImage({ x: state.points[i], y: state.points[i + 1] });
      points.push(q.x, q.y);
    }
    this.#shapes.push({ type: "poly", points });
    state.points = [];
    state.g.clear();
    this.#recomposite();
    this.render();
  }

  #endCapture() {
    const state = this.#capture;
    if (!state) return;
    this.#capture = null;
    for (const [name, handler] of Object.entries(state.handlers)) {
      window.removeEventListener(name, handler, { capture: true });
    }
    state.g.destroy();
  }

  /* ---------- apply / revert / forget ---------- */

  async #apply() {
    const s = this.#session;
    if (!s) return;
    const level = s.level;

    // No cuts = point back at the original and drop the stored mask.
    if (!this.#shapes.length) {
      await level.update({
        [`${this.#texKey}.src`]: s.originalSrc,
        [`flags.${MODULE_ID}.${FLAG_KEY}.-=${this.#texKey}`]: null,
      });
      return void ui.notifications.info("No cuts — restored the original image.");
    }

    if (/^https?:\/\//i.test(s.originalSrc)) {
      return void ui.notifications.error("The source image is a remote URL — masked copies can only be saved for local Data files.");
    }
    const slash = s.originalSrc.lastIndexOf("/");
    const dir = slash >= 0 ? s.originalSrc.slice(0, slash) : "";
    const filename = s.originalSrc.slice(slash + 1);
    const base = filename.replace(/\.[^.]+$/, "").replace(/-masked-\d+$/, "");
    const rev = s.rev + 1;
    const outName = `${base}-masked-${rev}.webp`;

    const blob = await new Promise((resolve) => this.#cvs.toBlob(resolve, "image/webp", 0.92));
    if (!blob) return void ui.notifications.error("Failed to encode the masked image.");
    const file = new File([blob], outName, { type: "image/webp" });
    try {
      const FilePicker = foundry.applications.apps.FilePicker.implementation;
      const result = await FilePicker.upload("data", dir, file, {}, { notify: false });
      if (!result?.path) throw new Error("upload rejected");
      s.rev = rev;
      await level.update({
        [`${this.#texKey}.src`]: result.path,
        [`flags.${MODULE_ID}.${FLAG_KEY}.${this.#texKey}`]: {
          originalSrc: s.originalSrc,
          shapes: this.#shapes,
          feather: this.#feather,
          rev,
        },
      });
      ui.notifications.info(`Applied mask — "${level.name}" now uses ${outName}.`);
    } catch (error) {
      console.error(`${MODULE_ID} | Alpha mask apply failed`, error);
      ui.notifications.error(`Failed to save the masked image: ${error.message}`);
    }
  }

  async #revert() {
    const s = this.#session;
    if (!s) return;
    this.#restorePreview();
    if (s.level[this.#texKey]?.src !== s.originalSrc) {
      await s.level.update({ [`${this.#texKey}.src`]: s.originalSrc });
      ui.notifications.info(`"${s.level.name}" reverted to the original image (cuts remain stored).`);
    }
  }

  async #forget() {
    const level = this.#level();
    if (!level) return;
    const flag = level.getFlag(MODULE_ID, FLAG_KEY)?.[this.#texKey];
    const updates = { [`flags.${MODULE_ID}.${FLAG_KEY}.-=${this.#texKey}`]: null };
    if (flag?.originalSrc) updates[`${this.#texKey}.src`] = flag.originalSrc;
    await level.update(updates);
    this.#loadSession();
  }

  async close(options) {
    this.#endCapture();
    this.#restorePreview();
    this.#maskTexture?.destroy(true);
    this.#maskTexture = null;
    return super.close(options);
  }
}

/* -------------------------------------------- */
/*  Entry points                                */
/* -------------------------------------------- */

function refreshMaskButtons() {
  const show = (canvas?.scene?.levels?.size ?? 0) >= 2;
  for (const button of document.querySelectorAll(".slc-mask-open")) button.hidden = !show;
}

Hooks.on("renderSceneDirectory", (app, html) => {
  if (!game.user.isGM || !foundry.documents?.Level) return;
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root || root.querySelector(".slc-mask-open")) return;
  const footer = root.querySelector(".directory-footer");
  if (!footer) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "slc-mask-open";
  button.innerHTML = '<i class="fa-solid fa-scissors"></i> Mask Cutter';
  button.addEventListener("click", () => AlphaMaskCutter.open());
  // Sit between the Stair Painter and Combine into Levels buttons when present.
  const combine = footer.querySelector(".slc-open");
  if (combine) combine.before(button);
  else footer.append(button);
  refreshMaskButtons();
});

Hooks.on("canvasReady", refreshMaskButtons);
Hooks.on("createLevel", refreshMaskButtons);
Hooks.on("deleteLevel", refreshMaskButtons);

Hooks.once("ready", () => {
  if (!foundry.documents?.Level) return;
  const module = game.modules.get(MODULE_ID);
  module.api ??= {};
  module.api.levelAlphaMask = { open: () => AlphaMaskCutter.open() };
});
