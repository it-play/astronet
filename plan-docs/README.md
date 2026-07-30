# Astronet Planning

## Purpose

Astronet is a read-only worldbuilding wiki whose knowledge is maintained as XML in the codebase. Wiki articles are the primary experience. Internal links connect related articles, while a knowledge graph offers a secondary way to explore those relationships.

This directory is the planning source of truth and the approved baseline for phase 2 implementation. Implementation measurements may refine technical budgets without reopening confirmed product behavior.

## Delivery Phases

1. [Foundation](./01-foundation.md): define the design system application, information architecture, content model, and required features.
2. [Feature Implementation](./02-feature-implementation.md): implement the agreed content pipeline and user-facing features.
3. [Content Authoring](./03-content-authoring.md): write, validate, and expand the worldbuilding corpus.

## Confirmed Product Boundaries

- Astro is the application framework.
- The site is a wiki-style, read-only knowledge base.
- Knowledge is authored as XML and versioned with the source code.
- Articles can link to other articles.
- Related knowledge can be explored as a graph.
- Strong graph edges come from authored internal links or optional manual connections; weak graph edges are generated from content similarity.
- Every graph edge is undirected; link origin is retained only as provenance.
- Weak content-similarity data contributes to relationship scoring and the graph; only the graph exposes the strong-versus-weak edge distinction.
- Article pages use one compact title-only `Related Documents` list ranked by a derived relationship score, without cards, excerpts, media, provenance labels, or visible scores.
- Direct authored document-to-document connections receive a dominant relationship-score boost but still compete in the ranking rather than being inserted unconditionally.
- Shared navigation-board membership contributes a smaller group-size-normalized boost, so large boards do not dominate the related-document ranking.
- Sparse lexical body similarity is a low-confidence secondary signal for candidate discovery and fine adjustment, not the primary source of relationship truth.
- The article-level `Related Documents` list contains at most ten threshold-qualified documents and is never padded with low-quality candidates.
- Relationship scores are symmetric, but independently truncated top-ten article lists are not required to reciprocate every visible item.
- Categories do not exist. Tags and manual document connections are optional authoring tools.
- Optional tags are build-time metadata only: they are not rendered, exposed as markup, indexed as user-facing filters, or given tag pages.
- A shared hidden tag may slightly boost an existing body-similarity candidate but cannot create a weak edge by itself.
- Article URLs contain an immutable document ID followed by a human-readable Korean slug generated automatically from the current title.
- Each article is authored in one XML source file; deployment packs combine multiple compiled articles.
- Article bodies use a restricted semantic XML vocabulary; embedded raw HTML is not allowed.
- Article pages include an automatically generated responsive table of contents.
- Article headings and table-of-contents entries display generated hierarchical section numbers such as `1`, `1.1`, and `1.2`; authors do not write the numbers into XML.
- Internal links may target either an entire document or a stable section ID within a document.
- XML internal links and manual connections must store immutable document IDs; title, alias, and slug shorthand is not accepted.
- Body references use XML-native Markdown-like link semantics: `<ref href="doc:ID">required text</ref>`, with an optional stable section fragment; empty or self-closing references are invalid.
- Optional inline footnotes generate numbered references and a notes section at the end of the article.
- Selecting a footnote marker opens an accessible preview popover first, with a separate action to jump to the generated note.
- The XML vocabulary includes default-collapsed navigation boards and image and video media elements.
- Navigation boards are reusable XML resources and may reference independently scoped code-defined visual themes.
- Navigation boards are wiki-template-like blocks included near the top of related articles, not home-page modules or categories.
- A board keeps its themed header visible while collapsed and may contain either one collapsible body or multiple independently collapsible named sections.
- Multiple sections in the same board may remain expanded simultaneously; opening one never collapses another.
- Board sections support restricted link lists, tables, image grids, and named diagram layouts rather than one mandatory document-card grid.
- Images are optional at every board level; a text-and-link-only navigation board is fully valid.
- Documents listed together in a navigation-board group have an authored relationship even without inline cross-links.
- Each navigation-board group is a relationship hub connected to its members instead of materializing a member clique.
- Board relationship hubs exist only in derived graph data and do not change the visible wiki-template behavior.
- Navigation-board membership does not automatically populate an article's `Related Documents` list; a document may appear in both interfaces only when it independently qualifies for the related list.
- The home page does not show recent or popular content and requires no view analytics.
- The home page has no manually curated entries and shows five title-only random document links selected on each home entry.
- Video elements support both size-bounded repository assets and allowlisted external providers.
- Allowlisted external video players load only after explicit interaction with a local poster; viewport proximity alone never creates the external request.
- Article and navigation-board images must be repository-owned deployment assets; arbitrary remote-image hotlinks are not allowed.
- Selecting an ordinary article figure opens its full-size image in an accessible modal; navigation-board media and figures explicitly linked to documents preserve their navigation action instead.
- The graph uses galaxy-like semantic zoom: corpus clusters at distant zoom and real documents at close zoom.
- Distant and medium graph clusters have no generated semantic names; actual titles appear only when real document nodes become visible.
- The graph is always a dedicated page, never an embedded article widget; the global entry opens the whole-corpus view and an article entry opens the same page focused on that article.
- The dedicated graph page has no graph-specific document search; targeted discovery remains in the site search and document-focused graph entry.
- Mobile retains the complete corpus-wide galaxy graph with touch navigation while reducing visible density and decorative effects to fit device performance.
- Selecting a document node opens a compact title-only detail panel with separate actions to open the article or recenter the graph; it does not navigate immediately.
- Opening an article from the graph uses ordinary same-tab navigation, and browser Back restores the previous graph camera, zoom, and selection state.
- Article pages use the light editorial canvas; the graph uses a dedicated dark galaxy canvas.
- A random-article action is included.
- The deployed application provides read operations only; it has no content create, update, or delete UI, API, server action, editor, or CMS.
- Knowledge creation, modification, and deletion happen exclusively through direct changes to XML and assets in the codebase.
- Build tooling reads, validates, and compiles source content into derived artifacts but never rewrites authored XML.
- No external database, search service, or separately deployed content backend is required.
- A deployment must contain everything needed to serve the wiki.
- The application must remain deployable on the Vercel Hobby plan without paid platform services.
- Article bodies may require client-side JavaScript; search-engine indexing is not a product requirement.
- The site requires client-side full-text search across every article body.
- Search results use a dedicated page whose query is represented in the URL; global search inputs navigate to that page.
- Each search result shows its title and a short automatically generated excerpt with matched terms emphasized; authors do not maintain search summaries.
- Long search-result sets use numbered pagination, with the current query and page represented in the URL.
- The dedicated search page updates results continuously while the query is typed, using debouncing and stale-query cancellation.
- A one-character query matches exact titles and aliases only; queries of two or more characters may search complete article bodies.
- Documents do not have an authored summary field; search excerpts are generated from the body when needed.
- Optional aliases are search-index metadata only and are not rendered on article pages or accepted as internal-link targets.
- The site has no complete document index; wiki discovery relies on search, random selection, links, and the graph.
- All application UI and article content use Korean as the single supported language.
- Phase 3 content writing is not part of the current work.
- Visual decisions must refer to the repository root `DESIGN.md`.

## Planning Principles

- Keep article reading and navigation useful without the graph feature.
- Treat stable document identity separately from titles so articles can be renamed safely.
- Validate broken references and malformed content before deployment.
- Avoid sending the entire content corpus to the browser unless the selected feature requires it.
- Design the authoring format for a large corpus before writing production content.

## Confirmed Scale Direction

- The initial corpus may be small, but the architecture must target a very large corpus.
- Use at least 100,000 documents and 1,000,000 relationships as the initial engineering capacity envelope.
- Do not require rebuilding every article, loading every XML file, or transferring the full graph for ordinary reads.
- Partition source content and derived data so that growth does not create a single-directory or single-payload bottleneck.
- Runtime data is immutable and can be regenerated completely from XML.

## Interview Status

The structured product interview and technical-specification audit are complete. Phase 2 may begin from these documents.
