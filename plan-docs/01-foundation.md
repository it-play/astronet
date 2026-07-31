# Phase 1: Foundation

## Goal

Define enough product, design, and technical structure that implementation can proceed without inventing requirements during development.

## Product Definition

The core experience is reading interconnected worldbuilding articles. The graph is an alternate discovery surface, not a replacement for article navigation.

### Scale Target

The initial corpus will be small, but the product must not be architecturally bounded to a small wiki. Planning uses at least 100,000 documents and 1,000,000 relationship edges as a concrete capacity envelope.

This target rules out shipping the complete graph to every browser, scanning the full XML corpus during a page request, and placing every source document in a single directory. Graph exploration and derived indexes must support bounded partitions or neighborhoods.

### Required Experiences

- Open a wiki article at a stable URL.
- Follow an inline link from one article to another.
- See meaningful article metadata and related knowledge.
- Open a graph visualization of connected knowledge.
- Navigate from a graph node to its article.
- Open a uniformly selected random article.
- Search titles, aliases, and complete article bodies.
- Open an article directly from a search result.
- Render correctly on mobile, tablet, and desktop.
- Return a clear not-found page for unknown article URLs.

### Explicitly Out of Scope

- Browser-based editing
- Content create, update, or delete APIs and server actions
- An application editor or source-mutating authoring utility
- User accounts and permissions
- Comments, reactions, and social features
- Revision history in the application
- A database-backed CMS
- Content writing during phases 1 and 2

## Information Architecture Contract

### Global Navigation

- Site identity and home link
- Knowledge graph entry point
- Full-text search entry point
- Random article action

### Article Page

- Article title
- XML-authored article body
- Automatically generated table of contents
- Inline internal links
- Unified related-documents section
- Link to the dedicated graph page focused on the current document

### Graph Page

- A dedicated route that is never embedded into an article page
- No graph-specific document search input
- Knowledge nodes and relationship edges
- A way to inspect or identify a node
- A compact title-only popover anchored to the selected node with one article-navigation action
- Clear solid strong edges and lower-contrast solid weak edges
- A control for hiding or showing weak edges
- Galaxy-like pan and continuous camera zoom across the complete corpus
- Corpus-wide touch navigation on small screens with adaptive density and effects

The global graph entry opens the dedicated page at the whole-corpus view. An article's graph action navigates to the same dedicated page centered and zoomed on that document. The focus document identifier is represented in the graph URL; it does not cause graph code or graph metadata tiles to load on the article route.

Targeted document discovery remains the responsibility of the dedicated site search. The graph page focuses on spatial exploration and document-focused entry rather than duplicating the search interface.

### Home Page

- Present full-text search as the primary corpus entry point.
- Provide a prominent entry into the galaxy graph.
- Provide random-article navigation.
- Show a small title-only list of random document links.
- Do not show recent articles, popular articles, view counts, or activity feeds.
- Do not collect analytics solely to rank or populate home-page content.
- Do not maintain a manually curated starting-document area.

Navigation boards are not home-page modules.

### Corpus Index

- Do not provide a complete alphabetical, chronological, or paginated document index.
- Use the dedicated search page as the general wiki entry point.
- Keep internal links, random discovery, and the graph as complementary navigation paths.
- Do not simulate a category directory through tags.

### Random Discovery

Random article navigation and the home-page random list are separate user-facing features.

Random article action:

- Select one document and navigate to it immediately.
- Do not show an intermediate preview or confirmation surface.

Home-page random list:

- Render a compact list view containing five document titles only.
- Link each title directly to its article.
- Do not show summaries, thumbnails, excerpts, or cards.
- Avoid duplicate documents within one list.
- Select a new list whenever the user enters the home page.
- Do not add a separate refresh or reroll control.

Shared implementation:

- Generate deterministic random-selection packs from the complete document catalog during content compilation.
- Let the browser select from a small pack without downloading the complete catalog.
- Include only the identifier, current slug, and title.
- Reuse the underlying random index while keeping the two interfaces and behaviors distinct.

## Design-System Application

The root `DESIGN.md` is the visual reference. Astronet should adapt its editorial qualities to a long-form wiki rather than reproduce its marketing-page composition literally.

### Initial Interpretation

- Use the white canvas, dark ink, restrained type weights, and generous whitespace as the reading foundation.
- Use the documented open-source Inter Display substitute unless a licensed Haas font is supplied.
- Use the 4px spacing scale and approximately 1280px outer container.
- Narrow the article reading column within the outer container for comfortable long-form reading.
- Use signature surfaces sparingly for graph, navigation, or contextual knowledge panels.
- Keep inline links visually distinct with the documented link color.
- Preserve the documented no-hover policy and provide visible focus and active states.
- Reassess the 14px body token for long-form reading before implementation; wiki prose may require a larger article-specific text role.

