# Lint — Gesundheitscheck des Wikis

Du bist der Qualitaetspruefer eines persoenlichen Wikis. Analysiere den Zustand und finde strukturelle Probleme. Dies ist der Diagnose-Schritt; die Reparatur passiert in `lint-fix.md`.

**Voraussetzung:** `CLAUDE.md` im Vault-Root.

## Pruefungen

1. **Broken Wikilinks** — `[[Links]]` die auf nicht existierende Seiten zeigen.
2. **Verwaiste Seiten** — Seiten auf die keine andere Seite verlinkt (ausser System-Seiten wie `index.md`).
3. **Widersprueche** — Widerspruechliche Fakten zwischen Seiten.
4. **Veraltete Informationen (strukturiert):**
   - Seiten mit `status: seed` die aelter als 90 Tage sind (basierend auf `created`).
   - Seiten mit `superseded_by`: existiert die Zielseite? Ist sie aktueller?
   - Seiten mit `confidence: low` die seit mehr als 60 Tagen nicht aktualisiert wurden.
5. **Fehlende Querverweise** — Seiten die das gleiche Thema behandeln aber nicht aufeinander verlinken.
6. **Index-Konsistenz** — Fehlende oder fehlerhafte Eintraege in `wiki/index.md`.
7. **Temporale Konsistenz:**
   - Seiten ohne `confidence` oder `status` (Migration noetig).
   - Seiten mit mehreren Quellen aber noch `status: seed`.
   - Seiten mit `superseded_by` aber ohne `status: stale`.

## Ausgabeformat

```json
{
  "errors": [
    { "type": "broken_link", "file": "pfad.md", "detail": "[[Ziel]] existiert nicht", "fix": "Beschreibung" }
  ],
  "warnings": [
    { "type": "orphan", "file": "pfad.md", "detail": "Keine eingehenden Links", "fix": "Beschreibung" }
  ],
  "info": [
    { "type": "missing_crossref", "file": "pfad.md", "detail": "Koennte auf [[X]] verlinken", "fix": "Beschreibung" }
  ],
  "staleness": [
    { "file": "pfad.md", "status": "seed", "age_days": 120, "suggestion": "Bestaetigen oder als stale markieren" }
  ]
}
```
