# Phase 2: Feature Implementation

## Goal

Implement the agreed read-only wiki, content compiler, search, relationship ranking, and dedicated galaxy graph without writing the production worldbuilding corpus.

Phase 2 produces the complete content frame for phase 3. Knowledge creation, modification, and deletion remain direct codebase changes to XML and repository assets; the deployed application never writes content.

## Runtime Contract

- Use Astro and keep the existing strict TypeScript configuration.
- Produce a self-contained Vercel Hobby deployment with no external database, search service, content API, or paid runtime dependency.
- Serve one static application shell for home, search, article, graph, and missing-content routes.
- Use the minimum Vercel route rewrite needed for direct loading of client-routed URLs; do not add a server-rendered article function or a function-bundled corpus.
- Keep article, search, and graph feature bundles route-scoped. Article navigation must not load search or graph code.
- Keep the runtime immutable and read-only. No write endpoint, editor, server action, or source-mutating command belongs to the application.
- Treat Korean as the only UI and content language.

## Route Contract

| Route | Purpose | Required URL state |
|---|---|---|
| `/` | Search-first home and random discovery | None |
| `/search?q=<query>&page=<n>` | Live full-text search results | Query and numbered page |
| `/wiki/<document-id>/<generated-korean-slug>` | Client-rendered article | Immutable document ID; slug is descriptive |
| `/graph` | Dedicated whole-corpus galaxy view | Optional graph history state |
| `/graph?focus=<document-id>` | Dedicated document-focused galaxy view | Immutable focus ID |
| Fallback | Missing or invalid document experience | Original attempted URL |

An old or mismatched article slug still resolves through the immutable ID. Generated internal links use the current slug. Unknown IDs render the missing-document state without scanning the corpus.

## Source and Compiler Contract

### Repository Sources

Use separate hash-sharded source trees for documents and reusable navigation boards, plus repository-owned media:

```text
content/
  documents/<id-hash-prefix>/<document-id>.xml
  boards/<id-hash-prefix>/<board-id>.xml
  media/<asset-id>.<extension>
```

The exact prefix depth is selected from corpus measurements, but no directory may become the long-term container for the full corpus. File discovery is recursive and does not use a manually maintained master list.

### Document Model

Every article uses one universal schema with:

- Immutable compact 128-bit document ID
- Required Korean title
- Optional search aliases
- Optional hidden tags
- Optional manual document connections by immutable ID
- Restricted semantic body content

The slug and section numbers are generated. Summary, category, article type, rendered tag metadata, and type-specific fields do not exist.

### Validation Pipeline

Implement validation as part of the ordinary production build rather than as a test framework:

1. Parse XML with DTDs, external entities, executable inclusions, and network resolution disabled.
2. Enforce the typed Astronet element and attribute vocabulary, nesting rules, size limits, and Unicode NFC normalization.
3. Collect document IDs, board IDs, section IDs, aliases, media IDs, links, manual connections, and board membership into a disk-backed or streaming compiler index.
4. Reject duplicate IDs, malformed IDs, duplicate stable section IDs within a document, invalid URLs, unsafe media, missing board includes, and include cycles.
5. Resolve every document, section, board, and media reference in a second semantic pass.
6. Compile body XML into safe render-ready semantic HTML and structural metadata without copying raw XML to public output.
7. Generate all derived artifacts deterministically and report errors with source path, element, attribute, and target context.

The validator and compiler never rewrite source XML or repository assets. A temporary disk-backed SQLite index may be used during compilation when corpus joins exceed practical memory, but it is reproducible scratch data and is never deployed.

### Safe Rendering Rules

- Emit HTML from typed nodes rather than concatenating author-controlled markup.
- Reject raw HTML, scripts, event attributes, inline CSS, `<style>`, arbitrary iframes, XInclude, and general template execution.
- Permit external links only through a validated external-link element and approved URL protocols.
- Sanitize repository SVG assets by rejecting scripts, event attributes, external resource references, and `foreignObject`; allow ordinary raster formats directly after validation.
- Preserve semantic headings, lists, quotations, tables, figures, captions, footnotes, and link labels.

## Derived Artifact Contract

### Build Identity

Generate one build identifier and embed it in the application shell. Derived asset URLs include that identifier so a deployment never mixes article, search, relationship, or graph data from different builds.

### Article Packs

- Assign documents to deterministic hash buckets derived from immutable IDs.
- Emit size-bounded JSON packs containing multiple compiled articles rather than one file per article.
- Include title, render-ready body, generated table-of-contents data, resolved link routes, footnotes, board headers and section metadata, ranked related-document titles and routes, and integrity metadata.
- Keep media binaries outside article packs.
- Deduplicate reusable board data inside a pack. If a very large shared board would break the pack budget, place its expanded section bodies in a versioned board pack loaded only when the reader opens that section; keep the collapsed header and section controls in the article pack.
- After the application shell is cached, target one content-data request for an uncached ordinary article navigation. Never request data per paragraph, section, internal link, relationship, or component.