### Components to Define

- Global header
- Article layout and prose styles
- Responsive table of contents
- Inline internal link
- Compact title-only related-documents list
- Article metadata
- Collapsible navigation board
- Image figure and video player
- Graph canvas, node, edge, and node detail surface
- Random-article control
- Search input, search status, and result list
- Empty, missing, and invalid-content states

### Implementation Design Contract

Astronet has two deliberately different but related surfaces:

- **Editorial archive:** home, search, and article pages use the quiet white canvas, dark ink, hairline rules, and generous spacing from `DESIGN.md`.
- **Galaxy observatory:** the dedicated graph page uses the same type and control language on `{colors.surface-dark}`, with depth created by stable 3D coordinates, density, scale, and edges rather than a decorative gradient.

The transition between these surfaces is the product's signature. Article UI stays calm enough for long Korean reading; the graph spends the visual intensity in one place. Navigation-board themes may be expressive inside their scoped roots but do not redefine the surrounding archive.

Color contract:

- Use `{colors.canvas}`, `{colors.ink}`, `{colors.body}`, `{colors.muted}`, and `{colors.hairline}` for ordinary reading and search surfaces.
- Use `{colors.link}` only for navigable text and active link states, not as a general brand fill.
- Use `{colors.surface-dark}` and `{colors.surface-dark-elevated}` for the graph workspace and its elevated controls.
- Keep graph nodes monochrome white and edges neutral gray. Express communities, importance, and depth through density, scale, opacity, and stroke weight rather than node colors or a color legend.
- Do not add an atmospheric gradient, glow-heavy card system, or unrelated accent palette.

Typography contract:

- Use a repository-hosted Korean-capable grotesk variable font, with Pretendard Variable as the initial choice and the system stack as fallback.
- Use one family across article, search, navigation, and graph UI so Korean and Latin proper names share a stable texture.
- Keep display weights at 400 or 500 in the manner of `DESIGN.md`; do not use bold weight as the primary hierarchy mechanism.
- Set ordinary interface and metadata text near the documented 14px role, but define Korean long-form article prose at 17px with approximately 1.75 line height for sustained reading.
- Set the article title at approximately 40px on desktop and 32px on mobile, then derive section headings from the existing 32px, 24px, 20px, and 18px hierarchy.
- Use tabular numerals for generated section numbers, graph counts when needed internally, and search pagination.

Layout contract:

- Retain the approximately 1280px centered outer container and 4px spacing system.
- Keep the reading measure near 720–760px; do not stretch prose to the full outer container.
- On desktop, place the article and a 220–240px sticky table-of-contents rail in a balanced grid. On narrow layouts, collapse to one column and move the table of contents near the article beginning.
- Use the 64px white global header from `DESIGN.md` on light routes and retain the same header structure above the dark graph workspace.
- Let the graph canvas fill the remaining viewport below the header.
- Use hairline separation and whitespace for search results, related documents, tables, and footnotes instead of generic elevated cards.

Interaction contract:

- Follow the `DESIGN.md` no-hover policy: functionality must never depend on hover and no separate hover styling is required.
- Provide visible keyboard focus, pressed, selected, loading, disabled, and error states where those states exist.
- Reserve motion for disclosure, modal or popover appearance, and continuous graph camera zoom. Respect reduced motion by applying camera changes without interpolation.
- Keep all ordinary interactive targets at least 44px in both dimensions where layout permits.

Page composition:

- **Home:** search is the page thesis, followed by a single dark graph entry surface, the direct random action, and the five-title random list. Do not add a marketing hero, metrics, recent content, or promotional cards.
- **Article:** title, any included collapsed navigation boards, mobile table of contents when applicable, numbered body sections, generated notes, related documents, and the link to the dedicated graph page.
- **Search:** one prominent query field followed by a flat paginated result list with highlighted excerpts and explicit empty or loading states.
- **Graph:** a full dark workspace with minimal controls, unnamed aggregate galaxies, actual titles only on visible document nodes, and the node-anchored detail popover.

Before implementation, critique each component against this contract. Remove any treatment that could be reused unchanged in a generic SaaS dashboard, especially floating glass panels, gratuitous pills, gradients, generic statistic cards, or accent-heavy metadata chips.

## XML Content Model Contract

Every document uses one universal schema. The application does not define separate structures or required fields for characters, locations, events, organizations, or other worldbuilding concepts.

At minimum, every document is expected to need:

- An immutable unique identifier
- A title
- Optional aliases
- Optional free-form tags
- Structured article body content
- Internal references expressed by immutable identifier
- Optional manual document connections

