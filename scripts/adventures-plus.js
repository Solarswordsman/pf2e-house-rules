/**
 * Adventures+ — optional rules from the third-party "Adventures+" supplement.
 * Each rule has its own world-scoped enable setting (on by default).
 *
 * 1. Initiative crits — a natural 20 on an initiative roll makes you Quickened
 *    on your first turn; a natural 1 makes you Off-Guard until the start of
 *    your turn. Deliberately light automation: the check message just gets a
 *    roll note (PF2e's own `ul.notes > li.roll-note` markup in the flavor) with
 *    the condition linked. PF2e enriches message flavor on render, so the raw
 *    `@UUID[...]` text is correct here.
 *
 * Detection: PF2e stamps initiative checks with `flags.core.initiativeRoll`
 * and `flags.pf2e.context.type === "initiative"` (system `check.ts`). Hero
 * Point rerolls delete the original message and create a fresh one carrying
 * the same flags with the *kept* roll first in `rolls`, so this fires again
 * with the right die. The hook is `preCreateChatMessage`, which runs on the
 * rolling client only — one write, every client sees it.
 *
 * Settings are registered on `init`, or immediately if the script is loaded
 * into an already-running game (e.g. via a console `import()` before the
 * server has been restarted to pick up the manifest change).
 */

const MODULE_ID = "pf2e-house-rules";

const CONDITIONS = {
  quickened: "@UUID[Compendium.pf2e.conditionitems.nlCjDvLMf2EkV2dl]{Quickened}",
  offGuard: "@UUID[Compendium.pf2e.conditionitems.AJh5ex99aV6VTggg]{Off-Guard}",
};

function registerSettings() {
  game.settings.register(MODULE_ID, "apInitiativeCrits", {
    name: "Adventures+: initiative natural 20 / natural 1",
    hint: "A natural 20 on initiative adds a note that the roller is Quickened on their first turn; a natural 1 adds a note that they are Off-Guard until the start of their turn.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
}

if (game.ready) registerSettings();
else Hooks.once("init", registerSettings);

/** The active face of the first d20 in a message's first roll, or null. */
function initiativeDieFace(message, data) {
  let roll = message.rolls?.[0] ?? null;
  if (!roll) {
    // Fall back to the raw creation data in case derived data isn't prepared yet.
    const raw = data.rolls?.[0];
    if (!raw) return null;
    try {
      roll = Roll.fromData(typeof raw === "string" ? JSON.parse(raw) : raw);
    } catch {
      return null;
    }
  }
  const d20 = roll.dice?.find((d) => d.faces === 20);
  const active = d20?.results?.find((r) => r.active) ?? d20?.results?.[0];
  return typeof active?.result === "number" ? active.result : null;
}

Hooks.on("preCreateChatMessage", (message, data) => {
  try {
    if (game.system.id !== "pf2e") return;
    if (!message.flags?.core?.initiativeRoll && message.flags?.pf2e?.context?.type !== "initiative") return;
    if (!game.settings.get(MODULE_ID, "apInitiativeCrits")) return;

    const face = initiativeDieFace(message, data);
    const text =
      face === 20
        ? `${CONDITIONS.quickened} on the first turn.`
        : face === 1
          ? `${CONDITIONS.offGuard} until the start of your turn.`
          : null;
    if (!text) return;

    // Append to the flavor's existing roll-note list, or start one.
    const wrapper = document.createElement("div");
    wrapper.innerHTML = message.flavor ?? "";
    let list = wrapper.querySelector("ul.notes");
    if (!list) {
      list = document.createElement("ul");
      list.classList.add("notes");
      wrapper.append(list);
    }
    const note = document.createElement("li");
    note.classList.add("roll-note", "adventures-plus");
    const title = document.createElement("strong");
    title.textContent = "Adventures+";
    note.append(title, ` ${text}`);
    list.append("\n", note, "\n");

    message.updateSource({ flavor: wrapper.innerHTML });
  } catch (err) {
    // Never abort message creation over a note.
    console.error(`${MODULE_ID} | Adventures+ initiative note failed`, err);
  }
});
