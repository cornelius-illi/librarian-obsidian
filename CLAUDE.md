# Librarian for Obsidian — Project Contract

Two deliverables live in this repo. Keep them cleanly separated when editing:

1. **`vault-template/`** — a Claude-Code skill + `CLAUDE.md` schema that the end-user copies into their Obsidian vault. This runs *inside an agent session against a user's vault*. See `vault-template/CLAUDE.md` (different file, different audience — do not confuse with this one).
2. **`plugin/`** — the Obsidian plugin. This runs *in Obsidian's renderer* and provides three deterministic commands: Ingest, Repair Broken Links, Forget.

This file (`./CLAUDE.md`) is the contract for working **on the source code** of both deliverables. The vault-template's `CLAUDE.md` is the runtime contract for an agent editing a user's wiki — do not merge the two.

## Origin

Ported from the Electron app at `/Users/cornelius/dev/Zettelkasten-2Brain-`. About 30 % of that codebase (IPC plumbing) was dropped; the pure TypeScript core was copied over and rewired from Node `fs/promises` to Obsidian's `app.vault.adapter`. Karpathy's [LLM-Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) is the conceptual source; this repo is one disciplined instantiation.

## Structure

```
librarian-obsidian/
├── CLAUDE.md                              ← this file (source-code contract)
├── README.md                              ← user-facing overview
├── vault-template/                        ← deliverable 1 — copied into user vaults
│   ├── CLAUDE.md                          ← schema the agent follows when editing a wiki
│   └── .claude/skills/librarian/
│       ├── SKILL.md
│       └── prompts/
│           ├── ingest.md
│           ├── query.md
│           ├── lint.md
│           ├── lint-fix.md
│           ├── lint-suggest.md
│           ├── forget.md
│           ├── takeaway-discuss.md
│           └── takeaway-synthesize.md
└── plugin/                                ← deliverable 2 — Obsidian plugin
    ├── manifest.json
    ├── main.ts                            ← entry, registers commands + settings
    ├── src/
    │   ├── commands/{ingest,repairLinks,forget}.ts
    │   ├── core/                          ← ported from old Electron app's src/main/core/
    │   │   ├── vault.ts                   ← LibrarianVault wraps app.vault.adapter
    │   │   ├── claude.ts                  ← Anthropic SDK wrapper (JSON repair, streaming)
    │   │   ├── prompts.ts                 ← loads vault's CLAUDE.md + skill prompt
    │   │   ├── wikilinks.ts               ← [[…]] parser + alias generation
    │   │   ├── keywords.ts                ← stopwords + tokenize
    │   │   ├── search.ts                  ← BM25 ranking (no persistent index)
    │   │   ├── wiki-context.ts            ← char-bounded context builder
    │   │   └── pathSafety.ts              ← path-traversal guard
    │   ├── settings.ts                    ← PluginSettingTab + defaults
    │   └── ui/{IngestModal,ForgetModal}.ts
    ├── esbuild.config.mjs
    ├── tsconfig.json
    └── package.json
```

## Commands (run in `plugin/`)

- `npm install` — install deps
- `npm run dev` — esbuild watch mode (writes `main.js`)
- `npm run build` — `tsc --noEmit` + production esbuild → `main.js`
- `npx tsc --noEmit` — type-check only

There are no tests yet; verification is a manual smoke test against a real vault (see `README.md`). If you add tests, put them under `plugin/src/**/*.test.ts` and run with Vitest.

## Conventions

- **TypeScript strict mode.** No `any` without justification. No default exports (except where Obsidian's plugin API mandates — see `main.ts`'s `export default class LibrarianPlugin`).
- **Tabs for indentation** (follow existing files — Obsidian's own template uses tabs).
- **German for user-facing strings** (Notice messages, modal titles, prompt content). Umlauts as `ae/oe/ue` — not `ä/ö/ü`. Technical identifiers stay English.
- **IPC / Electron-specific patterns are forbidden.** This is a single-process plugin. No `ipcMain`, no `BrowserWindow`, no `contextBridge`, no `safeStorage`. Where the old Electron app had these, the port collapses them into direct function calls.
- **File I/O goes through `app.vault.adapter`** (read/write/exists/remove/list/mkdir/writeBinary/readBinary/stat). Never `import 'fs'` or `fs/promises`. The one exception: `path.posix` from Node's `path` for pure path math in `core/pathSafety.ts`.
- **Prompts live as markdown in `vault-template/.claude/skills/librarian/prompts/`.** The plugin loads them from the user's vault at runtime via `core/prompts.ts::loadSystemPrompt`. Do not inline prompt text in TypeScript — if you need a new prompt, add a new file and extend the `PromptName` union.
- **Every Claude-authored wiki page has `reviewed: false`.** Code that writes pages must preserve this. Only a human sets it to `true`.
- **Wikilink allow-list is non-negotiable.** Any new command that calls Claude to produce markdown must pass an allow-list of real page IDs in the prompt and the prompt must forbid invented links. See `src/commands/ingest.ts::allowListText`.

## Working with the two `CLAUDE.md` files

- Editing prompt behavior, schema, taxonomy rules, frontmatter lifecycle → touch `vault-template/CLAUDE.md` and/or `vault-template/.claude/skills/librarian/prompts/*.md`.
- Editing plugin code, TypeScript, build config, UI → stay in `plugin/`.
- If a schema rule needs enforcement code, it lives in both places: the rule in `vault-template/CLAUDE.md` (so Claude respects it) **and** a mechanical check in the plugin (so silent drift can't pass). Example: the `superseded_by → status: stale` rule is stated in `CLAUDE.md` and enforced mechanically in `repairLinks.ts`'s frontmatter pass.

## Migration notes (if pulling from the old Electron app)

- `src/main/core/` → `plugin/src/core/` (with `fs` → adapter rewrites)
- `src/main/ipc/*.ipc.ts` → `plugin/src/commands/*.ts` (IPC shell removed, logic inlined)
- `src/main/core/prompts/index.ts` → `vault-template/.claude/skills/librarian/prompts/*.md`
- `src/main/core/search-index.ts` → dropped. In-memory BM25 on every call is fine for vaults up to a few hundred pages.
- `src/main/services/convert.service.ts` → dropped. Users install Obsidian Importer instead.
- `src/main/services/git.service.ts` → dropped. Users install Obsidian Git.
- `src/renderer/` → dropped entirely. Obsidian is the UI.

## Known v0.1 limits (if you plan to extend)

- API key is plaintext in `.obsidian/plugins/librarian/data.json`. Upgrading to AES-GCM via Web Crypto + device-bound salt is a natural first hardening step.
- No PDF/DOCX ingest in-plugin. If you add it, prefer shelling out to `pandoc` via `child_process` on desktop rather than bundling `mammoth`/`pdf-parse` (keeps the plugin small and avoids native-module headaches in Obsidian's bundler).
- No progress-sidebar `ItemView`. Notices only. If ingests grow to >10 files routinely, build a `ProgressView` under `src/ui/`.
- No query/takeaway UI in the plugin. These work via Claude Code against the vault. Only add plugin UI for them if the conversational flow proves insufficient.

## References

- Karpathy LLM-Wiki gist: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
- Obsidian plugin API: https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin
- Anthropic SDK (TS): https://github.com/anthropics/anthropic-sdk-typescript
- Original Electron app: `/Users/cornelius/dev/Zettelkasten-2Brain-`
