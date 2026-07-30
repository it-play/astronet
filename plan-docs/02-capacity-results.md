# Phase 2 Capacity Result

Measured on 2026-07-31 with Node.js 23.11.0 on an arm64 macOS development machine. The temporary corpus and benchmark harness were removed after the run.

## Corpus and compiler

| Metric | Result |
| --- | ---: |
| Documents | 100,000 |
| Undirected relationships | 1,000,000 |
| Temporary XML generation | 5.169 s |
| Content compilation | 66.878 s |
| Peak compiler RSS | 4,227,203,072 bytes |
| Generated artifacts | 13,100 files |
| Generated artifact bytes | 628,091,042 bytes |
| Shared build manifest | 13,975 bytes |
| Median article pack | 25,684 bytes |
| Maximum article pack | 53,404 bytes |
| Graph tiles | 1,186 files |
| Median graph tile | 224,623 bytes |
| Maximum graph tile | 303,710 bytes |

The run used ten authored forward connections per document. That creates one million unique canonical strong edges without relying on weak similarity. The compiler was launched with an 8GB Node heap ceiling. Its peak RSS stayed below Vercel's documented 8GB build-container allocation, and the 67-second compile stayed well below the 45-minute build limit. The 628MB output and temporary source corpus also stayed well below the documented 23GB build disk allocation.

## Browser checks

The generated artifacts were served over loopback without compression. Heap figures use Chromium's `performance.memory.usedJSHeapSize`, so they are useful for relative capacity review rather than cross-browser guarantees.

| Scenario | Raw transfer | Local latency | Heap | Loaded scope |
| --- | ---: | ---: | ---: | --- |
| Very common body term | 7,247,782 bytes | 59.9 ms | 34,383,906 bytes | 35 assets, 100,000 matching postings, 20 result records |
| Focused near graph | 13,656,699 bytes | 49.0 ms | 61,174,583 bytes | 64 tiles, 6,009 nodes, 119,985 tile-edge records |

These are deliberately adverse raw-transfer measurements: the search term appears in every document, and the local server applies no gzip or Brotli compression. The production runtime additionally caps retained search assets, article packs, oversized board packs, random packs, and graph tiles so exploration cannot accumulate the complete corpus in browser memory.

## Platform notes

- Vercel Hobby build resources: <https://vercel.com/docs/plans/hobby>
- Vercel build and deployment limits: <https://vercel.com/docs/limits>
- Vercel build troubleshooting resource table: <https://vercel.com/docs/deployments/troubleshoot-a-build>

Vercel documents no upper limit for files produced during a build, although very large file counts increase build time. The 13,100 generated artifacts remain far below the documentation's 100,000-output-file caution point. Direct CLI source uploads have separate size and source-file-count limits, so a 100,000-source corpus should continue to use the linked Git build workflow rather than a CLI source upload.
