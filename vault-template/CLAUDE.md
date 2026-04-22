# Librarian Vault — Agent-Kontrakt

Dieses Obsidian-Vault ist ein LLM-gepflegtes Wiki nach dem Muster von Karpathy's "LLM Wiki" (https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). Der Mensch kuratiert Quellen und stellt Fragen. Der Agent (du) fuehrt die Bibliothekarsarbeit aus: lesen, zusammenfassen, verlinken, aktualisieren, widerlegen. Dieses Dokument ist das verbindliche Regelwerk fuer alle Agenten-Operationen.

Diese Datei wird automatisch mit jedem Claude-Code-Prompt in diesem Vault geladen. Prompts unter `.claude/skills/librarian/prompts/` verweisen auf dieses Dokument und fuegen nur operationsspezifische Regeln hinzu.

## Struktur

```
<vault>/
├── CLAUDE.md                 ← diese Datei (Schema)
├── .claude/skills/librarian/ ← operationsspezifische Prompts
├── raw/                      ← Quellen (immutable, niemals aendern)
└── wiki/                     ← vom Agenten gepflegt
    ├── index.md              ← Inhaltsverzeichnis
    ├── log.md                ← chronologischer Verlauf
    ├── sources/              ← eine Zusammenfassung pro Rohdatei
    ├── entities/             ← Personen, Organisationen, Produkte, Tools, Orte
    ├── concepts/             ← Ideen, Frameworks, Theorien, Muster, Methoden
    ├── syntheses/            ← Vergleiche, Querverbindungen, Analysen aus mehreren Quellen
    ├── sops/                 ← Standard Operating Procedures: wiederholbare Ablaeufe
    └── decisions/            ← Entscheidungen mit Kontext, Alternativen, Begruendung
```

## Taxonomie — wann welcher Typ

**Neue Seite NUR erstellen, wenn das Thema inhaltlich substanziell ist UND in eine dieser Kategorien passt:**

- `wiki/sources/` — genau eine Seite pro Rohdatei: Zusammenfassung, Kernaussagen, erwaehnte Entitaeten und Konzepte
- `wiki/entities/` — konkrete, benennbare Dinge: Personen, Organisationen, Produkte, Tools, Orte, Gesetze, Normen, Gremien
- `wiki/concepts/` — fachliche Ideen, Frameworks, Theorien, Muster, Methoden, Prozesse, Prinzipien
- `wiki/syntheses/` — Vergleiche, Querverbindungen, eigenstaendige Analysen aus mehreren Quellen. Nur wenn mindestens zwei bestehende Seiten substanziell verknuepft werden.
- `wiki/sops/` — wiederholbare Ablaeufe, Anleitungen, Checklisten ("so macht man X"). Nur wenn die Quelle wirklich einen Ablauf beschreibt, nicht nur erwaehnt.
- `wiki/decisions/` — Entscheidungen, Ergebnisse, Bewertungen: "wir haben X entschieden weil Y". Nur wenn die Quelle eine explizite Entscheidung dokumentiert — nicht bei reinen Fakten.

**KEINE Seiten erstellen fuer:**

- Allgemeine/generische Begriffe (Kommunikation, Qualitaet, Team, Erfolg, Wachstum, ...)
- Grammatische oder sprachliche Konstrukte (Pronomen, Anredeformen, Geschlechtsbezeichnungen, ...)
- Triviale Alltagswoerter ohne domaenenspezifisches Wissen
- Adjektive oder Eigenschaften ohne eigenen fachlichen Kontext

**Faustregel:** Wuerde man in einer Fachenzyklopaedie einen eigenen Eintrag dafuer anlegen? Wenn nein → keinen Knoten erstellen, nur im Text erwaehnen (als Fettdruck, nicht als Wikilink).

## Frontmatter (Pflicht auf jeder Seite)

```yaml
---
tags: [tag1, tag2]
sources: [quelldatei.md]
confidence: high | medium | low | uncertain
status: seed | confirmed | stale
reviewed: false
created: YYYY-MM-DD
updated: YYYY-MM-DD
superseded_by: [[neuere-seite]]   # optional
---
```

### Lifecycle-Regeln

- `status`:
  - `seed` — neue Seite mit nur einer Quelle
  - `confirmed` — Seite wird von mindestens zwei Quellen gestuetzt
  - `stale` — Information durch neuere Quelle explizit widerlegt oder ersetzt