Titles and generated slugs are not canonical relationship keys. This avoids breaking links when display names change.

Domain-specific facts belong in the article body rather than type-specific metadata fields or application-specific infobox schemas. The product has no category hierarchy. Optional tags do not change the document schema or renderer by document type.

Optional tags are authoring and build-time metadata only. Do not render them, expose them as article markup, create tag pages, or provide user-facing tag filters. Omit them from runtime page payloads unless a derived artifact has already consumed them.

Optional aliases are search-index metadata only. Do not render them on article pages, accept them as internal-link targets, or include them in ordinary article payloads; place reader-relevant alternate names in the body when needed.

### Document Identity and URLs

- Give every document an immutable, URL-safe identifier that is never derived from its title or slug.
- Use `/wiki/<document-id>/<korean-slug>` for article URLs.
- Resolve the document and its content shard exclusively from the identifier.
- Generate the current Korean slug deterministically from the normalized document title; do not require a slug field in XML.
- Treat the Korean slug as descriptive rather than canonical; an old or mismatched slug still resolves when the identifier is valid.
- Generate navigation and search-result links with the current slug.
- Reference internal links and manual connections by immutable document identifier in XML.
- Reject title-, alias-, and slug-based relationship targets during compilation.
- Return the missing-document experience when the identifier does not exist, regardless of the slug.
- Prefer a compact 128-bit URL-safe identifier; finalize its encoding as an authoring convention in the XML specification.

### Source File Layout

- Store exactly one document per XML source file.
- Derive the file path from a stable hash of the immutable document identifier.
- Split the hash across multiple directory levels so no source directory grows without bound.
- Require the file name and root document identifier to agree.
- Discover XML files recursively; do not maintain a manual master file list.
- Compile source files into deterministic size-bounded deployment packs.
- Do not copy raw source XML into the public deployment output.
- Keep source-file organization independent from public URL structure and deployment-pack boundaries.

### Body Authoring and Compilation

- Create, modify, rename, and delete knowledge only by directly changing XML and repository assets in the codebase.
- Keep the deployed application read-only and limit build tooling to source reading, validation, and derived-artifact generation.
- Never rewrite authored XML or assets as a side effect of validation or compilation.
- Allow only elements defined by the Astronet XML schema.
- Do not allow embedded raw HTML, scripts, event attributes, or arbitrary presentation markup.
- Keep authoring elements semantic and independent from CSS class names or design tokens.
- Validate nesting, attributes, internal targets, and external URLs during content compilation.
- Convert validated XML body content into safe semantic HTML before creating deployment packs.
- Deliver render-ready HTML rather than an XML parser and renderer in the browser bundle.
- Preserve enough structural metadata for headings, search excerpts, and internal-link graph extraction.

### Proposed Baseline Vocabulary

Block content:

- Nested sections with generated heading levels
- Paragraphs
- Ordered and unordered lists
- Block quotations
- Tables with header and body rows
- Figures with images, alternative text, and optional captions
- Video figures with poster images, controls, captions, and optional text tracks
- Default-collapsed single- and multi-section navigation boards with restricted link, table, grid, and named diagram layouts
- Footnotes and a generated note list
- Horizontal thematic breaks

Inline content:

- Emphasis and strong importance
- Internal document references by immutable identifier only
- Optional stable section targets on internal document references
- External links with validated URLs
- Footnote references
- Inline code or literal text when worldbuilding notation requires it

Presentation-only wrappers, custom styles, and arbitrary HTML are outside the vocabulary.

### Internal Reference Syntax

Body references follow XML-native semantics equivalent to Markdown's `[label](target)` form:

```xml
<ref href="doc:01...">다른 회사</ref>
<ref href="doc:01...#history">역사 문단</ref>
```

- Use the immutable document identifier after the `doc:` scheme; do not write a title, slug, or public article URL as the target.
- Append a stable section ID as a fragment when linking to a specific section.
- Require non-empty element text as the displayed link wording.
- Reject empty and self-closing internal references during compilation.
- Validate the document and section target during compilation, then emit the current public URL and safe anchor.
- Keep external web links separate with a validated external-link element rather than overloading internal document references.

### Footnotes

Footnotes are optional inline body elements:

```xml
<p>본문 내용<footnote>설명 또는 출처를 작성한다.</footnote></p>
```