### Catalog and Random Packs

- Resolve the article pack path deterministically from the immutable ID and build identity instead of shipping a complete client-side routing database.
- Emit small bounded random-selection packs containing only ID, current slug, and title.
- Use the same random index for the direct random action and home-page five-title list while keeping their UI behavior separate.
- Select uniformly across the complete corpus, prevent duplicates in one home list, and choose a new five-title list on each home entry.

### Cache Policy

- Version generated data and media paths for immutable CDN and browser caching.
- Reuse an already downloaded pack during navigation among documents in that pack.
- Allow low-priority prefetch only after the current article is usable.
- Cache graph tiles viewed during panning and retain them when browser Back restores graph state.

## Design-System Implementation

Implement the `01-foundation.md` design contract from repository-root `DESIGN.md`:

- Self-host the selected Korean-capable variable font and use the documented fallback stack.
- Define CSS custom properties for referenced colors, spacing, radii, type roles, content widths, focus rings, and graph surfaces.
- Use a 64px light global header, approximately 1280px outer container, 720–760px reading measure, and 220–240px desktop table-of-contents rail.
- Use 17px Korean article prose with approximately 1.75 line height while retaining the 14px utility role.
- Keep light routes editorial and flat; use hairlines and whitespace instead of generic elevated cards.
- Keep the graph on the dark observatory surface without gradients or generated cluster labels.
- Scope every custom navigation-board theme to its board root and keep accessibility and responsive behavior non-overridable.
- Do not implement decorative hover states. Provide focus, active, selected, loading, empty, and error states.
- Respect reduced motion and reduced graph effects.

## Article Experience

### Article Shell

- Render the current title and compiled XML body without an authored summary, visible aliases, tags, category, or type badge.
- Keep aliases in the search index only and tags in build-time scoring only.
- Render the article's dedicated graph link as navigation to `/graph?focus=<document-id>`; do not embed graph code or data.
- Render up to ten title-only related documents ordered by symmetric derived relationship score and passing the minimum threshold.
- Do not show relationship scores, source labels, summaries, media, or expansion beyond the ten-item maximum.

### Sections and Table of Contents

- Generate `1`, `1.1`, and deeper section numbers from nested XML and display them in headings and the table of contents.
- Keep anchor identity independent from generated numbers.
- Support optional stable section IDs for cross-document links and local generated anchors otherwise.
- Use a sticky desktop rail and a collapsed near-top mobile table of contents.
- Exclude navigation-board labels, captions, and footnotes from section numbering and the table of contents.

### References and Footnotes

- Compile `<ref href="doc:ID">required text</ref>` and `doc:ID#section-id` into the current internal route.
- Reject empty labels, self-closing references, missing targets, and title-, alias-, slug-, or public-URL shorthand.
- Number inline `<footnote>` elements automatically and generate the final notes section only when needed.
- Open footnote content in a click, touch, or keyboard preview popover before exposing the explicit jump-to-note action.
- Keep one preview open at a time, support `Escape` and outside dismissal, and preserve focus and return links.

## Navigation Boards

- Compile reusable boards from separate XML resources included with `<include-board ref="ID"/>`.
- Keep all boards and all sections collapsed on every initial article render.
- Keep the themed header and all section controls visible while their bodies are collapsed.
- Support a single general disclosure body and multi-section boards whose sections open independently and may remain open simultaneously.
- Provide restricted text links, labeled rows, tables, image grids, and named diagram-layout primitives.
- Make header, entry, and section images optional; text-and-link-only boards are valid.
- Allow a named code-defined visual theme and named code-defined diagram layout, never content-authored CSS.
- Preserve semantic order when a desktop diagram becomes a mobile list or horizontally scrollable table.
- Validate all board document targets, media, layout slots, group membership, missing includes, and cycles during compilation.

Board relationship groups produce internal strong undirected hub membership edges. The hubs are not visible nodes, categories, documents, or automatic entries in an article's related-document list.

## Media

- Accept repository-owned images only and reject arbitrary remote image URLs.
- Validate file existence, approved format, byte and dimension budgets, intrinsic dimensions, and Korean alternative text unless decorative.
- Open ordinary unlinked article figures in an accessible full-size modal with focus containment, visible close action, `Escape`, caption and alternative-text preservation, and background interaction disabled.
- Keep linked figures and navigation-board media as document-navigation actions rather than modal triggers.
- Accept size-bounded local video or typed allowlisted external-provider data; never accept arbitrary iframe markup.
- Disable autoplay. For external video, render a local poster and create the provider player and external requests only after explicit interaction.
- Provide controls, direct-link fallback, optional caption and poster, and Korean text tracks where meaningful audio conveys content.

