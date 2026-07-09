# Leben OS — Wunschliste & Sparplan

Dieses Dokument beschreibt das Konzept hinter der Wunschliste und dem integrierten Sparplan.
Es ist kein technisches Dokument. Es beschreibt das Zielbild und die Logik dahinter.

---

## Einordnung ins Leben OS

Die Wunschliste ist kein separates Tool. Sie lebt im Finanz-Bereich als Aufgaben-Ordner — die einzelnen Wünsche sind Unteraufgaben dieses Ordners. Alles ist damit eindeutig verortet, strukturiert und mit dem Rest des Systems verbunden.

Der Kern-Gedanke:

> Einmal eintragen. Das System kümmert sich um den Rest.

---

## Der Einstieg — Rohtext reicht

Ein neuer Wunsch wird ohne Aufwand erfasst. Kein Formular, kein Pflichtfeld, kein Aufwand im Moment der Idee:

- "RAM 32GB DDR5"
- "Sony WH-1000XM6"
- "GPU RTX 5080"

Das ist genug. Der Rohtext landet als Unteraufgabe im Wunschlisten-Ordner. Die Anreicherung passiert nicht sofort — sondern im Weekly Review.

---

## Anreicherung im Weekly Review

Einmal pro Woche werden neue Roheinträge von Claude angereichert:

- Produktname wird konkretisiert
- Aktueller Marktpreis wird ermittelt und eingetragen
- Produktlink wird gesetzt (primär Amazon, sonst bester verfügbarer Shop)
- Prio wird gesetzt (1 / 2 / 3)
- Status wird auf Inaktiv gesetzt — du entscheidest wann aktiv bespart wird

Dieser Schritt passiert als Teil des regulären Sunday Reviews. Kein separater Aufwand.

---

## Status & Lifecycle

Jeder Wunsch hat einen Status den du jederzeit direkt in der OS-Übersicht anpassen kannst:

| Status | Bedeutung |
|---|---|
| Inaktiv | Erfasst, aber noch nicht aktiv verfolgt |
| Aktiv | Wird bespart, wird in Preisabfragen berücksichtigt |
| Kaufbereit | Sparstand hat den aktuellen Marktpreis erreicht |
| Gekauft | Abgeschlossen |

Der Wechsel zwischen den Status passiert manuell durch dich — nicht automatisch, nicht nur im Weekly. Du behältst die volle Kontrolle wann ein Wunsch aktiv angegangen wird.

---

## Kategorien

Jeder Wunsch bekommt beim Anlegen eine Kategorie. Diese steuert wie der Sparplan gewichtet:

| Kategorie | Bedeutung | Beispiele |
|---|---|---|
| 🔧 Invest | Verbessert Alltag, Gesundheit oder Produktivität nachhaltig | Matratze, Monitor, Gym-Equipment |
| 🎮 Enjoy | Konsum, Freizeit, Entertainment | GTA6, Konzertticket, Gadget |
| 📦 Need | Tatsächlicher Bedarf, Ersatz für kaputtes oder fehlendes | Ersatz-Laptop, Winterjacke |

Der Sparplan gewichtet automatisch: Need vor Invest vor Enjoy — du kannst aber jederzeit manuell übersteuern.

---

## Der Sparplan

Der Sparplan wird jeden Sonntag im Weekly Review neu berechnet. Claude kennt:

- Deine Fixkosten des Monats
- Deine variablen Ausgaben der letzten Wochen
- Anstehende verpflichtende Ausgaben mit Datum
- Die verbleibende Sparrate des aktuellen Monats
- Den Gesamtpreis aller aktiven Wünsche und den bisherigen Sparstand

Alle aktiven Wünsche teilen sich einen gemeinsamen Spartopf. Es gibt keine künstliche Aufteilung auf einzelne Artikel — der Topf wächst, und sobald er einen Artikel deckt zeigt das System es dir.

Daraus entsteht ein konkreter Vorschlag:

> "Spartopf diese Woche: +120€ — Gesamt: 340€ — GTA6 (80€) bereits kaufbar"

Du bestätigst oder passt an — das war es. Kein Task, keine To-do, keine Bürokratie. Der Sparplan ist eine Übersicht, keine Aufgabenliste.

> ⚙️ **Implementierung:** Der Sparplan-Prompt im Weekly Review muss den aktuellen Spartopf-Stand, alle aktiven Wünsche mit aktuellem Marktpreis und die verpflichtenden Ausgaben als Kontext mitbekommen. Die Berechnung was in den Spartopf fließt kommt aus dem Freiheit-Topf des Finanzplans — beide Module müssen hier zusammenspielen.

