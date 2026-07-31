# Astronet Content Sources

Astronet knowledge is authored only as repository XML and media. The deployed application is read-only and never changes these files.

## Identifier convention

Document and navigation-board identifiers are canonical unpadded base64url encodings of exactly 128 bits. They contain 22 characters from `A-Z`, `a-z`, `0-9`, `_`, and `-`; canonical 128-bit encodings end in `A`, `Q`, `g`, or `w`. An identifier is permanent and must never be regenerated from a title.

Generate identifiers outside the application with a cryptographically secure 16-byte random value and encode it as unpadded base64url. The compiler does not create or rewrite identifiers.

## Source paths

Each document and board is stored in one XML file. Compute the lowercase SHA-256 hex digest of the immutable identifier and use its first two characters as the directory name:

```text
content/documents/<sha256(id)[0:2]>/<id>.xml
content/boards/<sha256(id)[0:2]>/<id>.xml
content/media/<asset-id>.<extension>
```

The compiler discovers sources recursively. It rejects a file when its directory, file name, and root identifier disagree. Raw XML is never copied into `public` or `dist`.

## Document shape

See [`examples/document.xml`](./examples/document.xml) for the complete authoring shape and [`astronet.xsd`](./astronet.xsd) for the structural schema. Files under `examples/` demonstrate syntax and are not canonical knowledge or compiler inputs. The application compiler is authoritative for cross-file references, file paths, media safety, size limits, Unicode NFC, and application registries.

- `<title>` is required and contains Korean text.
- `<aliases>` and `<tags>` are optional build metadata. They are never rendered.
- `<connections>` contains optional strong relationships by immutable document ID.
- `<body>` accepts only the elements defined by the schema.
- Internal references use `<ref href="doc:ID">표시 문구</ref>` or `doc:ID#stable-section`.
- External links use `<external href="https://…">표시 문구</external>`.
- Section numbers and fallback anchors are generated. Authors may add a stable lowercase section `id` for cross-document links.
- `<footnote>` is inline, may contain safe emphasis and internal or external links, and cannot contain another footnote or block content.
- `<include-board ref="ID"/>` is the only reusable-content inclusion. General transclusion does not exist.

## Navigation boards

See [`examples/navigation-board.xml`](./examples/navigation-board.xml). A board has a registered application theme and either one general `<body>` disclosure or one or more independently collapsible `<section>` elements. Every disclosure begins collapsed. Header, section, and entry images are optional repository assets. Themes and named layouts must already exist in `src/content/board-registry.ts`; XML cannot define CSS.

Include a given board at most once in the same document. The compiler stores one shared board body per article pack and rejects duplicate inclusion that would create repeated control and anchor identifiers.

## Media

Media IDs use lowercase letters, digits, `_`, and `-`. Supported repository formats are PNG, JPEG, WebP, GIF, AVIF, sanitized SVG, MP4, WebM, and WebVTT.

Media IDs contain 2–64 characters, may begin with a lowercase letter or digit, and otherwise contain only lowercase letters, digits, `_`, and `-`.

- Non-decorative figures require Korean alternative text.
- Arbitrary remote images are rejected.
- SVG scripts, event handlers, `foreignObject`, embedded styles, and external resources are rejected.
- External video is limited to the allowlisted YouTube and Vimeo provider records, requires a local poster image, and is loaded only after reader interaction.
- Autoplay and authored iframe markup are not supported.

## Validation

`npm run build` runs structural parsing, semantic cross-reference validation, safe HTML compilation, relationship analysis, and artifact generation before Astro builds the site. A failure reports the source path and relevant element, attribute, or target. Validation never modifies authored XML or media.

## Agent-assisted authoring

Use `$author-astronet-knowledge` for factual creation, expansion, rename, merge, deletion, relationship integration, or contradiction repair. Its analysis subagents remain read-only; the primary curator asks for material canon decisions and applies the approved XML change as the single writer. Working claim states and agent reports are temporary and must not be added to canonical XML.

See [`../plan-docs/03-content-authoring.md`](../plan-docs/03-content-authoring.md) for the complete approval, compatibility, contradiction, and review workflow.