- Number footnotes automatically in document order; authors do not write display numbers.
- Generate one notes section at the end of the article only when at least one footnote exists.
- Allow safe inline text, emphasis, internal references, and validated external links inside a footnote.
- Generate stable note anchors, accessible labels, and a return link to the originating marker.
- Open an accessible preview popover when a marker is selected instead of navigating immediately.
- Include a distinct `Go to note` action inside the popover and preserve the generated return link in the notes section.
- Render preview content from the already loaded article payload without another request.
- Support pointer, touch, and keyboard activation; close the popover with `Escape`, outside interaction, or a second activation and return focus predictably.
- Keep at most one footnote preview open at a time and do not rely on hover to expose it.
- Keep footnote markers and the generated notes section out of the table of contents and section numbering.
- Reject block layouts, navigation boards, media players, and arbitrary HTML inside footnotes.

### Table of Contents

- Generate the table of contents from nested XML sections; authors do not maintain a separate list.
- Generate hierarchical section numbers such as `1`, `1.1`, and `1.2`, and display them consistently in both article headings and table-of-contents entries.
- Keep generated numbers out of authored XML and out of permanent anchor identity so reordering sections does not break links.
- Permit an optional stable ID on a section so links can target that section from the same or another document.
- Generate a local fallback anchor when no stable ID is authored, but do not treat that fallback as a guaranteed permanent cross-document target.
- Exclude navigation boards, media captions, footnotes, and other non-section labels.
- Use a sticky side rail next to the reading column on desktop.
- Use a collapsible block near the article beginning on mobile and narrow layouts.
- Preserve nesting and provide accessible anchor navigation.
- Highlight the active section while reading when client performance permits.
- Omit the table of contents for documents without meaningful section structure.

### Navigation Board

The navigation board is Astronet's equivalent of a wiki navigation template. It is defined once as a separate XML resource and included near the beginning of related articles. It is not a category, article type, home-page module, or standalone knowledge document.

It supports:

- A persistent themed header with a title and optional logo, icon, or subtitle
- A single collapsible body or multiple named collapsible sections
- An accessible expand-and-collapse control for every collapsible body or section
- Restricted document-link lists, labeled rows, tables, media grids, and named diagram layouts
- Document entries with a required immutable target and optional label, image, icon, or design-token accent
- Text-only entries and mixed media-free or media-rich layouts
- A named, independently scoped visual theme

Images are never required for a valid board. The header may omit logos and icons, every document entry may be text-only, and an entire board may consist solely of section labels, tables, and document links. Repository asset rules apply only when an image is actually referenced.

Every board and section begins collapsed. Authors do not opt individual boards into an initially expanded state. The visible collapsed surface retains the board header and its section controls, matching the compact navigation-template behavior in the supplied examples.

A single-section board can expose one general expand-and-collapse row beneath its header, as in the pork board. A multi-section board can expose named controls such as `게임`, `기타 서비스`, and `행사`; opening a section inserts that section's content below its control while the other section controls remain available. Every section has independent state, multiple sections may remain open simultaneously, and opening one never collapses another.

The default renderers provide responsive link rows, tables, and grids. A board-specific theme may override grid placement, card proportions, row and column spans, colors, borders, radius, typography, header treatment, media treatment, and icon layout while preserving semantic order and mobile usability. Complex diagrams such as a meat-cut map use a named code-defined layout with XML-assigned semantic slots rather than inline CSS.

Conceptual XML shape:

```xml
<navigation-board id="01..." theme="publisher-services">
  <header logo="publisher-logo">
    <title>퍼블리셔 관련 문서</title>
  </header>
  <section id="games" label="게임">
    <document-grid layout="games">
      <document target="01..." image="game-logo">게임 이름</document>
    </document-grid>
  </section>
  <section id="other-services" label="기타 서비스">
    <document-grid layout="services">
      <document target="01..." image="service-logo">서비스 이름</document>
    </document-grid>
  </section>
  <section id="events" label="행사">
    <document-links>
      <document target="01...">행사 이름</document>
    </document-links>
  </section>
</navigation-board>
```

The final element and attribute names will be fixed by the XML schema.

An article may include multiple independent boards consecutively, as in a broad food board followed by a pork-specific board. This does not require one board to execute or arbitrarily transclude another board.

### Reuse and Theming

- Allow a navigation board to live in its own XML resource with an immutable board identifier.
- Include a reusable board from an article with a restricted element such as `<include-board ref="..."/>`.
- Expand board includes during content compilation.
- Reject missing boards, include cycles, and nested arbitrary transclusion.
- Do not create a general-purpose template language or executable content macros.
- Let each board select a named theme implemented in the application code.
- Scope custom theme styles to the selected board root so they cannot affect the article shell, other boards, or global navigation.
- Allow custom board themes to use a board-specific palette beyond the global signature colors when required by the content.
- Keep accessibility, collapse behavior, document order, focus visibility, and responsive usability mandatory regardless of theme.
- Keep all initial board and section states collapsed regardless of theme.
- Implement each section as an independent accessible disclosure control rather than an exclusive accordion.
- Do not permit inline CSS, `<style>` elements, or arbitrary CSS declarations inside content XML.