## Search

- Use a dedicated `/search` page on the light editorial surface; do not use a search overlay.
- Keep `q` and numbered `page` in the URL.
- Update results live with debouncing, stale-work cancellation, and URL replacement during typing; use history entries for deliberate page changes.
- Search exact one-character titles and aliases only. Search complete bodies from two normalized characters onward.
- Rank exact title, exact alias, title or alias prefix and tolerated one-character typo, exact body phrase, then ordinary body-term matches.
- Show title plus an automatically selected and highlighted matching excerpt; no authored summary exists.
- Keep result order deterministic, paginate with numbered controls, and render explicit empty, loading, invalid-query, and index-load-failure states.
- Keep search execution in a worker when available and lazy-load search code and index shards only on the search route.

Pagefind custom records are the first implementation candidate. Benchmark it temporarily at the 100,000-document capacity target. If build time, Korean segmentation, transfer, memory, or query latency is unacceptable, remove the temporary benchmark corpus and Pagefind dependency and implement a deterministic sharded inverted index behind the same search interface.

## Relationships and Related Documents

### Graph Edges

- Inline links and optional manual connections produce strong undirected document-to-document edges.
- Board groups produce strong undirected document-to-hub membership edges without pairwise cliques.
- Sparse Korean content similarity produces bounded weak undirected document edges.
- Canonicalize endpoint order, deduplicate reciprocal or repeated evidence, remove self-edges, and let a strong edge replace a weak duplicate.
- Keep weak edges visible by default on the graph as lower-opacity thinner solid strokes and provide a control to hide them.

### Article Relationship Score

- Build a bounded candidate pool from direct authored connections, nearby graph topology, group-size-normalized board affinity, and sparse lexical similarity.
- Give direct inline and manual connections the dominant score contribution.
- Give shared board membership a smaller contribution that decreases as the group grows and never exceeds a direct connection.
- Use sparse lexical body similarity as low-confidence candidate discovery and fine adjustment.
- Use a shared hidden tag only as a small boost to an existing body-similarity candidate; tag overlap cannot create a candidate.
- Keep pair scores symmetric, then independently truncate each article to its top ten threshold-qualified results without forcing reciprocal list inclusion.
- Version the formula and deploy only final IDs, titles, routes, and integrity metadata; never expose scores in the UI.

Locally computed Korean embeddings remain an optional replacement for only the weak lexical component. Adopt them only if temporary evaluation on representative content demonstrates materially better relationship quality within the Vercel Hobby build budget. Embeddings and corpus vectors are never shipped to the browser.

## Dedicated Galaxy Graph

### Data Generation

- Generate stable hierarchical communities and spatial coordinates from the undirected graph.
- Weight strong edges above weak edges and shared-board hubs below direct authored document connections.
- Preserve previous positions as practical and version the clustering and layout algorithms.
- Emit separate distant, medium, and near graph tile families; aggregate community edges rather than materializing all underlying edges at distant zoom.
- Keep distant and medium clusters unnamed. Show actual titles only when real document nodes are visible.

### Runtime

- Load graph code and tiles only on the dedicated graph route.
- Open `/graph` at the distant whole-corpus view and `/graph?focus=ID` near the focused document.
- Use a WebGL 3D scene with stable depth coordinates and load only visible tiles plus a bounded adjacent buffer.
- Support damped pointer pan and continuous wheel zoom plus touch pan and pinch zoom.
- Crossfade adjacent semantic detail levels around their zoom boundaries so tile-family changes never snap the camera or blank the galaxy.
- Retain the full corpus hierarchy on mobile while lowering node, label, particle, and tile-buffer budgets.
- Use wheel, pinch, keyboard, or the explicit zoom controls to move between aggregate clusters and real documents; selecting a cluster never changes the camera.
- Select document nodes to open a compact title-only popover anchored to the node with one separate `Open article` action.
- Navigate to articles in the same tab by default while preserving native new-tab behavior.
- Save camera, zoom, selected node, and relevant controls in history state before article navigation; browser Back restores the exact graph view.
- Do not add graph-specific document search.

## Home, Random, and Failure States

- Make the home search input the primary action.
- Provide one deliberate dark-surface entry to the dedicated graph.
- Keep the direct random action separate from the five-title home list.
- Show no summaries, thumbnails, cards, recent items, popularity, view counts, analytics-driven modules, or curated entry list.
- Provide clear Korean states for unknown article IDs, invalid graph focus IDs, unavailable data packs, empty search results, and malformed URLs.
- Never expose raw compiler errors or repository paths to readers.

## Ordered Implementation Stages

