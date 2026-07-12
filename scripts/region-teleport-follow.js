/**
 * Region Teleport Follow — GM navigation through teleport regions.
 *
 * Select (or hover) a Region that has a Teleport Token behavior and press the
 * hotkey: your own view jumps to the destination region — switching *your*
 * viewed scene if needed (players are untouched) and panning the camera to the
 * destination region's center. Handy for prepping/running maps stitched
 * together with teleporters.
 *
 * Works from any layer: a selected/hovered region wins (Regions layer), and
 * otherwise teleport regions under the mouse cursor are point-tested — so on
 * the Token layer, hovering the stairs and pressing the hotkey just works.
 *
 * v14 notes:
 * - The teleport behavior stores a `destinations` Set of Region UUIDs plus a
 *   `choice` flag (v12's single `destination` field is gone). Multiple
 *   resolvable destinations get a picker dialog.
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

/** Teleport-bearing regions of the viewed scene containing the current mouse position. */
function teleportRegionsUnderMouse() {
  const { x, y } = canvas.mousePosition;
  return canvas.scene.regions.filter((regionDoc) => {
    if (!teleportDestinationUuids(regionDoc).size) return false;
    // Clamp elevation into the region's own range so only x/y matters.
    const elevation = regionDoc.elevation?.bottom ?? regionDoc.elevation?.top ?? 0;
    return regionDoc.testPoint({ x, y, elevation });
  });
}

/** Let the GM pick among multiple destination regions. Returns a RegionDocument or null. */
async function pickDestination(regions) {
  const options = regions
    .map((r, i) => `<option value="${i}">${foundry.utils.escapeHTML(`${r.name ?? r.id} — ${r.parent.name}`)}</option>`)
    .join("");
  const index = await foundry.applications.api.DialogV2.prompt({
    window: { title: "Teleport Destination" },
    content: `<select name="destination" autofocus style="width: 100%;">${options}</select>`,
    ok: {
      label: "Go",
      icon: "fa-solid fa-person-through-window",
      callback: (event, button) => button.form.elements.destination.value,
    },
    rejectClose: false,
  });
  return index === null ? null : regions[Number(index)];
}

/* -------------------------------------------- */
/*  Navigation                                   */
/* -------------------------------------------- */

async function followTeleport() {
  const region = canvas.regions?.controlled[0] ?? canvas.regions?.hover;
  let sources;
  if (region) {
    sources = [region.document];
  } else {
    sources = teleportRegionsUnderMouse();
    if (!sources.length) {
      ui.notifications.info("No teleport region under the cursor — select one on the Regions layer or hover one.");
      return;
    }
  }

  const uuids = new Set(sources.flatMap((doc) => [...teleportDestinationUuids(doc)]));
  if (!uuids.size) {
    ui.notifications.info(`Region "${region.document.name ?? region.id}" has no enabled Teleport Token behavior.`);
    return;
  }

  const destinations = (await Promise.all([...uuids].map((uuid) => fromUuid(uuid)))).filter(
    (doc) => doc instanceof foundry.documents.RegionDocument,
  );
  if (!destinations.length) {
    ui.notifications.warn("None of the teleport destinations could be resolved (deleted region or scene?).");
    return;
  }

  const destination = destinations.length === 1 ? destinations[0] : await pickDestination(destinations);
  if (!destination) return; // picker cancelled

  const scene = destination.parent;
  if (scene !== canvas.scene) await scene.view();

  const center = regionCenter(destination);
  if (center) await canvas.animatePan(center);
}

/* -------------------------------------------- */
/*  Entry point                                  */
/* -------------------------------------------- */

Hooks.once("init", () => {
  game.keybindings.register(MODULE_ID, "followRegionTeleport", {
    name: "Follow Region Teleport",
    hint: "View the teleport destination of the selected/hovered region, or (on other layers) of the teleport region under the mouse cursor: switches your scene if needed and pans to the target region.",
    editable: [{ key: "KeyJ" }],
    restricted: true, // GM only
    onDown: () => {
      followTeleport();
      return true;
    },
  });
});
