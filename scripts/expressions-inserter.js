/**
 * PF2e Expressions Inserter
 *
 * Keyboard-invoked helper dialog that builds PF2e inline expressions
 * (@Check, @Damage, @Template, inline rolls) and inserts them into the
 * active ProseMirror editor or copies them to the clipboard.
 *
 * Stub — implementation in progress.
 */

const MODULE_ID = "pf2e-house-rules";

Hooks.once("init", () => {
    if (game.system.id !== "pf2e") return;
});