1. Apply design tokens, font assets, global header, responsive shell, route structure, and light and dark surfaces.
2. Implement strict XML parsing, typed structural validation, semantic cross-reference validation, and safe HTML compilation.
3. Implement deterministic build identity, article packs, routing, caching, and missing-content handling.
4. Implement article prose, numbered sections, table of contents, internal references, footnotes, and related-document surface.
5. Implement reusable default-collapsed navigation boards, scoped themes, layout primitives, and relationship hubs.
6. Implement repository media validation, image modal, local video, and explicit-interaction external video.
7. Implement the random packs, direct random navigation, home five-title list, and search-first home composition.
8. Implement and benchmark the full-text search candidate, then retain Pagefind or replace it with the sharded index.
9. Implement strong and weak edge generation, versioned relationship scoring, and top-ten article ranking.
10. Implement hierarchical graph generation, tiled delivery, WebGL or Canvas runtime, node panel, focus entry, history restoration, and adaptive mobile rendering.
11. Complete Korean empty and failure states, keyboard and touch behavior, reduced motion, and responsive visual review.
12. Run the production build and temporary capacity checks, remove all temporary harness files and dependencies, then verify the deployed Vercel output.

## Acceptance Criteria

### Content and Safety

- Valid repository XML compiles deterministically without modifying source files.
- Invalid structure, duplicates, broken references, unsafe URLs, missing assets, board cycles, and unsafe SVG or embed content fail the production build with precise source diagnostics.
- Raw XML, build scratch databases, embeddings, and source paths are absent from deployed output.
- Adding or modifying ordinary knowledge requires only direct XML or asset changes in the codebase, not application code, unless a new board theme or named layout is intentionally introduced.

### Reading and Navigation

- Direct article URL loads, old slug loads, internal section links, random navigation, search-result navigation, graph-focused entry, and browser Back all resolve correctly.
- An uncached article navigation after the shell is cached targets one article-data request, excluding independently cached media and intentionally lazy oversized board bodies.
- Article pages do not load search workers, search indexes, graph runtime code, or graph tiles.
- Navigation boards start collapsed, keep headers and controls visible, allow multiple open sections, and reflow without losing semantic order.
- Related documents contain no more than ten title-only threshold-qualified links and expose no score or source category.

### Search

- Korean title, alias, spacing, one-character, body-term, and quoted-phrase behaviors match the agreed rules.
- Live input remains responsive, stale results never replace newer results, and query or page history behaves predictably.
- Search loads bounded shards rather than the complete corpus index for an ordinary query.

### Graph

- Distant, medium, and near zoom levels load bounded tiles and never transfer or render the complete raw graph at once.
- Strong and weak edges are visually distinguishable solid strokes, weak edges are visible by default and toggleable, and all stored document edges are undirected.
- Global and document-focused entries open the correct view, node selection never navigates immediately, and browser Back restores the previous graph state.
- Mobile retains full-corpus navigation with touch controls and adaptive density.

### Accessibility and Design

- Semantic headings, link labels, tables, figures, disclosures, dialogs, popovers, video controls, pagination, and status messages remain keyboard and screen-reader usable.
- Visible focus does not depend on hover; reduced motion disables nonessential graph motion and particles.
- Article, search, home, and graph surfaces follow `DESIGN.md` and the phase 1 design contract rather than a generic dashboard treatment.
- Navigation-board theme freedom never overrides focus visibility, text alternatives, logical order, touch targets, or mobile usability.

### Platform and Verification

- `npm run build` is the persistent verification command and succeeds with the final dependency set.
- Temporary representative-content generators, benchmark scripts, fixtures, test frameworks, and their dependencies are removed before phase completion.
- A temporary 100,000-document and 1,000,000-relationship capacity run records build time, generated artifact count and size, representative article-pack size, search transfer and latency, graph tile bounds, and peak browser memory for review without retaining a harness.
- The final deployment works on the linked Vercel Hobby project without an external runtime service or paid platform feature.

## Persistent Deliverables

- Design tokens, self-hosted font integration, and reusable responsive components
- Strict XML content model, validation pipeline, and safe semantic HTML compiler
- Deterministic build identity, article packs, random packs, board packs when required, and cache strategy
- Static application shell, Vercel route fallback, wiki routes, and read-only article renderer
- Default-collapsed reusable navigation boards, scoped theme registry, and restricted layout primitives
- Repository media manifest, image modal, local video support, and explicit-interaction external video
- Numbered table of contents, stable section links, internal-reference resolver, footnotes, and preview popovers
- Dedicated live-updating paginated search page with generated match excerpts and selected search index
- Strong and weak relationship generation, board hubs, versioned relationship score, and top-ten related-document lists
- Versioned hierarchical graph layout and tiles, dedicated graph runtime, node panel, history restoration, and adaptive mobile controls
- Home search, direct random action, five-title random list, missing and failure states
- Phase 3 authoring documentation
