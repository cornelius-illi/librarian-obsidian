# Librarian for Obsidian

Ein **LLM-gepflegtes Wiki** fuer Obsidian nach dem Muster von Karpathys [LLM-Wiki-Gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — aber mit der Disziplin, die ein rein gesprächsbasierter Agent nicht liefert: Allow-List-Wikilinks, Broken-Link-Reparatur und transaktionales "Vergessen".

Ersetzt den aufwendigeren [Zettelkasten Desktop](https://github.com/ciluiy/Zettelkasten-2Brain-) (Electron-App), indem es nur die drei Operationen beibehaelt, die wirklich Plugin-Orchestrierung brauchen. Alles andere — Graph, Markdown-Rendering, Frontmatter, Suche, Git — uebernehmen Obsidian und die vorhandenen Community-Plugins.

## Architektur

Drei Schichten, alle im Vault:

```
<vault>/
├── CLAUDE.md                           ← agent-kontrakt, schema, regeln
├── .claude/
│   └── skills/librarian/
│       ├── SKILL.md                    ← skill-einstieg fuer Claude Code
│       └── prompts/
│           ├── ingest.md
│           ├── query.md
│           ├── lint.md
│           ├── lint-fix.md
│           ├── lint-suggest.md
│           ├── forget.md
│           ├── takeaway-discuss.md
│           └── takeaway-synthesize.md
├── .obsidian/
│   └── plugins/
│       └── librarian/                  ← dieses Plugin
├── raw/                                ← immutable Quellen
└── wiki/
    ├── index.md
    ├── log.md
    ├── sources/
    ├── entities/
    ├── concepts/
    ├── syntheses/
    ├── sops/
    └── decisions/
```

- **Skill-Schicht** — Prompts + Schema liegen als Claude-Code-Skill im Vault. Jede Claude-Code-Session, die im Vault laeuft, laedt CLAUDE.md automatisch. Das deckt Query, Discuss, Lint-Suggest etc. vollstaendig ohne Plugin ab.
- **Plugin-Schicht** — Drei deterministische Kommandos: **Ingest source**, **Repair broken links**, **Forget source**. Diese drei brauchen Orchestrierung (Allow-Listen, Iterationen, Transaktionen) die konversationell nicht zuverlaessig ist.
- **Obsidian + Community-Plugins** — Graph, Rendering, Frontmatter-UI, Suche, Git, Marp, Import.

## Warum nicht einfach Obsidian + Claude Code?

Drei Dinge brechen leise im Vanilla-Setup:

1. **Wikilinks rotten.** Claude halluziniert plausible `[[Ziel]]`-Links ohne Allow-Liste. Nach 100 Quellen ist der Graph halb Broken Edges. Dieses Plugin haengt die aktuelle Seitenliste bei jedem Call mit und laeuft einen Reparatur-Loop fuer uebrig gebliebene Broken Links.
2. **Temporale Drift.** Ohne mechanische `status: seed → confirmed → stale`-Migrationen wird das Wiki zum flachen Durchschnitt von allem, was du je gelesen hast. Das Plugin erzwingt Lifecycle-Felder und aktualisiert sie automatisch im Lint.
3. **Forget ist nicht trivial.** Eine Quelle zu entfernen heisst: jede davon abgeleitete Aussage finden, Confidence runtersetzen, Orphans loeschen. Das ist keine Single-Prompt-Arbeit — das Plugin macht es transaktional.

Alles darueber (ad-hoc Fragen, Takeaway-Diskussion, Lint-Suggest) geht rein konversationell ueber Claude Code + die Skill-Dateien. Kein Plugin-Button noetig.

## Setup

### 1. Skill-Dateien in den Vault kopieren

```bash
cp -r vault-template/CLAUDE.md <vault>/
cp -r vault-template/.claude <vault>/
mkdir -p <vault>/raw <vault>/wiki
```

CLAUDE.md wird automatisch von Claude Code und von diesem Plugin geladen. Passe die Regeln (Taxonomie, Frontmatter-Lifecycle) bei Bedarf an dein Vault-Thema an — die Skill-Prompts referenzieren CLAUDE.md, nicht umgekehrt.

### 2. Plugin installieren

```bash
cd plugin/
npm install
npm run build
# main.js ist jetzt da. Kopiere das plugin-Verzeichnis nach <vault>/.obsidian/plugins/librarian/
```

Dann in Obsidian:
- **Settings → Community Plugins → Installed plugins** → Librarian aktivieren
- **Settings → Librarian** → Anthropic API-Key eintragen

### 3. Empfohlene Companion-Plugins

| Plugin | Wofuer |
|---|---|
| **Obsidian Git** | Automatische Commits nach jedem Librarian-Lauf |
| **Omnisearch** | BM25/Hybrid-Suche ueber das Wiki (das Plugin macht nur intern BM25 fuer Relevanz-Ranking) |
| **Dataview** | Dynamische Tabellen ueber `status`, `confidence`, `sources` Frontmatter |
| **Metadata Menu** | Strukturiertes Frontmatter-Editing |
| **Importer** / **Obsidian Web Clipper** | PDF/DOCX/HTML → Markdown |
| **Marp (community)** | Slide-Decks aus Wiki-Seiten rendern |

## Benutzung

Drei Commands im Command-Palette (⌘P):

- **Librarian: Ingest source** — liest neue Dateien aus `raw/` und baut Wiki-Seiten. Zeigt alle unverarbeiteten Quellen in einem Modal; deaktivier, was du nicht willst.
- **Librarian: Repair broken links** — scannt alle `[[Wikilinks]]`, findet die ohne Ziel, baut fehlende Seiten iterativ (bis zu 3 Durchlaeufe), macht nebenher mechanische Frontmatter-Fixes (`superseded_by` → `stale`, 2+ Quellen → `confirmed`).
- **Librarian: Forget source** — Dropdown einer Rohdatei, dann: betroffene Wiki-Seiten finden, per Claude-Redaktion ausschliesslich davon gestuetzte Fakten entfernen, Seiten mit nur dieser einen Quelle loeschen, Lifecycle zurueck auf `seed`/`low` wo sinnvoll.

Alles andere laeuft ueber Claude Code im Vault-Verzeichnis:

```bash
cd <vault>
claude "ingest raw/neuer-artikel.md"              # alternative zur Plugin-Ingest (weniger Guardrails)
claude "was weiss das wiki ueber X?"              # query
claude "diskutiere mit mir takeaway: ..."         # takeaway-discuss
claude "pruefe das wiki auf probleme"             # lint (diagnostisch)
claude "schlage mir fragen und synthesen vor"     # lint-suggest
```

Die Skill-Datei sagt Claude, welchen Prompt fuer welches Intent zu benutzen.

## End-to-End Smoke Test

1. Frisches Obsidian-Vault anlegen, Companion-Plugins installieren (Obsidian Git, Omnisearch, Dataview).
2. `vault-template/CLAUDE.md` und `vault-template/.claude/` ins Vault-Root kopieren. `raw/` und `wiki/` Ordner anlegen.
3. Plugin installieren und API-Key setzen.
4. Eine `.md`-Quelle in `raw/` legen. ⌘P → "Librarian: Ingest source".
   - Erwartet: 5-15 Seiten unter `wiki/{sources,entities,concepts,...}/`, `wiki/log.md` + `wiki/index.md` aktualisiert, Frontmatter mit `status`/`confidence`/`reviewed: false`, alle `[[links]]` loesen auf oder stehen als Stub in `wiki/.pending-stubs.json`.
5. Obsidian-Graph-View oeffnen → neue Knoten und Kanten sichtbar. Dataview-Query ueber `confidence`-Feld funktioniert.
6. Eine Seite oeffnen, manuell `[[Nichtexistent Ding]]` einfuegen. ⌘P → "Librarian: Repair broken links" → neue Stub-Seite unter `wiki/concepts/nichtexistent-ding.md`.
7. ⌘P → "Librarian: Forget source", Datei aus Dropdown waehlen → Pages mit nur dieser Quelle geloescht, Multi-Source-Seiten aktualisiert.
8. Obsidian Git committet alles automatisch.
9. `claude "fasse zusammen was du ueber X weisst"` im Vault-Verzeichnis → nutzt das Skill, zieht aus `wiki/`, zitiert `[[Seiten]]`.

## Migration von Zettelkasten Desktop

Wenn du aus der Electron-App kommst:

- Dein bisheriger Projekt-Ordner **ist bereits** ein kompatibles Vault. `raw/` und `wiki/` bleiben, `output/` ignoriert das Plugin (fuer's erste).
- `.brain/config.json` ist obsolet — die relevanten Einstellungen landen in den Plugin-Settings.
- `wiki/.pending-stubs.json`, `wiki/.wikilinks.json`, `wiki/log.md` — identisches Format, kein Migrationsschritt noetig.
- Multi-Projekt: Obsidian = ein Vault. Fuer mehrere Wissensbasen mehrere Vaults oeffnen.

## Lizenz

Apache 2.0. Prompts und CLAUDE.md-Schema sind aus dem Zettelkasten-Desktop-Projekt portiert und bleiben unter der gleichen Lizenz.
