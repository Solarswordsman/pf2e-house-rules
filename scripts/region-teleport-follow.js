/**
 * Region Teleport Follow — GM navigation through transition regions.
 *
 * Select (or hover) a Region that has a Teleport Token or Change Scene Level
 * behavior and press the hotkey: your own view follows the transition —
 * switching *your* viewed scene or scene level if needed (players are
 * untouched) and panning the camera to the destination. Handy for
 * prepping/running maps stitched together with teleporters or stairs.
 *
 * Works from any layer: a selected/hovered region wins (Regions layer), and
 * otherwise transition regions under the mouse cursor are point-tested — so on
 * the Token layer, hovering the stairs and pressing the hotkey just works.
 *
 * v14 notes:
 * - The teleport behavior stores a `destinations` Set of Region UUIDs plus a
 *   `choice` flag (v12's single `destination` field is gone).
 * - The changeLevel behavior has no destination config of its own: its
 *   destinations are the region's `levels` set (empty = every scene level),
 *   minus wherever you currently are (`canvas.level`) — mirroring core's
 *   ChangeLevelRegionBehaviorType.#getDestinationLevels. Switching the viewed
 *   level is `scene.view({level})`, the same call core makes after a token
 *   confirms a level change.
 * - Multiple resolvable destinations (of either kind, including a region that
 *   has both behaviors) get a single picker dialog.
 * - Regions are ordinary placeables: `canvas.regions.controlled` / `.hover`.
 *   Off-layer, `RegionDocument#testPoint` wants an ElevatedPoint; passing an
 *   elevation inside the region's own range makes the test effectively 2D.
 *
 * Requires: nothing beyond core Foundry. Purely client-side — no data changes.
 */

const MODULE_ID = "pf2e-house-rules";

/* -------------------------------------------- */
/*  Destination resolution                       */
/* -------------------------------------------- */

/** Collect destination Region UUIDs from a region's enabled teleport behaviors. */
function teleportDestinationUuids(regionDoc) {
  const uuids = new Set();
  for (const behavior of regionDoc.behaviors) {
    if (behavior.type !== "teleportToken" || behavior.disabled) continue;
    for (const uuid of behavior.system.destinations ?? []) uuids.add(uuid);
  }
  return uuids;
}

/**
 * Destination Levels of a region's enabled changeLevel behaviors: the region's
 * `levels` set (empty = all scene levels), minus the currently viewed level.
 */
function changeLevelDestinations(regionDoc) {
  if (!regionDoc.behaviors.some((b) => b.type === "changeLevel" && !b.disabled)) return [];
  const scene = regionDoc.parent;
  const levels = regionDoc.levels.size
    ? [...regionDoc.levels].map((id) => scene.levels.get(id)).filter((l) => l)
    : scene.levels.contents;
  return levels.filter((l) => l.id !== canvas.level?.id).sort((a, b) => a.sort - b.sort);
}

/**
 * Geometric center of a region, preferring the drawn placeable. Falls back to
 * the bounding box of the document's shape data (placeable may not exist yet
 * right after a scene switch).
 */
