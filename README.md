# Smart Translate for Zotero

AI-powered Zotero reading assistant with:
- 🔤 **Translation**: Multi-engine (OpenAI-compatible), terminology lock, streaming
- 📝 **Summarization**: Map-reduce chapter summarization with glossary injection
- 💡 **Innovation Extraction**: Structured output with section evidence
- 🔬 **Method Structuring**: Ferroelectric schema (composition/synthesis/characterization/DFT/loading)
- 📚 **Reading Notes**: Auto-create child notes in Zotero
- 📤 **Export**: Bilingual Markdown export

## Status

**Version**: 0.1.0  
**Zotero**: 10.0.1  
**Build**: ✅ `npm run build` → `.scaffold/build/smart-translate-for-zotero.xpi`  
**Tests**: ✅ 26/26 passing  
**TypeScript**: ✅ `tsc --noEmit` clean

## Quick Start

```bash
# Install dependencies
npm install

# Build plugin
npm run build

# Run tests
npm test
```

## Project Structure

```
src/
├── engine/
│   ├── gpt-service.ts      # OpenAI-compatible adapter + SSE streaming
│   ├── settings.ts         # 3-engine profiles + secretObj secrets
│   ├── retry.ts            # Exponential backoff (429/1305/5xx)
│   ├── glossary.ts         # Ferroelectric/high-pressure glossary
│   ├── batch.ts            # Concurrency-limited batch queue
│   └── export-md.ts        # Bilingual Markdown export
├── ui/
│   ├── reader.ts           # Selection popup + annotation write-back
│   ├── menus.ts            # Item menu + Ctrl+Shift+T shortcut
│   ├── sidebar.ts          # Bilingual side panel
│   └── reading-toolbar.ts  # Reading assistant toolbar
├── reading/
│   ├── pipeline.ts         # Segmentation + prompts + parsing
│   ├── notes.ts            # Zotero child note I/O
│   └── assistant.ts        # Reading orchestrator
└── types.ts                # Shared interfaces
```

## Features Implemented

### P0-P3: Core Engine ✅
- OpenAI-compatible endpoint adapter with streaming
- 3 engine profiles with secret management
- Exponential backoff retry (429/1305/5xx)
- Ferroelectric glossary with 20+ seed terms
- Bilingual Markdown export

### P4: Reader UI ✅
- Selection popup with streaming translation
- Bilingual side panel (Alt+B toggle)
- Annotation write-back (comment/bilingual/off)
- Title/abstract translation (Ctrl+Shift+T)
- Reading toolbar with summary/innovation/method/note actions

### P5: Batch Processing ✅
- Concurrency-limited batch queue (max 2)
- Progress callbacks
- Cancel support
- Term memory (one-click add to glossary)

### P6: Reading Assistant ✅
- PDF section segmentation (heading heuristic)
- Map-reduce summarization
- Innovation extraction with evidence tracking
- Method extraction with ferroelectric schema
- Token budget check
- Zotero child note creation

### P7: Release & Docs ✅
- Release build with update.json manifest
- Coexistence test checklist
- Chinese user documentation
- AGPL-3.0 attribution

## License

AGPL-3.0 — see [LICENSE](LICENSE)

## Acknowledgments

Built on:
- [zotero-plugin-scaffold](https://github.com/zotero-plugin-dev/zotero-plugin-scaffold)
- [zotero-plugin-toolkit](https://github.com/zotero-plugin-dev/zotero-plugin-toolkit)
- [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template)
