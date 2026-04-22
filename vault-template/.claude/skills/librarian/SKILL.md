---
name: librarian
description: Bibliothekar fuer ein LLM-gepflegtes Obsidian-Wiki. Verarbeitet Rohquellen aus raw/ zu strukturierten Wiki-Seiten unter wiki/, antwortet auf Fragen mit Zitaten, prueft das Wiki auf Broken Links und veraltete Inhalte, loescht Informationen aus einer Quelle (Forget), und diskutiert Takeaways als Sparringspartner. Verwendet ein festes Schema (siehe CLAUDE.md im Vault-Root) mit Frontmatter-Lifecycle (seed/confirmed/stale), Konfidenzstufen (low/medium/high/uncertain) und strikten Wikilink-Allow-Lists. Trigger, wenn der Nutzer eine Rohdatei verarbeiten moechte, das Wiki durchsuchen, Seiten reparieren, eine Quelle vergessen, oder einen Takeaway durchdenken will.
---

# Librarian Skill — Operations

Dieses Skill ist die Bedienungsanleitung fuer den Bibliothekar-Modus. Das geteilte Schema steht in `CLAUDE.md` im Vault-Root — lies es einmal, dann folge hier den operations-spezifischen Prompts.

## Operationen und ihre Prompts

| Trigger / Nutzer-Intent | Prompt-Datei |
|---|---|
| "Lies diese Quelle", "Ingest raw/X", "verarbeite diese Datei" | `prompts/ingest.md` |
| "Frage ans Wiki", "was weiss das Wiki ueber X" | `prompts/query.md` |
| "Pruefe das Wiki", "Gesundheitscheck", "finde Probleme" | `prompts/lint.md` |
| "Repariere Broken Links", "fehlende Seiten erstellen" | `prompts/lint-fix.md` |
| "Schlage mir Fragen / Luecken / Synthesen vor" | `prompts/lint-suggest.md` |
| "Vergiss Quelle X", "entferne Informationen aus Y" | `prompts/forget.md` |
| "Diskutiere diesen Takeaway", "was haeltst du davon" | `prompts/takeaway-discuss.md` |
| "Mach daraus eine Synthese-Seite" | `prompts/takeaway-synthesize.md` |

## Kontrakt

1. **Immer CLAUDE.md lesen, bevor du eine Wiki-Seite erstellst oder aenderst.** Das Schema ist bindend.
2. **Wikilinks nur innerhalb der Allow-List.** Die Allow-List ist die Liste existierender Wiki-Seiten plus Seiten die du in derselben Operation erstellst. Alles andere = Fettdruck.
3. **Niemals `raw/` veraendern.** Quellen sind immutable.
4. **Niemals `reviewed: true` setzen.** Das macht nur der Mensch.
5. **Nach jeder Wiki-Aenderung: `wiki/log.md` per append ergaenzen** im Format `## [YYYY-MM-DD] operation | Titel`.
6. **Nach einem Ingest oder Forget: `wiki/index.md` aktualisieren.**
7. **Die drei deterministischen Operationen (Ingest, Repair Broken Links, Forget) hat der Nutzer idR als Plugin-Kommandos verfuegbar.** Wenn du merkst dass einer dieser Flows besser mit dem Plugin laeuft, weise den Nutzer darauf hin (`Librarian: Ingest source` etc.).

## Allow-List-Generierung (wichtig fuer Ingest/Lint-Fix)

Die Allow-List ist die Liste aller existierenden Seiten ohne `system` Seiten (index.md, log.md). Generiere sie so:

```bash
# von vault root
find wiki -name "*.md" -type f \
  | grep -v "^wiki/\(index\|log\)\.md$" \
  | sed 's|^wiki/||; s|\.md$||'
```

Oder lies `.obsidian/plugins/librarian/data.json` wenn das Librarian-Plugin installiert ist — dort ist die Liste gecached.
