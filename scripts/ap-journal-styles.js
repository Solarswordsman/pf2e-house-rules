/**
 * AP Journal Styles — author Metamorphic/Paizo Adventure Path journal blocks
 * from the rich-text editor instead of hand-editing HTML in code view.
 *
 * Adds an "Adventure Path" submenu to the ProseMirror Format dropdown (same
 * mechanism the PF2e system uses for its own styles) with two kinds of entry:
 *   - toggles: flip a class on the current block (read-aloud, no-indent,
 *     no-toc, float-left/right)
 *   - scaffolds: insert a ready-made block matching the markup vocabulary the
 *     Metamorphic AP modules use (encounter box, sidebar, action, traits,
 *     advancement track, chapter heading)
 *
 * Load-bearing facts:
 *   - Classes must be written into the node's `_preserve` attr — that is
 *     Foundry's attribute-capture channel; a plain `class` attr is dropped by
 *     the ProseMirror schema on save.
 *   - The AP styling itself lives in the Metamorphic modules and only renders
 *     inside their journal sheet (selectors are scoped to e.g.
 *     `.seasonofghosts-wrapper`). This tweak only helps AUTHOR the markup, so
 *     it needs no dependency and stays useful without any AP module active.
 *     In-editor visual affordances come from styles/ap-journal-styles.css.
 */

/** Blocks inserted at the cursor, matching Metamorphic's markup verbatim. */
const SCAFFOLDS = [
  {
    action: "ap-encounter",
    title: "Encounter Box",
    html: `<section class="encounter">
      <div class="header">
        <img src="icons/svg/mystery-man.svg" />
        <h2 class="split no-toc"><span class="keepme">Encounter Name</span> <span class="keepme">Moderate 1</span></h2>
        <span class="link">@UUID[Actor.id]{Creature}</span>
      </div>
      <p>Tactics and encounter notes.</p>
    </section>`,
  },
  {
    action: "ap-sidebar",
    title: "Sidebar",
    html: `<aside class="sidebar">
      <h1>Sidebar Title</h1>
      <p>Sidebar text.</p>
    </aside>`,
  },
  {
    action: "ap-sidebar-float",
    title: "Sidebar (Floating)",
    html: `<aside class="float-right">
      <h1 class="no-toc">Sidebar Title</h1>
      <p>Sidebar text.</p>
    </aside>`,
  },
  {
    action: "ap-action",
    title: "Action Block",
    html: `<section class="action">
      <h1 class="no-toc">Action Name</h1>
    </section>
    <ul class="traits"><li class="trait">Trait</li></ul>
    <p><strong>Requirements</strong> Any requirements.</p>
    <hr />
    <p class="no-indent">Effect text.</p>`,
  },
  {
    action: "ap-traits",
    title: "Traits List",
    html: `<ul class="traits"><li class="trait">Trait</li><li class="trait">Trait</li></ul>`,
  },
  {
    action: "ap-advancement",
    title: "Advancement Track",
    html: `<section class="advancement-track">
      <h1>Advancement Track</h1>
      <p><span class="level">1</span> The PCs begin this adventure at 1st level.</p>
      <p><span class="level">2</span> The PCs should reach 2nd level when…</p>
    </section>`,
  },
  {
    action: "ap-chapter-heading",
    title: "Chapter Heading",
    html: `<h1 class="chapter-heading no-toc"><span>Chapter Title</span></h1>`,
  },
];

/** Classes toggled on the nearest block (heading, paragraph, section, aside). */
const CLASS_TOGGLES = [
  { action: "ap-no-toc", title: "Toggle: No TOC", cls: "no-toc" },
  { action: "ap-float-right", title: "Toggle: Float Right", cls: "float-right" },
  { action: "ap-float-left", title: "Toggle: Float Left", cls: "float-left" },
];

/** Parse an HTML string into ProseMirror content using Foundry's schema
 *  (which routes class attrs into `_preserve` exactly like editor loading). */
function parseHTML(html, schema) {
  const pm = foundry.prosemirror ?? globalThis.ProseMirror;
  if (pm.dom?.parseString) return pm.dom.parseString(html, schema);
  const dom = new DOMParser().parseFromString(html, "text/html");
  return pm.DOMParser.fromSchema(schema).parse(dom.body);
}

function insertScaffold(view, schema, html) {
  const doc = parseHTML(html, schema);
  const tr = view.state.tr.deleteSelection();
  tr.insert(tr.selection.from, doc.content);
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** Toggle `cls` inside `_preserve.class` on the block containing the cursor. */
function toggleBlockClass(view, cls) {
  const { state } = view;
  const $from = state.selection.$from;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (!node.isTextblock && !["section", "aside", "div"].includes(node.type.name)) continue;
    const preserve = foundry.utils.deepClone(node.attrs._preserve ?? {});
    const classes = new Set((preserve.class ?? "").split(/\s+/).filter((c) => c));
    classes.has(cls) ? classes.delete(cls) : classes.add(cls);
    if (classes.size) preserve.class = [...classes].join(" ");
    else delete preserve.class;
    const attrs = { ...node.attrs, _preserve: preserve };
    view.dispatch(state.tr.setNodeMarkup($from.before(depth), null, attrs));
    return true;
  }
  return false;
}

Hooks.on("getProseMirrorMenuDropDowns", (menu, dropdowns) => {
  if (!("format" in dropdowns)) return;
  const schema = menu.schema;

  const paragraphToggle = (action, title, cls) => ({
    action,
    title,
    node: schema.nodes.paragraph,
    attrs: { _preserve: { class: cls } },
    priority: 1,
    cmd: () => {
      menu._toggleTextBlock(schema.nodes.paragraph, {
        attrs: { _preserve: { class: cls } },
      });
      return true;
    },
  });

  dropdowns.format.entries.push({
    action: "ap-styles",
    title: "Adventure Path",
    children: [
      paragraphToggle("ap-read-aloud", "Read Aloud", "read-aloud"),
      paragraphToggle("ap-no-indent", "No Indent", "no-indent"),
      ...CLASS_TOGGLES.map(({ action, title, cls }) => ({
        action,
        title,
        priority: 1,
        cmd: () => toggleBlockClass(menu.view, cls),
      })),
      ...SCAFFOLDS.map(({ action, title, html }) => ({
        action,
        title,
        priority: 1,
        cmd: () => insertScaffold(menu.view, schema, html),
      })),
    ],
  });
});
