# Leben OS — Finanzplan

Dieses Dokument beschreibt das Konzept und die Implementierungsrichtung des Finanzplans.
Implementierungsdetails sind als Orientierung gedacht und müssen auf die tatsächliche Leben-OS Architektur angepasst werden.

---

## Philosophie

Kein Budgetieren das Disziplin braucht. Stattdessen:

> Das Geld wird verteilt bevor es ausgegeben werden kann. Was übrig bleibt gehört dir — ohne schlechtes Gewissen.

Der Finanzplan funktioniert nicht durch Kontrolle sondern durch Struktur. Leben OS übernimmt das Denken — der Nutzer entscheidet nur noch wo er hinwill.

---

## Das 4-Töpfe-Modell

Gehalt kommt rein und wird sofort aufgeteilt:

| Topf | Zweck | Verhalten |
|---|---|---|
| 🏠 Fixkosten | Miete, Abos, Versicherungen | Separates Konto, Daueraufträge laufen ab hier |
| 🛡️ Sicherheit | Notgroschen | Tagesgeldkonto, unangetastet |
| 📈 Wachstum | ETF-Sparplan, Investments | Automatisch, monatlich, nicht anfassen |
| 🎯 Freiheit | Alles was übrig bleibt | Frei verfügbar — Wunschliste, Alltag, Freizeit |

Topf 4 ist der entscheidende psychologische Hebel: Solange Freiheit-Topf es hergibt ist jede Ausgabe legitim. Kein Tracking, kein schlechtes Gewissen, kein Nachdenken.

---

## Die drei Phasen

### Phase 1 — Klarheit schaffen

Bevor Töpfe sinnvoll befüllt werden können muss ein echtes Bild der Ausgaben entstehen. Leben OS trackt in dieser Phase alle Einnahmen und Ausgaben.

**Ziel:** Fixkosten kennen. Variable Ausgaben verstehen. Topf-Größen aus echten Daten ableiten — nicht schätzen.

**Abschluss:** Phase 1 endet nicht nach einer festen Zeit sondern wenn Leben OS genug Datenpunkte hat. Claude meldet sich aktiv: "Ich habe jetzt genug Daten, hier ist mein Vorschlag für deine Töpfe — bestätigen?" Die Topf-Größen werden ab dann im Weekly Review regelmäßig neu berechnet und angepasst.

> ❓ **Offene Frage:** Wie viele Wochen Datenbasis sind Minimum bevor Claude einen sinnvollen Topf-Vorschlag machen kann — 4 oder 8 Wochen?

### Phase 2 — Sicherheit aufbauen

Erst wenn der Notgroschen steht wird investiert. Nicht vorher. Der Notgroschen ist die Basis — ohne ihn ist jede Investition ein unnötiges Risiko.

**Ziel:** Finanzielle Unabhängigkeit von kurzfristigen Schocks. Leben OS berechnet die Zielgröße aus den tatsächlichen Fixkosten — nicht pauschal nach Gehalt.

> ❓ **Offene Frage:** Wie groß soll der Notgroschen sein — 3 Nettogehälter (Mindeststandard), 6 Nettogehälter (komfortabler Puffer), oder fixkostenbasiert (z.B. 4 Monate tatsächliche Fixkosten)?

### Phase 3 — Wachstum starten

ETF-Sparplan einrichten, automatisch ausführen lassen, nicht anfassen. Hier startet auch der Wunschlisten-Sparplan aktiv — aus dem Freiheit-Topf, ohne Konflikt mit Sicherheit oder Wachstum.

**Ziel:** Vermögen wächst im Hintergrund ohne aktiven Aufwand.

> ❓ **Offene Fragen:**
>
> - Wie viel fließt in Wachstum — fester Prozentsatz vom Freiheit-Topf oder feste Summe die Claude nach Phase 1 vorschlägt?
> - Welcher Broker wird genutzt — bereits vorhanden oder noch offen?

---

## Ausgaben-Erfassung

Die Basis des gesamten Finanzplans ist eine saubere Ausgaben-Erfassung. Ohne Daten keine Übersicht — aber der Aufwand muss minimal sein.

Es gibt zwei Erfassungswege:

### Kassenbon-Scan

Foto des Belegs → Leben OS extrahiert alle Einzelpositionen automatisch.

Einzelpositionen sind Pflicht — nicht optional. Sie sind die Datenbasis für den digitalen Kühlschrank, die Kategorisierung und das Ausgaben-Monitoring.

Kategorisierung läuft automatisch:

- OCR liest den Kassenbon via Tesseract (open source, keine laufenden Kosten)
- Eine Mapping-Tabelle ordnet bekannte Produkte automatisch zu: "Vollmilch" → Lebensmittel, "Zahnpasta" → Drogerie
- Unbekannte Positionen landen in "Unkategorisiert" — du ordnest sie einmal zu, danach merkt sich das System die Zuordnung
- Nach wenigen Wochen deckt die Tabelle den Großteil der Einkäufe ab

