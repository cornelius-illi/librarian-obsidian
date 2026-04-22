# Librarian Plugin

Claude-gestuetzter Bibliothekar fuer Obsidian — drei deterministische Kommandos, der Rest laeuft ueber die Skill-Datei im Vault oder direkt ueber Obsidian.

## Commands

| Command | Wofuer |
|---|---|
| **Librarian: Ingest source** | Liest Dateien aus `raw/`, generiert Wiki-Seiten mit Allow-List-Wikilinks. Unterstuetzt `.md`, `.txt`, `.csv`, `.json`, `.log`, `.html` und Bilder (JPG/PNG/GIF/WebP als Vision-Input). PDF/DOCX vorher mit Obsidian Importer o.ae. zu Markdown konvertieren. |
| **Librarian: Repair broken links** | Scannt alle `[[Links]]`, erstellt fehlende Zielseiten iterativ (bis zu 3 Durchlaeufe), macht mechanische Frontmatter-Fixes. |
| **Librarian: Forget source** | Entfernt Informationen einer Quelle aus allen betroffenen Seiten. Loescht Seiten die nur von dieser Quelle gestuetzt wurden. |

## Voraussetzungen

- `<vault>/CLAUDE.md` und `<vault>/.claude/skills/librarian/` — aus dem `vault-template/` des Hauptrepos kopiert.
- Anthropic API-Key (Settings → Librarian).

## Build

```bash
npm install
npm run build    # Produktionsbundle (main.js)
npm run dev      # Watch-Modus
```

Kopiere dann `main.js`, `manifest.json` und ggf. `styles.css` nach `<vault>/.obsidian/plugins/librarian/`.

## Settings

| Option | Default | Zweck |
|---|---|---|
| `apiKey` | — | Anthropic API-Key (wird aktuell in `data.json` plain gespeichert — Verschluesselung folgt) |
| `modelIngest` | `claude-sonnet-4-6` | Modell fuer Ingest |
| `modelLint` | `claude-sonnet-4-6` | Modell fuer Repair Broken Links |
| `modelQuery` | `claude-sonnet-4-6` | Platzhalter (keine native Query-Funktion im Plugin) |
| `rawDir` | `raw` | Vault-relativer Pfad der Rohquellen |
| `wikiDir` | `wiki` | Vault-relativer Pfad des Wikis |
| `maxContextChars` | 80000 | Zeichenbudget fuer bestehenden Wiki-Kontext pro Ingest-Call |
| `relevantPageLimit` | 12 | Top-N relevante Seiten via BM25 im Kontext |
| `maxPageAllowList` | 800 | Obergrenze Wikilink-Allow-List (Rest abgeschnitten) |

## Architektur

```
plugin/
├── manifest.json
├── main.ts                    ← Plugin-Einstieg, registriert Commands + Settings
├── src/
│   ├── commands/
│   │   ├── ingest.ts          ← Ingest-Pipeline
│   │   ├── repairLinks.ts     ← Broken-Link-Reparatur
│   │   └── forget.ts          ← Source-Redaktion
│   ├── core/
│   │   ├── vault.ts           ← LibrarianVault Adapter + Frontmatter + slugify
│   │   ├── claude.ts          ← Anthropic SDK Wrapper + JSON-Repair
│   │   ├── prompts.ts         ← Laedt CLAUDE.md + Skill-Prompt aus dem Vault
│   │   ├── wikilinks.ts       ← Wikilink Parser + Aliase
│   │   ├── keywords.ts        ← Stopword-Filterung + Tokenisierung
│   │   ├── search.ts          ← BM25-Ranking
│   │   ├── wiki-context.ts    ← Token-bounded Context-Builder
│   │   └── pathSafety.ts      ← Path-Traversal-Schutz
│   ├── settings.ts            ← PluginSettingsTab
│   └── ui/
│       ├── IngestModal.ts
│       └── ForgetModal.ts
└── esbuild.config.mjs
```

## Bekannte Grenzen (v0.1)

- API-Key plain gespeichert — nutze ein dediziertes Vault das nicht in einen oeffentlichen Remote gesynct wird, oder setz den Key als Env-Var beim Launch von Obsidian und trag ihn jedes Mal neu ein.
- Keine PDF/DOCX-Konvertierung im Plugin — lass das Obsidian Importer machen.
- Kein Progress-Sidebar — nur Notice-basierter Fortschritt.
- Keine native Query/Takeaway-UI — das laeuft ueber Claude Code im Vault-Verzeichnis, siehe `<vault>/.claude/skills/librarian/SKILL.md`.
- Multi-Projekt nicht unterstuetzt — Obsidian = ein Vault. Fuer mehrere Wissensbasen mehrere Vaults.

## Lizenz

Apache 2.0.