- `confidence`:
  - `low` — nur eine Quelle, oder Quelle enthaelt vage Aussagen
  - `medium` — zwei oder mehr Quellen stuetzen den Fakt, oder eine sehr detaillierte Quelle
  - `high` — mehrere uebereinstimmende Quellen, spezifische und ueberpruefbare Fakten
  - `uncertain` — widerspruechliche Quellen, vage Formulierung, fehlender Kontext. Nutze das statt `low` wenn du wirklich zweifelst.
- `reviewed`: Immer `false` bei agent-generierten Seiten. NIEMALS selbst auf `true` setzen. Nur Menschen reviewen.
- `superseded_by`: Nur setzen wenn eine Seite eine bestehende komplett ersetzt. Auf der alten Seite `status: stale` setzen. Alte Seiten NICHT loeschen — nur als veraltet markieren.

### Aktualisierung bei jedem Update

- Pruefe ob `status` von `seed` auf `confirmed` hochgestuft werden kann (zweite Quelle hinzugekommen?).
- Pruefe ob `confidence` angepasst werden kann.
- `updated`-Datum setzen.
- `sources:`-Liste ergaenzen (niemals ueberschreiben).

## Link-Regeln (strikt)

Broken Wikilinks sind das groesste Scheiterrisiko dieses Patterns. Die Regeln sind bindend:

1. `[[Wikilinks]]` NUR auf:
   - (a) Seiten aus der "Allow-List" die im Kontext des jeweiligen Prompts uebergeben wird, ODER
   - (b) Seiten die du in der aktuellen Operation selbst erstellst.
2. Jede Erwaehnung einer Entitaet oder eines Konzepts, die bereits eine Seite hat (Allow-List), MUSS verlinkt werden.
3. Erwaehnungen von Begriffen die weder in der Allow-List stehen noch in dieser Operation erstellt werden → **Fettdruck** (`**Begriff**`), NIEMALS Wikilink. Sonst entstehen Broken Links.
4. Wikilink-Ziel MUSS exakt dem Seitennamen entsprechen (Gross/Kleinschreibung egal, aber keine Umformulierungen).

## Adversariale Vollstaendigkeit

Pflicht fuer `concepts/`, `syntheses/`, `decisions/` (optional fuer `entities/`, `sops/`):

Am Ende jeder inhaltlichen Seite, vor etwaigen Quellen-Listen, zwei Abschnitte:

```markdown
## Gegenargumente / Einwaende

- Konkreter Einwand 1 — wenn vorhanden mit Quelle
- ...

## Datenluecken

- Was wir aus dieser Quellenlage NICHT wissen, aber wissen muessten
- ...
```

Wenn keine Gegenargumente oder Luecken auffallen: explizit `- (Keine identifiziert)` schreiben, damit der Abschnitt existiert. Ziel: kein einziger Fakt bleibt unhinterfragt.

## Temporale Zuordnung

Jede Rohdatei hat ein Datum (aus Frontmatter, Dateiname, oder Kontext). Bei Widerspruechen gilt die NEUERE Quelle als aktueller Stand. Aeltere Fakten werden NICHT geloescht, sondern als "Stand per [Datum]" gekennzeichnet. Bei echten Ersetzungen: `superseded_by` + `status: stale` auf der alten Seite.

## index.md und log.md

- `index.md` — inhaltsorientierter Katalog. Jede Seite mit Link, einer Zeile Beschreibung und Kategorie. Bei jedem Ingest aktualisieren.
- `log.md` — chronologisch, append-only. Format: `## [YYYY-MM-DD] operation | Titel` — damit das Log mit `grep "^## \[" log.md | tail` scannbar bleibt. Ein Eintrag pro Ingest/Lint/Forget.

## Bilder als Quelle

Wenn die Quelle ein Bild ist (Foto, Screenshot, Diagramm, Infografik, Scan, handschriftliche Notiz):

- Beschreibe den Inhalt detailliert in der Quellen-Zusammenfassung
- Extrahiere alle erkennbaren Texte, Zahlen, Beschriftungen
- Bei Diagrammen: Erklaere die dargestellten Zusammenhaenge
- Bei handschriftlichen Notizen: Transkribiere so genau wie moeglich
- Erstelle Entitaeten und Konzepte wie bei Textquellen

## Mensch vs. Agent — klare Grenzen

- **Mensch entscheidet**: Quellen-Auswahl, Review-Entscheidung (`reviewed: true`), Loeschen von Seiten, Forget-Operation.
- **Agent entscheidet**: Seitennamen, Wikilinks (im Rahmen der Allow-List), Frontmatter-Werte (ausser `reviewed`), Taxonomie-Einordnung, Zusammenfassungen.
- **Agent beruehrt NIE**: `raw/` (Quellen sind immutable), `reviewed: true` auf fremden Seiten.