> ⚙️ **Implementierung:** Tesseract läuft lokal, kein externer API-Call notwendig. Die Mapping-Tabelle wächst als einfache Key-Value-Struktur und wird beim nächsten Scan desselben Produkts automatisch angewendet. Unbekannte Positionen werden dem Nutzer zur einmaligen Zuordnung angezeigt.

### Manuelle Eingabe

Für Online-Käufe, Überweisungen und alles ohne physischen Beleg:

- Betrag (Pflicht)
- Notiz / Beschreibung (optional)
- Topfzuordnung — Fixkosten / Freiheit / Verpflichtend

Die Topfzuordnung ist der entscheidende Schritt: sie gibt dem System den Kontext ob es sich um eine geplante, verpflichtende oder freie Ausgabe handelt.

> ⚙️ **Implementierung:** Manuelle Eingabe sollte aus der Schnellerfassung von Leben OS heraus erreichbar sein — minimale Felder, ein Tap auf den Topf, fertig. Die Topfzuordnung schreibt direkt in die Finanzplan-Logik.

---

## Weekly Review Integration

Der Finanzplan lebt im Weekly Review. Jeden Sonntag bekommt Claude einen Überblick:

- Einnahmen der Woche
- Ausgaben nach Kategorie
- Topf-Stände aktuell
- Sparfortschritt Notgroschen
- Sparfortschritt Wunschliste
- Anstehende verpflichtende Ausgaben

Claude gibt einen konkreten Kommentar:

> "Diese Woche 340€ ausgegeben — Freiheit-Topf hat noch 180€ bis Monatsende. Urlaub in 6 Wochen: noch 240€ fehlen, Tempo erhöhen oder Wunschliste diese Woche pausieren."

Kein Aufsatz. Keine Analyse die niemand liest. Strukturierte Einschätzung mit einem konkreten Hinweis.

> ⚙️ **Implementierung:** Der Weekly Review Prompt muss die aktuellen Finanzdaten aus Leben OS als Kontext mitbekommen. Die genaue Datenübergabe hängt von der Claude-Integration im Weekly Review ab.

---

## Fixkosten-Monitoring

Fixkosten werden einmalig erfasst und danach automatisch überwacht:

- Betrag, Kategorie, Intervall (monatlich / jährlich / quartalsweise)
- Leben OS erkennt wenn eine Fixkost sich verändert hat
- Jährliche Fixkosten werden monatlich anteilig im Topf reserviert — keine bösen Überraschungen

> ⚙️ **Implementierung:** Fixkosten brauchen ein eigenes Datenmodell mit Intervall-Logik. Die monatliche Anteilsberechnung für jährliche Posten muss in den Topf-Berechnungen berücksichtigt werden.

---

## Verpflichtende Ausgaben

Ausgaben die zu einem festen Datum kommen und nicht verschiebbar sind werden separat erfasst und vom Freiheit-Topf vorrangig abgezogen:

- Name, Betrag, Datum
- Leben OS berechnet wie viel pro Monat reserviert werden muss
- Der verfügbare Freiheit-Topf wird entsprechend reduziert angezeigt

> "Urlaub in 3 Monaten, 800€ fehlen → 267€/Monat reservieren → Freiheit-Topf effektiv 133€ weniger pro Monat"

> ⚙️ **Implementierung:** Verpflichtende Ausgaben sind konzeptionell nah an der Wunschliste aber mit Datum-Logik. Ob sie im gleichen Datenmodell leben oder separat hängt von der Architektur ab.

---

## Investment-Tracking

Sobald Phase 3 aktiv ist wird das Portfolio in Leben OS sichtbar:

- ETF-Positionen mit aktuellem Wert
- Monatlicher Sparplan-Betrag
- Gesamtentwicklung über Zeit
- Keine tägliche Kurspflege — wöchentliches Update reicht

Käufe und Verkäufe werden nicht als Tasks verwaltet — außer das Anlagenportfolio wächst irgendwann so weit dass gezielte Positionskäufe sinnvoll werden.

> ⚙️ **Implementierung:** Portfolio-Daten können manuell eingetragen oder über eine Broker-API (z.B. Trade Republic, Scalable) automatisch gepullt werden. API-Anbindung ist eine spätere Erweiterung — manuell reicht für den Start.

---

## Was der Finanzplan nicht ist

- ❌ Kein Haushaltsbuch das jeden Cent trackt
- ❌ Keine Steuerberatung oder rechtliche Empfehlung
- ❌ Kein Ersatz für professionelle Finanzberatung bei komplexen Situationen
- ❌ Kein System das Disziplin voraussetzt — es schafft sie durch Struktur

---

## Der Maßstab

**Funktioniert der Finanzplan auch wenn man zwei Wochen nicht draufschaut?**

Wenn ja — er ist gut gebaut. Automatische Töpfe, automatischer Sparplan, wöchentlicher Überblick. Der Nutzer muss nichts aktiv tun außer Ausgaben erfassen und sonntags kurz hinschauen.

---

*Finanzplan — Teil von Leben OS. Sicherheit als Basis. Wachstum als Ziel.*
