/**
 * PF2e Crafting tab — formula search bar.
 *
 * The character sheet's Inventory tab has a search filter but the Crafting
 * tab's Known Formulas list doesn't, so finding one formula among dozens
 * means scrolling. This injects a search input (mirroring the inventory one)
 * above the Known Formulas list that live-filters formula rows by name.
 *
 * DOM contract (verified against system source, tabs/crafting.hbs):
 *   section.known-formulas > header + ol.formula-list
 *     li.formula-level-header[data-level]  — per-level header row
 *     li.formula-item[data-formula-lvl]    — formula row; name in h4.name
 * Level headers are hidden when none of their formulas match.
 *
 * The sheet re-renders wholesale on any actor update (crafting an item,
 * changing quantity, ...), which wipes the injected input — so the query is
 * remembered per sheet instance and re-applied on every render.
 *
 * Requires: the PF2e system's character sheet. No-ops quietly otherwise.
 */

/** Last search query per sheet instance (sheets persist across re-renders). */
const queries = new WeakMap();

Hooks.on("renderCharacterSheetPF2e", (sheet, html) => {
  // AppV1 passes jQuery, AppV2 passes an HTMLElement — accept either.
  const root = html instanceof HTMLElement ? html : html[0];
  const section = root?.querySelector(".tab.crafting section.known-formulas");
  const list = section?.querySelector("ol.formula-list");
  if (!list || section.querySelector(".hr-formula-search")) return;

  const search = document.createElement("div");
  search.className = "hr-formula-search";
  const input = document.createElement("input");
  input.type = "search";
  input.spellcheck = false;
  input.placeholder = game.i18n.localize("PF2E.Actor.Inventory.Search");
  search.append(input);
  section.querySelector("header")?.after(search);

  const applyFilter = (query) => {
    const q = query.trim().toLocaleLowerCase(game.i18n.lang);
    const visibleLevels = new Set();
    for (const item of list.querySelectorAll("li.formula-item")) {
      const name = item.querySelector("h4.name")?.textContent ?? "";
      const match = !q || name.toLocaleLowerCase(game.i18n.lang).includes(q);
      item.hidden = !match;
      if (match) visibleLevels.add(item.dataset.formulaLvl);
    }
    for (const header of list.querySelectorAll("li.formula-level-header")) {
      header.hidden = !!q && !visibleLevels.has(header.dataset.level);
    }
  };

  input.addEventListener("input", () => {
    queries.set(sheet, input.value);
    applyFilter(input.value);
  });

  // Restore the query after a re-render so the filter survives sheet updates.
  const remembered = queries.get(sheet);
  if (remembered) {
    input.value = remembered;
    applyFilter(remembered);
  }
});