### Board Relationship Semantics

- Treat documents listed in the same navigation-board group as intentionally related authored knowledge.
- Derive the relationship from board membership, not from the fact that an article includes or renders the board.
- Do not connect an including article to every board member unless that article is itself declared as a board member or has another authored connection.
- Keep navigation-board membership and the article-level related-documents list independent: board membership alone does not add a document to that list.
- Permit the same document to appear in both a visible board and the related-documents list when its independently calculated relationship score qualifies it.
- Preserve board and group identifiers as relationship provenance.
- Allow one document to belong to multiple board groups.

Materializing every pair inside a group would create a quadratic clique. The recommended representation is a shared authored relationship hub or hyperedge: one board-group relationship connects to each member document while graph storage and layout remain bounded.

### Relationship Hub Representation

- Give every board group a stable relationship-hub identifier derived from the board and group identifiers.
- Connect the hub to each member document with one strong undirected membership edge.
- Do not materialize pairwise edges between every member.
- Keep the hub internal to generated relationship and layout data rather than rendering it as a visible node.
- Use shared hub membership as strong affinity during graph clustering and layout.
- Let graph clustering and local graph exploration resolve co-members from the hub without storing duplicate pairwise relations.
- Count relationship-hub membership edges separately when enforcing graph capacity budgets.

The relationship hub is an Astronet-specific derived graph optimization only. It does not change the navigation board's primary role as reusable article UI and does not turn the board into a visible graph node, wiki article, or home-page feature.

### Media Elements

Images and videos use semantic media references rather than raw HTML.

Image requirements:

- Repository asset identifier only; arbitrary remote URLs and runtime hotlinks are rejected
- Required Korean alternative text unless explicitly marked decorative
- Optional caption
- Optional internal document link
- Intrinsic dimensions recorded during compilation to prevent layout shift
- Lazy loading outside the initially visible article region

Ordinary article figures open the full-size repository asset in a modal image viewer. The viewer uses accessible dialog semantics, keeps keyboard focus inside while open, closes from a visible control or `Escape`, restores focus to the triggering image, preserves alternative text and captions, and prevents background interaction. Large images remain inspectable within the viewport without navigating away from the article.

An image explicitly linked to another document follows that link instead of opening the modal. Images inside navigation boards retain their board-defined document-navigation action and never trigger the article image viewer.

Video requirements:

- A size-bounded repository asset or an allowlisted external provider and video identifier
- Controls enabled and autoplay disabled
- Poster image where available
- Optional caption
- Korean caption track when speech or important audio conveys article information

Local video files are deployed with the application and validated for supported format and size. Exact byte and duration budgets will be set against Vercel Hobby deployment and transfer constraints.

External video embeds use typed provider data rather than author-supplied iframe markup or arbitrary embed HTML. Initially render only a repository-owned poster and controls; create the provider player and its network requests only after explicit pointer, touch, or keyboard activation. Viewport proximity alone never loads an external player. Include a direct-link fallback and follow a provider allowlist. Initial implementation should support only the providers actually used by content.

Media binaries remain separate from content packs so browsers and the CDN can cache them independently. The compiler validates references and emits only safe media markup.

All image binaries are versioned with the repository and deployed with the application. The compiler verifies that each referenced image exists, uses an approved format, remains within the configured dimensions and byte budget, and has stable intrinsic dimensions before emitting its deployment URL.

## Graph Edge Model

### Strong Edges

- Generate an undirected strong edge when one article links to another in its body.
- Treat an optional author-declared manual connection as a strong edge even when no inline link exists.
- Retain link origin only as provenance; it does not make the graph edge directional.
- Deduplicate repeated and reciprocal links into one canonical unordered document pair.
- Treat strong edges as authored knowledge, not similarity guesses.
- Do not require a manual connection block; it is an optional authoring tool.

### Weak Edges

- Generate undirected weak edges from content similarity during content compilation.
- Store only the final related document identifier, normalized score, and algorithm version.
- Do not deliver document embeddings or corpus-wide vectors to the browser.
- Apply a minimum confidence threshold and a small per-document neighbor limit.
- Prefer mutual nearest neighbors when practical to reduce noisy one-sided matches.
- Never treat a weak edge as an authored connection or an internal-link validation result.
- Use qualifying weak content-similarity data in graph exploration and as an input to article-level relationship scoring.
- Do not retain a weak edge when the same document pair already has a strong edge.

### Shared Edge Rules

