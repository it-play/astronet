# Phase 3: Content Authoring

## Goal

Populate and maintain a large Korean worldbuilding corpus through direct codebase changes to XML and repository assets. Phase 3 begins only after the schema, compiler, reader, search, relationships, and graph from phase 2 are stable.

Astronet itself remains read-only. It provides no editor, write API, source-mutating command, automatic XML rewrite, or content-management workflow.

## Codebase Authoring Contract

- Store exactly one article per document XML file.
- Store reusable navigation boards in separate board XML files and include them by immutable board ID.
- Store every image, poster, local video, and text track as a repository asset.
- Create, update, rename, and delete knowledge by editing these files directly.
- Keep the XML schema universal. Characters, places, events, organizations, items, and other concepts do not receive separate schemas.
- Do not add categories, required tags, summaries, type-specific metadata, raw HTML, inline CSS, scripts, or executable templates.
- Run the normal production build after changes; build validation is the content integrity gate.

## Conceptual Article Shape

The final element names are fixed during phase 2, but ordinary articles follow this semantic shape:

```xml
<document id="01...">
  <title>문서 제목</title>

  <aliases>
    <alias>검색용 다른 이름</alias>
  </aliases>

  <tags>
    <tag>숨은 선택 태그</tag>
  </tags>

  <connections>
    <connection target="01..." />
  </connections>

  <body>
    <include-board ref="01..." />

    <section id="overview">
      <title>개요</title>
      <p>
        본문에서 <ref href="doc:01...">다른 문서</ref>를 참조하고
        필요하면 설명을<footnote>각주 내용.</footnote> 추가한다.
      </p>
    </section>
  </body>
</document>
```

Only `id`, `title`, and valid body structure are universally required. Aliases, tags, manual connections, navigation boards, stable section IDs, media, and footnotes are optional.

## Planned Authoring Workflow

1. Copy the documented article skeleton into the correct hash-sharded document directory.
2. Assign a valid unique immutable ID and keep the file name and root ID identical.
3. Write the Korean title; the build derives the current public slug from it.
4. Add only the optional aliases, hidden tags, and manual connections that are useful.
5. Write body content with the restricted semantic elements.
6. Use explicit non-empty labels for every `<ref href="doc:ID">label</ref>` body reference.
7. Add reusable boards by board ID and media by repository asset ID.
8. Run the production build and resolve every structural, reference, media, and graph validation error.
9. Review the rendered article, table of contents, popovers, boards, media, related documents, search result, and focused graph entry as applicable.
10. Commit the codebase content change.

## Identity and Rename Rules

- Never change a document ID after publication.
- Rename a document by changing only its title. The build generates the new slug and all generated links use it.
- Old or mismatched slug URLs continue to resolve because the ID is canonical.
- Add a search alias when a previous name or alternate spelling should remain discoverable.
- Do not use aliases as relationship targets; internal references and manual connections always use immutable IDs.
- Give a section a stable ID only when another location needs a durable direct link to it.
- Generated section numbers and fallback local anchors are not author-maintained identity.

## Link and Connection Rules

- Use `<ref href="doc:ID">visible wording</ref>` for body links.
- Add `#stable-section-id` after the target ID for a cross-document section link.
- Do not use title, alias, slug, or copied public URL shorthand in an internal reference.
- Do not use an empty or self-closing internal reference.
- Use a manual connection only when the relationship is intentional but does not belong naturally in the prose.
- Treat manual connections as undirected even though the XML declaration appears in one source document.
- Do not add a manual connection solely to force a particular related-document order; the derived score remains responsible for that list.

## Hidden Aliases and Tags

- Aliases exist only for search indexing and are not rendered on article pages or accepted as internal-link targets.
- Tags are optional build-time metadata and are not rendered, searchable as filters, or exposed through tag pages.
- A shared tag can only slightly boost an existing body-similarity candidate; it cannot create a relationship.
- Put reader-relevant alternate names and classifications in natural body prose rather than relying on hidden metadata.

## Navigation-Board Authoring

- Define a reusable board once and include it from any relevant article.
- Keep boards independent from article type, category, and the article-level related-document list.
- Use one collapsible body or multiple independently collapsible named sections.
- Assume every board and section starts collapsed; authors cannot set an initially open state.
- Use only the restricted link-list, labeled-row, table, image-grid, and named-diagram layout vocabulary.
- Images are optional in the header, sections, entries, and entire board.
- Select only a registered code-defined theme or named diagram layout; do not write CSS in XML.
- Declare relationship groups intentionally. Documents grouped together gain graph affinity, but the compiler stores a bounded hub rather than a pairwise clique.
- Avoid creating a custom theme or named layout when the existing restricted primitives express the content clearly.

## Media Authoring

- Add image files to repository media and reference their stable asset IDs.
- Do not hotlink remote images.
- Write meaningful Korean alternative text unless an image is truly decorative.
- Add captions only when they provide information not already clear from surrounding prose.
- Ordinary unlinked figures open in the full-size modal; figures with document targets navigate instead.
- Use repository local video only within the configured size and format limits.
- For allowlisted external video, provide typed provider data and a repository-owned poster; never paste iframe HTML.
- Do not request autoplay.
- Provide Korean captions or a text track when speech or important audio carries content.

## Footnotes and External Sources

- Use inline `<footnote>` only for supplementary explanation or source context that would interrupt the prose.
- Do not author display numbers or a manual notes section.
- Keep footnote content to safe inline elements, internal references, and validated external links.
- A separate bibliography or citation database is not required. An article may create an ordinary body section for sources when its content warrants one.

## Deletion and Merge Rules

- Before deleting a document, update or remove every internal reference, manual connection, board entry, and media relationship that targets it.
- The production build must fail while a deleted ID is still referenced.
- When merging two articles, retain the surviving document ID and update all references in code; aliases may preserve search discovery for the removed title.
- Do not implement runtime redirects between IDs. The codebase must express the surviving identity explicitly.
- Remove media only after all document and board references to its asset ID are gone.

## Large-Corpus Discipline

- Keep source files independent so an ordinary article edit does not rewrite unrelated XML.
- Keep document and board directories hash-sharded and avoid manual index files.
- Prefer reusable board resources over copying the same large board XML into many documents.
- Split an article when it becomes multiple independently useful concepts, not merely because a file reaches an arbitrary line count.
- Keep paragraphs and sections semantically focused so search excerpts and content-similarity signals remain meaningful.
- Use direct links and manual connections deliberately because authored graph evidence receives the largest relationship-score contribution.
- Review unusually large boards, media, or articles against pack and Vercel Hobby budgets before expanding them further.

## Authoring Documentation Deliverables

- Final XML vocabulary and nesting reference
- Article and navigation-board skeletons
- Immutable ID, file path, title, and automatic slug conventions
- Korean NFC normalization and prose guidance
- Section, table-of-contents, reference, external-link, and footnote syntax
- Optional alias, hidden-tag, and manual-connection rules
- Board inclusion, grouping, theme, layout, and responsive guidance
- Repository media structure, alternative text, captions, posters, text tracks, and size limits
- Validation-error guide with source-path and target examples
- Rename, deletion, merge, and broken-reference checklist
- Content review checklist for article, search, related-document, and graph behavior

Production content writing is intentionally outside phases 1 and 2.
