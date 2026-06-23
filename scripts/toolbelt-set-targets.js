/**
 * Toolbelt Player Set-Targets
 *
 * Lets a player push their current targets onto a PF2e Toolbelt "Target Helper"
 * card (damage / spell / area) even when the GM forgot to set targets before
 * rolling. Adds both an on-card bullseye button and a hotkey.
 *
 * Requires: pf2e-toolbelt (Target Helper enabled) and a GM online.
 * No-ops quietly if Toolbelt isn't present.
 */

// MUST match "id" in module.json — the player->GM socket channel is `module.<id>`
// and only works if these agree (and "socket": true is set in the manifest).
const MODULE_ID = "pf2e-house-rules";
const CHANNEL = `module.${MODULE_ID}`;
const TH_TYPES = new Set(["damage", "spell", "area"]);

function findLatestTHCard() {
  const msgs = game.messages.contents;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const th = msgs[i].flags?.["pf2e-toolbelt"]?.targetHelper;
    if (th && TH_TYPES.has(th.type)) return msgs[i];
  }
  return null;
}

async function writeTargets(message, uuids) {
  const api = game.toolbelt?.api?.targetHelper;
  if (!message || !api) return;
  await message.update(api.setMessageFlagTargets({}, uuids ?? []));
}

function pushTargetsTo(message) {
  if (!message) return ui.notifications.warn("No Target Helper card found.");
  const uuids = Array.from(game.user.targets).map((t) => t.document.uuid);
  if (!uuids.length) return ui.notifications.warn("You have no targets selected.");

  if (game.user.isGM || message.isAuthor) {
    writeTargets(message, uuids); // we can write directly
  } else if (game.users.activeGM) {
    game.socket.emit(CHANNEL, { messageId: message.id, uuids }); // ask the GM to write
  } else {
    return ui.notifications.error("No GM is online to set targets.");
  }
  ui.notifications.info(`Pushed ${uuids.length} target(s) to the card.`);
}

function pushMyTargetsToCard() { pushTargetsTo(findLatestTHCard()); }
globalThis.pushMyTargetsToCard = pushMyTargetsToCard; // callable from a macro

function makeButton(message) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pf2e-toolbelt-target-setTargets targets tb-player-set";
  btn.title = "Set this card's targets to my current targets";
  btn.innerHTML = "<i class='fa-solid fa-bullseye-arrow'></i>";
  btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); pushTargetsTo(message); });
  return btn;
}

function findToolbeltWrapper(root) {
  return [...root.querySelectorAll(".pf2e-toolbelt-target-buttons")]
    .find((w) => !w.closest(".pf2e-toolbelt-target-targetRows"));
}

function tryInject(message, attempt = 0) {
  const root = document.querySelector(`.chat-message[data-message-id="${message.id}"]`);
  if (!root) {
    if (attempt < 15) requestAnimationFrame(() => tryInject(message, attempt + 1));
    return;
  }
  if (root.querySelector(".tb-player-set")) return; // already injected on this node

  // If Toolbelt already built its button row, append into it (right after the toggle).
  const existing = findToolbeltWrapper(root);
  if (existing) { existing.append(makeButton(message)); return; }

  // Targets are set but Toolbelt's wrapper hasn't rendered yet (async) — wait a few frames.
  const hasTargets = (message.flags?.["pf2e-toolbelt"]?.targetHelper?.targets?.length ?? 0) > 0;
  if (hasTargets && attempt < 15) {
    requestAnimationFrame(() => tryInject(message, attempt + 1));
    return;
  }

  // No targets set: make our own wrapper. It MUST live inside .dice-total — that's where
  // Toolbelt's CSS absolutely-positions these buttons; anywhere else renders off-card.
  const anchor = root.querySelector(".dice-result .dice-total")
    ?? root.querySelector(".dice-result .dice-formula")
    ?? root.querySelector(".card-buttons")
    ?? root.querySelector(".message-content");
  if (!anchor) return;
  const wrapper = document.createElement("div");
  wrapper.className = "pf2e-toolbelt-target-buttons";
  anchor.append(wrapper);
  wrapper.append(makeButton(message));
}

Hooks.once("init", () => {
  game.keybindings.register(MODULE_ID, "pushTargets", {
    name: "Push my targets onto the latest Target Helper card",
    editable: [{ key: "KeyT", modifiers: ["Shift", "Alt"] }],
    onDown: () => { pushMyTargetsToCard(); return true; },
    restricted: false,
  });
});

Hooks.once("ready", () => {
  // Only the active GM performs the privileged flag write on behalf of players.
  game.socket.on(CHANNEL, async ({ messageId, uuids }) => {
    if (!game.user.isActiveGM) return;
    try {
      await writeTargets(game.messages.get(messageId), uuids);
    } catch (e) {
      console.error(`${MODULE_ID} | writeTargets error`, e);
    }
  });
});

Hooks.on("renderChatMessageHTML", (message, html) => {
  if (game.user.isGM || message.isAuthor) return; // they already get the native button
  const th = message.flags?.["pf2e-toolbelt"]?.targetHelper;
  if (!th || !TH_TYPES.has(th.type)) return;
  requestAnimationFrame(() => tryInject(message)); // let Toolbelt's async render run first
});
