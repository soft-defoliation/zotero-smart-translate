# Smart Translate for Zotero

AI-powered Zotero reading assistant with:
- 🔤 **Translation**: Multi-engine (OpenAI-compatible), streaming, auto failover, session caching
- 📑 **Title/Abstract to Item**: Translate title/abstract and persist to item Extra fields, with item-list columns
- 📝 **Summarization**: Map-reduce chapter summarization with glossary injection
- 💡 **Innovation Extraction**: Structured output with section evidence
- 🔬 **Method Structuring**: Ferroelectric schema (composition/synthesis/characterization/DFT/loading)
- 📚 **Reading Notes**: Auto-create child notes in Zotero
- 📤 **Export**: Bilingual Markdown export from multi-selected items

## Status

**Version**: 1.1.0  
**Zotero**: 7.0 – 10.*  
**Build**: ✅ `npm run build` → `.scaffold/build/smart-translate-for-zotero.xpi`  
**Tests**: ✅ 213 passing (`npm test`)  
**TypeScript**: ✅ `tsc --noEmit` clean

## Quick Start

### Install the released build

1. Download `smart-translate-for-zotero.xpi` from [GitHub Releases](https://github.com/soft-defoliation/zotero-smart-translate/releases) (the xpi asset is attached to the `v{version}` tag)
2. In Zotero: Tools → Plugins → gear icon (top-right) → "Install Plugin From File..." → pick the downloaded `.xpi`
3. Restart Zotero

### Automatic updates

The plugin ships an update manifest at
`https://github.com/soft-defoliation/zotero-smart-translate/releases/download/release/update.json`.
Zotero checks it automatically; to trigger a check manually: Tools → Plugins → gear icon → "Check for Updates".

### Build from source

```bash
# Install dependencies
npm install

# Build plugin
npm run build

# Run tests
npm test
```

## Features

### AI translation engine
- OpenAI-compatible endpoint adapter with SSE streaming
- 3 engine profiles with secret management; automatic failover with sticky switch (after 3 consecutive saves by a backup engine, that engine becomes the active one)
- Exponential backoff retry (429/1305/5xx)
- Chinese-dominant selections are auto-skipped (no request sent)

### Session-level caching
- Whole-segment LRU cache (100 entries): re-selecting the same text returns instantly with 0 requests
- Sentence-level memory (500 entries): multi-sentence text is translated sentence by sentence; repeated sentences across the session cost 0 requests

### Selection popup
- Streaming translation popup, modeled on T4Z's popup
- Copyable via a 3-level fallback copy path
- Drag-to-resize, size persisted across sessions
- Merge mode: concatenate selections across pages into one translation
- Double-click to copy the full translation

### Title / abstract translation (written to items)
- Right-click menu on items: "SmartTranslate: 翻译标题（写入条目）" / "SmartTranslate: 翻译摘要（写入条目）"
- Translations are persisted to the item Extra field as `titleTranslation` / `abstractTranslation`, in a line format interoperable with `zotero-plugin-toolkit` / T4Z (switching plugins does not lose data)
- Item-list custom columns "标题译文" (Title Translation) and "摘要译文" (Abstract Translation), enable them via the column picker

### Annotation write-back
- Translation results written back to annotations per settings: comment / bilingual / off

### Bilingual sidebar panel
- Item-side bilingual panel (toggle with `Alt+B` in the reader)
- Draggable divider; font family / font size / line-height settings
- Copy source / translation / all

### Reading assistant
- Full-text summary (map-reduce over sections), innovation extraction, method structuring (ferroelectric schema)
- Results are written to child notes

### Batch translate & export
- Multi-select items → bilingual Markdown written to a folder on disk

### Glossary
- Ferroelectric / high-pressure domain with 20+ seed terms injected into translation

### Shortcuts
- Global `Ctrl+Shift+T`: translate the selected item's title

## Project Structure

```
src/
├── index.ts                # Bootstrap entry
├── hooks.ts                # Lifecycle hooks (dispatch only)
├── data.ts                 # Translation orchestration: engine candidate chain + sticky failover
├── types.ts                # Shared interfaces
├── build/
│   └── update-manifest.ts  # update.json generation for releases
├── engine/
│   ├── gpt-service.ts      # OpenAI-compatible adapter + SSE streaming
│   ├── settings.ts         # 3-engine profiles + secretObj secrets
│   ├── retry.ts            # Exponential backoff (429/1305/5xx)
│   ├── errors.ts           # HTTP status → user-readable Chinese messages
│   ├── lang-detect.ts      # Chinese-dominance heuristic (auto-skip zh selections)
│   ├── cache.ts            # Session LRU cache (100 segments + 500 sentences)
│   ├── sentence-memory.ts  # Sentence split / numbered requests / assembly (pure functions)
│   ├── translate-store.ts  # Recent-translations store + panel registry (shared across bundles)
│   ├── extra-fields.ts     # Extra-field line format parse/serialize + item read/write
│   ├── glossary.ts         # Ferroelectric/high-pressure glossary
│   ├── term-memory.ts      # One-click add-to-glossary term memory
│   ├── batch.ts            # Concurrency-limited batch queue
│   └── export-md.ts        # Bilingual Markdown export
├── ui/
│   ├── reader.ts           # Selection popup + annotation write-back
│   ├── result-panel.ts     # Bottom-right floating result panel (menu/shortcut output)
│   ├── menus.ts            # Item menu (title/abstract → Extra) + Ctrl+Shift+T shortcut
│   ├── item-columns.ts     # Item-list columns: Title/Abstract Translation
│   ├── sidebar.ts          # Bilingual side panel
│   ├── shortcuts.ts        # Alt+B and other shortcuts
│   ├── reading-toolbar.ts  # Reading assistant toolbar
│   ├── reading-prefs.ts    # Reading assistant prefs window
│   └── panel/              # Sidebar section, dual-bundle architecture:
│       ├── smart-panel.ts     #   custom element class (shared by both bundles)
│       ├── custom-elements.ts #   panel bundle entry → content/scripts/panel.js (customElements.define lives here)
│       └── register.ts        #   main-bundle side: registerSection (bootstrap sandbox has no customElements)
├── reading/
│   ├── fulltext.ts         # Full-text acquisition (attachmentText + fallback)
│   ├── pipeline.ts         # Segmentation + prompts + parsing
│   ├── assistant.ts        # Reading orchestrator (map-reduce)
│   ├── notes.ts            # Zotero child note I/O
│   ├── batch-export.ts     # Multi-select items → bilingual Markdown to disk
│   └── progress-line.ts    # ProgressWindow progress-line factory
└── bootstrap.ts            # Stub so tsc resolves; real entry is index.ts
```

## License

AGPL-3.0 — see [LICENSE](LICENSE)

## Acknowledgments

Built on:
- [zotero-plugin-scaffold](https://github.com/zotero-plugin-dev/zotero-plugin-scaffold)
- [zotero-plugin-toolkit](https://github.com/zotero-plugin-dev/zotero-plugin-toolkit)

Translation and popup mechanics reference:
- [Translate for Zotero (T4Z)](https://github.com/windingwind/zotero-pdf-translate) (AGPL-3.0)
- [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template)