- All strong and weak graph edges are undirected.
- Store each edge as one canonical unordered pair of immutable document identifiers.
- Strong edges take precedence over weak edges for the same pair.
- The content compiler removes self-edges and duplicate edges.

### Presentation

- Populate the article-level `Related Documents` list from the highest derived relationship scores rather than from a union of graph-edge sources.
- Give a direct inline or manual document-to-document connection a dominant score boost, but do not insert it unconditionally outside the ranking.
- Render the list as compact title-only links without provenance labels or visible relationship scores.
- Do not add thumbnails, cards, summaries, or generated excerpts to the article-level list.
- Keep navigation-board contents independent from this list and do not suppress a score-qualified item merely because it also appears in a board.
- Render both edge strengths as solid lines. Use lower opacity and a thinner stroke for weak edges.
- Provide a graph control to hide or show weak edges.
- Do not imply that a weak edge is canonical worldbuilding information.

### Similarity Algorithm Direction

Start with a deterministic sparse similarity baseline using normalized Korean terms, title and alias boosts, and body term weighting. Use approximate candidate selection rather than an all-pairs comparison at the target corpus size.

After body similarity produces a candidate, a shared hidden tag may apply a small bounded score boost. Tag overlap must never create a candidate or weak edge by itself, and tag data must not be shipped solely for this calculation.

Keep the generated weak-edge contract independent of the algorithm. If the baseline quality is insufficient, it may be replaced by locally computed Korean text embeddings and approximate nearest-neighbor search without changing XML or client data structures.

Only the bounded final weak-edge set is deployed. Capacity and quality budgets for generation will be validated against the Vercel Hobby build limit before the algorithm is finalized.

## Article Relationship Ranking

The article-level `Related Documents` list is a separate derived ranking rather than a rendering of graph edges.

- Build a bounded candidate pool from direct authored connections, nearby graph structure, navigation-board affinity, and sparse content-similarity candidates.
- Apply a dominant boost to direct inline and manual document-to-document connections because they are explicit authored evidence.
- Apply a smaller boost for shared navigation-board membership and decrease its pairwise influence as the group grows.
- Keep the board-membership contribution below a direct inline or manual connection at every group size.
- Treat sparse lexical body similarity as a low-confidence secondary signal used for candidate discovery and fine adjustment.
- Treat hidden-tag overlap only as the already defined small bounded boost after body similarity produces a candidate.
- Never let a lexical or hidden-tag match override clearly stronger authored relationship evidence by itself.
- Rank all candidates together and deploy only a small per-document result set; do not expose scores or source labels in the UI.
- Keep only the ten highest-scoring candidates that also pass the minimum relationship threshold.
- Do not pad the list when fewer than ten candidates qualify and do not provide an unbounded expansion control.
- Keep each pair's relationship score symmetric, consistent with the undirected relationship model.
- Truncate each document's ranked list independently; do not force reverse-list inclusion when one endpoint has ten stronger candidates.
- Keep the scoring formula and version in generated artifacts so it can be reproduced and recalibrated.

Locally generated embeddings remain an optional future replacement for the sparse content-similarity component only. They must demonstrate better Korean relationship quality on representative authored content before adoption and do not replace explicit authored evidence.

## Single-Model Galaxy Graph

The graph combines a corpus-wide overview with local document exploration. It renders every document node plus a compile-time-bounded representative edge set from one compressed overview buffer. Zoom must never replace, regroup, or crossfade the rendered geometry.

### Continuous Zoom

- Keep the same document points and edge segments mounted for the full lifetime of the graph route.
- Change only the camera framing and scale during wheel, pinch, keyboard, or explicit-control zoom.
- Load nearby title and link metadata only after sufficient magnification, without adding, removing, or repositioning graph geometry.
- Keep node click independent from camera motion; selection only opens the anchored title-and-action popover.

The graph renders as a WebGL 3D galaxy with stable depth coordinates and a populated spiral core rather than a flat Cartesian grid. Continuously damped zoom scales the one persistent model without a dataset boundary, geometry rebuild, or camera snap.

Selecting a document first opens a compact popover anchored to that node rather than navigating immediately. The popover shows the title without an authored summary and provides one `자세히 보기` action. It must work with pointer, touch, and keyboard selection without interfering with pan and zoom gestures.

The article action is an ordinary internal link that navigates in the same tab by default and retains native new-tab behavior. Before navigation, save the graph camera, zoom level, selected node, and relevant UI controls in browser history state. Returning with browser Back restores that state instead of resetting to an entry view; immutable tile caching prevents avoidable reloads.

### Layout and Clustering

