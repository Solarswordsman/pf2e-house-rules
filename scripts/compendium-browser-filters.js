/**
 * Compendium Browser extra filters (PF2e system, Foundry v14).
 *
 * Adds three checkbox filter groups the system doesn't expose:
 *  - Equipment tab: "Other Tags" (system.traits.otherTags, e.g. alchemical-food)
 *  - Equipment tab: "Usage" (system.usage.value, e.g. worn, wornshoes)
 *  - Feats tab: "Dedication" (archetype feats grouped by their prerequisite
 *    "<Name> Dedication" feat; the dedication feat itself is included)
 *
 * How it works: the v14 browser filters generically — every result row carries
 * an `options` Set of "prefix:value" tokens, `buildPredicate()` walks *all*
 * groups in `filterData.checkboxes`, and the filter sidebar renders every
 * group it finds. So we wrap each tab's `loadData` to (1) run the system's
 * loader, (2) fetch the extra index fields in a supplemental getIndex pass,
 * (3) merge tokens into each entry's options Set by UUID, and (4) inject
 * checkbox groups whose options are collected from the actual data. This runs
 * before `init()` builds the MiniSearch engine and snapshots
 * defaultFilterData, so text search and "Clear all filters" behave correctly.
 */

const MODULE_ID = "pf2e-house-rules";

const sluggify = (text) =>
    game.pf2e?.system?.sluggify?.(text) ??
    text
        .toLowerCase()
        .replace(/['’]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .replace(/\s+/g, "-");

const titleCase = (slug) =>
    slug
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());

/** Wrap a tab's loadData so `enrich(tab)` runs after the system loader. */
function wrapLoadData(tab, enrich) {
    const original = tab.loadData;
    tab.loadData = async function (...args) {
        await original.apply(this, args);
        try {
            await enrich(this);
        } catch (error) {
            console.error(`${MODULE_ID} | Failed to add extra compendium browser filters`, error);
        }
    };
}

/** Supplemental index pass: uuid -> index entry with the requested fields. */
async function loadExtraIndex(tab, tabName, fields) {
    const byUuid = new Map();
    for (const packId of tab.browser.loadedPacks(tabName)) {
        const pack = game.packs.get(packId);
        if (pack?.documentName !== "Item") continue;
        const index = await pack.getIndex({ fields });
        for (const entry of index) byUuid.set(entry.uuid, entry);
    }
    return byUuid;
}

/** Build sorted CheckboxOptions from a slug -> label map. */
function toCheckboxOptions(labelsBySlug) {
    return Object.fromEntries(
        [...labelsBySlug.entries()]
            .sort((a, b) => a[1].localeCompare(b[1], game.i18n.lang))
            .map(([slug, label]) => [slug, { label, selected: false }]),
    );
}

async function enrichEquipmentTab(tab) {
    const byUuid = await loadExtraIndex(tab, "equipment", ["system.traits.otherTags", "system.usage.value"]);

    const otherTagLabels = {
        ...CONFIG.PF2E.otherArmorTags,
        ...CONFIG.PF2E.otherConsumableTags,
        ...CONFIG.PF2E.otherWeaponTags,
    };
    const seenTags = new Map();
    const seenUsages = new Map();

    for (const entry of tab.indexData) {
        const extra = byUuid.get(entry.uuid);
        if (!extra) continue;

        for (const tag of extra.system?.traits?.otherTags ?? []) {
            entry.options.add(`otherTags:${tag}`);
            if (!seenTags.has(tag)) {
                const label = otherTagLabels[tag];
                seenTags.set(tag, label ? game.i18n.localize(label) : titleCase(tag));
            }
        }

        const usageData = extra.system?.usage;
        if (usageData !== undefined) {
            const usage = usageData.value || "carried";
            entry.options.add(`usage:${usage}`);
            if (!seenUsages.has(usage)) {
                const label = CONFIG.PF2E.usages?.[usage];
                seenUsages.set(usage, label ? game.i18n.localize(label) : titleCase(usage));
            }
        }
    }

    if (seenTags.size > 0) {
        tab.filterData.checkboxes.otherTags = {
            isExpanded: false,
            label: "Other Tags",
            options: toCheckboxOptions(seenTags),
            optionPrefix: "otherTags",
            selected: [],
        };
    }
    if (seenUsages.size > 0) {
        tab.filterData.checkboxes.usage = {
            isExpanded: false,
            label: "Usage",
            options: toCheckboxOptions(seenUsages),
            optionPrefix: "usage",
            selected: [],
        };
    }
}

async function enrichFeatTab(tab) {
    const byUuid = await loadExtraIndex(tab, "feat", ["system.prerequisites.value"]);
    const seenDedications = new Map();
    const dedicationPattern = /([A-Z][^,;.()]*?)\s+Dedication\b/g;

    const record = (entry, name) => {
        const slug = sluggify(name);
        entry.options.add(`dedication:${slug}`);
        if (!seenDedications.has(slug)) seenDedications.set(slug, name);
    };

    for (const entry of tab.indexData) {
        // The dedication feat itself belongs to its own group
        const selfMatch = /^(.+?)\s+Dedication$/.exec(entry.name);
        if (selfMatch) record(entry, selfMatch[1].trim());

        const extra = byUuid.get(entry.uuid);
        for (const prereq of extra?.system?.prerequisites?.value ?? []) {
            const text = prereq?.value ?? "";
            for (const match of text.matchAll(dedicationPattern)) {
                record(entry, match[1].trim());
            }
        }
    }

    if (seenDedications.size > 0) {
        tab.filterData.checkboxes.dedication = {
            isExpanded: false,
            label: "Dedication",
            options: toCheckboxOptions(seenDedications),
            optionPrefix: "dedication",
            selected: [],
        };
    }
}

Hooks.once("ready", () => {
    const browser = game.pf2e?.compendiumBrowser;
    if (!browser?.tabs?.equipment || !browser?.tabs?.feat) {
        console.warn(`${MODULE_ID} | PF2e compendium browser not found; extra filters disabled`);
        return;
    }
    wrapLoadData(browser.tabs.equipment, enrichEquipmentTab);
    wrapLoadData(browser.tabs.feat, enrichFeatTab);
    console.log(`${MODULE_ID} | Compendium browser extra filters registered`);
});