---

## Automatische Preisabfragen

Damit der Sparplan immer auf aktuellen Preisen basiert, werden Marktpreise automatisch abgefragt — ausschließlich für aktive Artikel.

Inaktive Wünsche werden nicht abgefragt. Du setzt einen Wunsch auf aktiv — ab dann läuft die Preisüberwachung.

### Datenquellen

| Quelle | Einsatz |
|---|---|
| Keepa API | Amazon-Artikel — zuverlässige Preishistorie, kostenlos |
| SerpAPI | Alle anderen Shops — Google Shopping Daten, kostenloser Tier (100 Anfragen/Monat) |

### Algorithmus — wann wird abgefragt?

Nicht jeder Artikel wird gleich oft abgefragt. Der Algorithmus priorisiert nach:

1. Sparfortschritt — je näher der Spartopf am Artikelpreis, desto häufiger
2. Kategorie — Need und Invest vor Enjoy

Beispiellogik bei 100 SerpAPI-Anfragen pro Monat:

| Situation | Abfragefrequenz |
|---|---|
| Spartopf ≥ 80% des Artikelpreises | 3x pro Monat |
| Need / Invest + Spartopf < 80% | 1x pro Monat |
| Enjoy + Spartopf < 80% | 1x pro Monat |
| Inaktive Artikel | Nie |

Bei einer überschaubaren Wunschliste bleibt das Budget locker im Rahmen.

> ⚙️ **Implementierung:** Der Abfrage-Algorithmus läuft als geplanter Job — täglich oder mehrmals wöchentlich. Er liest alle aktiven Artikel, entscheidet nach obiger Logik welche abgefragt werden, ruft Keepa oder SerpAPI auf und schreibt den neuen Preis zurück. Der Kaufbereit-Alert wird dabei ebenfalls geprüft und bei Bedarf ausgelöst. Die konkrete Umsetzung des Jobs hängt von der Infrastruktur von Leben OS ab.

---

## Verpflichtende Ausgaben

Neben der Wunschliste gibt es Ausgaben die zu einem festen Zeitpunkt kommen — unabhängig vom Sparplan und nicht verschiebbar. Diese werden separat erfasst und vom Sparplan vorrangig berücksichtigt.

| | Wunschliste | Verpflichtend |
|---|---|---|
| Zeitpunkt | Flexibel | Fix — Datum bekannt |
| Entscheidung | Kannst du verschieben | Kannst du nicht verschieben |
| Beispiele | Matratze, GPU, GTA6 | Urlaub, Versicherung, KFZ-Steuer |
| Gewichtung | Kategorie (Need/Invest/Enjoy) | Immer zuerst |

Der Sparplan rechnet verpflichtende Ausgaben rückwärts vom Datum:

> "Urlaub in 3 Monaten, 800€ fehlen noch → 267€/Monat reservieren"

Was nach Abzug der verpflichtenden Ausgaben übrig bleibt fließt in den Wunschlisten-Spartopf. So ist sichergestellt dass feste Ausgaben nie durch spontane Käufe gefährdet werden.

> ⚠️ Die genaue Implementierung und Integration in den Finanzplan wird in einem separaten Konzept ausgearbeitet.

---

## Der Kaufbereit-Alert

Sobald dein Sparstand einen aktiven Artikel überschreitet, erscheint in der Leben-OS-Übersicht eine Notification:

> 🛒 RAM 32GB DDR5 — Kauf jetzt möglich (650€ gespart / 600€ aktueller Preis)

Kein E-Mail-Rauschen. Kein externer Service. Die Info erscheint genau dort wo du sie brauchst — in deiner täglichen Übersicht.

Du entscheidest dann ob du kaufst oder weiter sparst. Das System setzt den Status nicht automatisch — das tust du.

---

## Was Leben OS hier nicht macht

- ❌ Kein automatischer Kauf
- ❌ Keine Tasks oder To-dos für einzelne Sparschritte
- ❌ Kein tägliches Preisrauschen — nur relevante Alerts
- ❌ Keine Überwachung inaktiver Artikel

---

## Ausblick

Wenn das Anlagenportfolio irgendwann Teil von Leben OS wird, kann der Sparplan um Investitions-Tasks erweitert werden — z.B. eine Erinnerung zum Kauf einer ETF-Position wenn ein Sparziel erreicht ist.

---

*Wunschliste & Sparplan — Teil von Leben OS. Minimaler Input. Maximaler Output.*