- Generate stable spatial communities and coordinates during content compilation.
- Weight authored strong edges more heavily than generated weak edges during community detection and layout.
- Preserve existing positions as much as practical between content revisions to maintain the user's spatial memory.
- Store the layout and community-detection algorithm version with generated graph artifacts.
- Select a deterministic bounded overview edge set at compile time, prioritizing strong edges and endpoint coverage.

### Delivery and Rendering

- Emit one compact binary overview containing quantized 3D coordinates, display sizes, and a bounded fixed edge set.
- Load the overview once and keep its point and line buffers mounted; no zoom event rebuilds or substitutes graph geometry.
- Partition only document titles, links, and selection metadata into spatial tiles, loading visible tiles plus a small adjacent buffer.
- Cache immutable metadata tiles and avoid redundant requests while panning back to a viewed area.
- Render nodes and edges as one route-scoped WebGL 3D scene rather than one DOM or SVG element per node.
- Preserve the identical corpus-wide geometry on mobile while reducing label count, pixel ratio, and metadata-tile buffering according to performance budgets.
- Keep the fixed weak-edge buffer visible by default and toggle it directly without changing the strong-edge or node buffers.
- Load graph artifacts and graph runtime code only on the dedicated graph page; article pages contain neither an inline graph canvas nor a graph-neighborhood payload.

### Visual Treatment

- Keep article and search surfaces on the light editorial canvas defined by `DESIGN.md`.
- Use `{colors.surface-dark}` or `{colors.surface-dark-elevated}` for the dedicated graph workspace.
- Use `{colors.on-primary}` for primary graph labels and controls on the dark surface.
- Draw strong edges with a clearer solid stroke and weak edges with a lower-opacity, thinner solid stroke.
- Keep all visible graph nodes white and all graph edges gray. Distinguish communities through spatial grouping and density, and distinguish importance through node size, opacity, and edge weight.
- Keep the global navigation visually consistent with the article experience while the graph canvas occupies the remaining workspace.
- Create depth through stable 3D coordinates, node density, and scale rather than introducing an unrelated gradient palette.
- Provide clear keyboard focus, active, reduced-motion, and high-contrast behavior for graph controls.

## Self-Contained Data Architecture

### Confirmed Constraints

- XML is the canonical source of truth.
- The deployed application must not depend on an external database, search service, or content backend.
- Vercel Hobby is the permanent target platform.
- The design must not rely on paid Vercel features or paid platform integrations.
- Runtime content is read-only.
- Every optimized artifact must be reproducible from XML.

### Recommended Candidate

Use a build-time content compiler to produce two classes of artifact:

1. A compact embedded catalog containing identifiers, slugs, titles, shard locations, and only the relationship data needed for routing.
2. Immutable compressed shard families containing article bodies, graph tiles, and search data without coupling graph payloads to article packs.

SQLite is a candidate for the embedded catalog and build-time indexing. Large article bodies and the complete relationship graph should not be placed in a single runtime database file. They should be partitioned into bounded shards served as static assets from the same deployment. A request loads only the catalog and the shard needed for the current article or graph neighborhood.

This keeps deployment self-contained while avoiding an external service and a single oversized function bundle.

### Vercel Hobby Constraints

The architecture must continuously account for the current Vercel limits:

- A Node.js function bundle has a 250MB uncompressed limit.
- A CLI deployment accepts at most 15,000 source files.
- A Hobby CLI deployment accepts at most 100MB of source files.
- A deployment build has a 45-minute limit.
- Very large static output sets are allowed but can exceed the practical build-time budget.

These constraints rule out bundling the entire long-term corpus into one function and make one-output-file-per-article generation risky at the target scale.

### Platform Strategy

- Prefer static CDN assets over function-bundled content.
- Keep the number of source and generated files bounded by packing documents into deterministic shards.
- Keep any function code and embedded catalog small enough that corpus growth does not increase the function bundle without bound.
- Avoid a design that requires paid storage, paid databases, or a paid search service when the corpus grows.
- Treat build duration, deployment size, and data transfer as explicit capacity budgets.

### Rendering Strategy

- Serve a static application shell and render article bodies in the browser.
- Do not create one HTML output file per article.
- Do not require server rendering for search-engine indexing or JavaScript-free article access.
- Route all wiki article URLs to the same application shell, then resolve content from deterministic static data packs.
- Keep interactive graph code out of article and search route bundles and load it only on the dedicated graph page.

### Page Data Envelope

A document navigation should normally require no more than one content-data request after the application shell is available. The returned data pack must contain everything needed for the page's knowledge UI:

- Render-ready article body
- Title
- Resolved internal-link targets
- Unified related-document labels and routes
- Data version and integrity metadata

Large media assets remain separate so the browser can cache and load them independently. Page structure must not trigger a request per section, link, relationship, or component.

