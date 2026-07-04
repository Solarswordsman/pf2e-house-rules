/**
 * PF2e Infiltration Builder
 *
 * Step-by-step builder for GM Core Infiltration subsystem challenges
 * (and anything infiltration-shaped): objectives/phases, obstacles with
 * skill checks / saves / spellcasting opportunities at party-level DCs,
 * awareness point thresholds, complications, and consequences. Outputs a
 * formatted journal entry with live inline check expressions.
 *
 * Stub — implementation in progress.
 */

const MODULE_ID = "pf2e-house-rules";

Hooks.once("init", () => {
    if (game.system.id !== "pf2e") return;
});
