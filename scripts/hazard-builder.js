/**
 * PF2e Hazard Builder
 *
 * Guided dialog for creating Hazard actors at a chosen level, filling in
 * level-appropriate statistics (AC, saves, Stealth, attack bonuses, DCs,
 * damage) from the GM Core building-hazards tables, so a working hazard
 * comes out instead of an empty shell.
 *
 * Stub — implementation in progress.
 */

const MODULE_ID = "pf2e-house-rules";

Hooks.once("init", () => {
    if (game.system.id !== "pf2e") return;
});