### Packing and Caching Direction

- Group multiple documents into deterministic, size-bounded packs rather than generating one data file per document.
- Target a bounded compressed pack size; finalize the byte budget after representative article sizes are known.
- Use content hashes or versioned pack names for immutable CDN and browser caching.
- Reuse a downloaded pack for navigation between documents in the same pack.
- Derive the content pack from the immutable document identifier so resolving a URL does not require loading a global document database.
- Allow optional low-priority prefetching only after the current article is usable.

## Full-Text Search

### Language

- Korean is the only application and content language.
- Use `ko` for the document language and search index.
- Normalize authored and queried Unicode text to NFC.
- Index Latin-script proper names and numbers when they occur inside Korean documents.
- Do not create language-prefixed routes, translation relationships, or parallel language indexes.
- Allow explicit Korean or Latin aliases for names when the XML schema defines aliases.

### Required Behavior

- Search every article body, not only titles or metadata.
- Present results on a dedicated search page rather than in an overlay.
- Store the query in the page URL so searches survive reload, browser history navigation, and sharing.
- Make global and home-page search inputs navigate to the dedicated results page.
- Update results continuously as the user types on the dedicated search page.
- Debounce rapid input, cancel or ignore stale work, and keep typing responsive while index shards load.
- Replace the query URL during live input rather than adding a browser-history entry for every keystroke.
- Show the document title and a short automatically selected matching excerpt for each result.
- Emphasize matched terms in the excerpt without altering the source article or requiring an authored summary.
- Clamp excerpt length and fall back to a compact body opening only when a title or alias match has no useful body match.
- Use numbered pagination for long result sets instead of infinite scrolling or a progressive load-more list.
- Store the current page in the URL alongside the query and reset it when the query changes.
- Add browser-history entries for deliberate page changes while using URL replacement for live query changes.
- Keep result ordering deterministic for a fixed content build and query so moving between pages does not reshuffle results.
- Boost title and alias matches above body-only matches.
- Support prefix matching and one-character typo tolerance for titles and aliases.
- Restrict a one-character query to exact title and alias matches.
- Enable complete body search only when the normalized query contains at least two characters.
- Normalize spacing variations for titles and aliases and absorb common Korean spacing differences where practical.
- Search body content by segmented full-text terms without arbitrary substring or typo matching.
- Treat a quoted query as an exact phrase search.
- Run entirely in the browser without an external search service.
- Load only the index shards needed for the current query.
- Keep search code out of the initial article bundle until the search interface is opened.
- Perform indexing during content compilation and keep the runtime index read-only.
- Keep expensive search work off the main UI thread when supported.

### Ranking Direction

Rank exact title matches first, followed by exact aliases, title or alias prefix and tolerated typo matches, exact body phrases, and then ordinary body-term matches. Final weights will be calibrated with representative Korean content during implementation.

### Pagefind Candidate

Pagefind is the initial search-engine candidate because its Node.js API can index custom records directly from the normalized XML document model. It generates a static, chunked browser index and uses a Web Worker by default.

Pagefind supports Korean word segmentation but does not provide Korean stemming. Search acceptance criteria must therefore distinguish exact token matches from optional spacing, prefix, substring, and typo-tolerant behavior.

Adoption remains conditional because the product capacity target exceeds Pagefind's stated focus on sites with tens of thousands of pages. During implementation, use generated representative content to measure:

- Index build time within the Vercel Hobby build budget
- Total and per-query compressed index transfer
- Browser memory use and query latency
- Korean segmentation quality
- Requests needed to render the first visible result set

If Pagefind cannot meet the agreed budgets at 100,000 documents, retain the same application search interface and replace the indexer with a custom deterministic sharded inverted index.

## Resolved Technical Direction

- Use a strict application-owned XML vocabulary with a typed structural validator and a second semantic cross-reference pass during the production build.
- Disable DTDs, external entities, network resolution, executable inclusions, raw HTML, and content-authored styling.
- Allow a reproducible temporary disk-backed compiler index when corpus-scale joins exceed practical memory; never deploy it or treat it as canonical content.
- Keep repository images local, validate and sanitize media during compilation, and load allowlisted external video only after explicit interaction.
- Support optional inline footnotes and validated external links without introducing a separate citation database or required bibliography schema.
- Use the detailed implementation and acceptance contract in `02-feature-implementation.md` for phase 2.

## Phase Exit Criteria

- All required features and non-goals are agreed.
- The design tokens and application-specific components are specified.
- The XML schema has examples and validation rules.
- Routing, indexing, and graph-loading strategies match the expected corpus size.
- Accessibility and responsive behavior are specified.
- Phase 2 work is ordered with acceptance criteria.