function regionCenter(regionDoc) {
  const placeable = regionDoc.object;
  if (placeable?.center) return { x: placeable.center.x, y: placeable.center.y };

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const extend = (x, y) => {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  };
  for (const shape of regionDoc.shapes) {
    switch (shape.type) {
      case "rectangle":
        extend(shape.x, shape.y);
        extend(shape.x + shape.width, shape.y + shape.height);
        break;
      case "ellipse":
        extend(shape.x - shape.radiusX, shape.y - shape.radiusY);
        extend(shape.x + shape.radiusX, shape.y + shape.radiusY);
        break;
      case "polygon":
        for (let i = 0; i < shape.points.length - 1; i += 2) {
          extend(shape.points[i], shape.points[i + 1]);
        }
        break;
    }
  }
  if (!Number.isFinite(x0)) return null;
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

/**
 * Transition-bearing regions of the viewed scene containing the current mouse
 * position. Restricted to regions included in the currently viewed level —
 * stair regions of different floors stack at the same x/y on multi-level
 * scenes, and matching the invisible ones would force a picker every time.
 */
function transitionRegionsUnderMouse() {
  const { x, y } = canvas.mousePosition;
  return canvas.scene.regions.filter((regionDoc) => {
    if (canvas.level && !regionDoc.includedInLevel(canvas.level.id)) return false;
    if (!teleportDestinationUuids(regionDoc).size && !changeLevelDestinations(regionDoc).length) return false;
    // Clamp elevation into the region's own range so only x/y matters.
    const elevation = regionDoc.elevation?.bottom ?? regionDoc.elevation?.top ?? 0;
    return regionDoc.testPoint({ x, y, elevation });
  });
}

/**
 * Let the GM pick among multiple destinations (regions and/or scene levels).
 * Takes and returns entries of `{label, go}`; null if cancelled.
 */
async function pickDestination(entries) {
  const options = entries
    .map((e, i) => `<option value="${i}">${foundry.utils.escapeHTML(e.label)}</option>`)
    .join("");
  const index = await foundry.applications.api.DialogV2.prompt({
    window: { title: "Transition Destination" },
    content: `<select name="destination" autofocus style="width: 100%;">${options}</select>`,
    ok: {
      label: "Go",
      icon: "fa-solid fa-person-through-window",
      callback: (event, button) => button.form.elements.destination.value,
    },
    rejectClose: false,
  });
  return index === null ? null : entries[Number(index)];
}

/* -------------------------------------------- */
/*  Navigation                                   */
/* -------------------------------------------- */

/**
 * View another region: switch scene and/or viewed scene level if needed, pan to
 * its center. A region restricted to specific levels (non-empty `levels` set)
 * is only visible while one of them is viewed — teleport stairs between floors
 * of one multi-level scene are exactly this case, so a same-scene teleport may
 * still require a level switch.
 */
async function goToRegion(destination) {
  const scene = destination.parent;
  const sceneChange = scene !== canvas.scene;
  const levelIds = destination.levels; // Set of level ids; empty = all levels
  let levelId = null;
  if (levelIds.size && (sceneChange || !levelIds.has(canvas.level?.id))) {
    const levels = [...levelIds]
      .map((id) => scene.levels.get(id))
      .filter((l) => l)
      .sort((a, b) => a.sort - b.sort);
    levelId = levels[0]?.id ?? null;
  }
  if (sceneChange || levelId) await scene.view(levelId ? { level: levelId } : {});
  const center = regionCenter(destination);
  if (center) await canvas.animatePan(center);
}

/** View another level of the current scene, keeping the camera on the source region (the stairs). */
async function goToLevel(level, sourceDoc) {
  const center = regionCenter(sourceDoc);
  await level.parent.view({ level: level.id });
  if (center) await canvas.animatePan(center);
}

async function followTransition() {
  const region = canvas.regions?.controlled[0] ?? canvas.regions?.hover;
  let sources;
  if (region) {
    sources = [region.document];
  } else {
    sources = transitionRegionsUnderMouse();
    if (!sources.length) {
      ui.notifications.info("No teleport or level-change region under the cursor — select one on the Regions layer or hover one.");
      return;
    }
  }

  const uuids = new Set(sources.flatMap((doc) => [...teleportDestinationUuids(doc)]));
  const levelEntries = [];
  const seenLevels = new Set();
  for (const doc of sources) {
    for (const level of changeLevelDestinations(doc)) {
      if (seenLevels.has(level.id)) continue;
      seenLevels.add(level.id);
      levelEntries.push({ label: `Level: ${level.name}`, go: () => goToLevel(level, doc) });
    }
  }

  if (!uuids.size && !levelEntries.length) {
    ui.notifications.info(
      `Region "${region.document.name ?? region.id}" has no enabled Teleport Token or Change Scene Level behavior (or no level other than the current one).`,
    );
    return;
  }

  const regionDocs = (await Promise.all([...uuids].map((uuid) => fromUuid(uuid)))).filter(
    (doc) => doc instanceof foundry.documents.RegionDocument,
  );
  if (!regionDocs.length && uuids.size && !levelEntries.length) {
    ui.notifications.warn("None of the teleport destinations could be resolved (deleted region or scene?).");
    return;
  }

  const entries = [
    ...regionDocs.map((doc) => ({
      label: `${doc.name ?? doc.id} — ${doc.parent.name}`,
      go: () => goToRegion(doc),
    })),
    ...levelEntries,
  ];

  const entry = entries.length === 1 ? entries[0] : await pickDestination(entries);
  if (!entry) return; // picker cancelled
  await entry.go();
}

/* -------------------------------------------- */
/*  Entry point                                  */
/* -------------------------------------------- */

Hooks.once("init", () => {
  game.keybindings.register(MODULE_ID, "followRegionTeleport", {
    name: "Follow Region Transition",
    hint: "Follow the Teleport Token or Change Scene Level behavior of the selected/hovered region, or (on other layers) of the transition region under the mouse cursor: switches your scene or scene level if needed and pans to the destination.",
    editable: [{ key: "KeyJ" }],
    restricted: true, // GM only
    onDown: () => {
      followTransition();
      return true;
    },
  });
});
