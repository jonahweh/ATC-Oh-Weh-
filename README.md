# Lindenau Control

Ein Fluglotsenspiel im Browser. Du arbeitest am fiktiven Flughafen **Lindenau International (EDLX)** mit zwei parallelen Start- und Landebahnen, zwei Terminals dazwischen, Remote- und Cargo-Vorfeld und einem dichten Rollwegnetz.

**Etappe 1 (dieser Stand):** Du spielst **Delivery** und **Ground**. Tower und Anflug werden von der KI gesteuert. Jede Position kann auch die KI übernehmen.

## Spielen

- **Online:** nach dem Einrichten von GitHub Pages unter `https://<dein-name>.github.io/<repo-name>/`
- **Lokal:** `index.html` einfach im Browser öffnen (Chrome, Edge oder Firefox). Es wird nichts installiert.

Beim ersten Mal lohnt sich der Knopf **Tutorial spielen**.

## Was schon drin ist

- Flugplan mit Wellen (Banks), fiktiven Airlines und echten Zielen, 17 Flugzeugtypen mit echten Maßen und Leistungsdaten (A320 bis A380, ATR, Dash 8, Frachter)
- **Delivery:** Streckenfreigabe mit SID, Anfangshöhe und Squawk, Readback prüfen, Übergabe an Ground, neue Freigabe nach einem Betriebsrichtungswechsel
- **Ground:** Pushback mit Blickrichtung, Pushback verzögern, Rollfreigaben mit frei wählbarer Route, Anhalten/Weiterrollen, *hold short*, *give way*, *follow*, Standzuweisung, Übergabe an Tower, Übergaben annehmen
- Piloten mit echter Phraseologie (englisch), Readbacks, Nachfragen, zweitem Anruf, Sprachausgabe
- Pilotenfehler: falsches Readback (Squawk, Höhe, SID, Rollweg), falsch abgebogen
- Piloten halten selbst an, wenn vor ihnen Verkehr ist. Kreuzender Verkehr oder Gegenverkehr kostet aber Punkte (Bodenkonflikt). Flugzeuge können nicht rückwärts rollen, notfalls muss ein Schlepper kommen.
- Holding Points mit Restbahnlänge (Großraumflugzeuge brauchen die volle Länge), Standard-Rollrichtungen je Betriebsrichtung
- Wetter: Windänderung mit Betriebsrichtungswechsel (27 ↔ 09) und Übergangsphase, Nebel mit LVP, Tag/Nacht mit Beleuchtung, ATIS-Kennung
- Notfälle: medizinischer Notfall beim Rollen, Triebwerksbrand, heiße Bremsen nach der Landung (mit Feuerwehr)
- Wertung, Schichtende mit Auswertung, Rekord

## Bedienung

| Aktion | So geht's |
| --- | --- |
| Flugzeug wählen | Klick in der Liste oder auf der Karte, **Tab** springt zum nächsten wartenden Flug |
| Befehl geben | Knöpfe im rechten Panel oder tippen in der Befehlszeile |
| Karte | Ziehen = verschieben, Mausrad = zoomen |
| Pause | Leertaste |
| Hilfe | **F1** |

Befehle (Rufzeichen kann wegfallen, wenn ein Flugzeug gewählt ist):

```
CLR [SID] [Höhe] [Squawk]    Streckenfreigabe          CLR ROKAT1W 5000 4721
RBC                          Readback korrekt
GND                          an Ground übergeben
PB N|E|S|W                   Pushback mit Blickrichtung PB E
PBH <min>                    Pushback verzögern        PBH 3
TX <Ziel> [VIA ...]          rollen                    TX N8 VIA G Z B   ·   TX 104
HOLD / CONT                  anhalten / weiterrollen
HS <Rollweg>                 vor Rollweg halten        HS B
GW <Rufzeichen>              Vorfahrt gewähren         GW PLW512
FL <Rufzeichen>              folgen
STAND <Nr>                   Stand zuweisen            STAND 214
TWR                          an Tower übergeben
ACC                          Übergabe annehmen
```

Mehrere Befehle lassen sich verketten: `LNX427 TX N8 VIA G Z B HS B`.

## Projektaufbau

```
index.html        Seite und Startbildschirm
css/style.css     Aussehen der Oberfläche
js/util.js        Mathe, Zufall, Funk-Phraseologie, Kollisionsformen
js/data.js        Flugzeugtypen, Airlines, Ziele, SIDs, Frequenzen, Staffelung
js/airport.js     Flughafen-Layout, Rollweg-Graph, Wegsuche, Standard-Rollrichtungen
js/weather.js     Wind, Sicht, Betriebsrichtung, ATIS, Tageslicht
js/radio.js       Funksprüche von Piloten und Lotsen, Sprachausgabe
js/aircraft.js    Bewegung am Boden, Start, Landung
js/sim.js         Simulation: Flugplan, Pilotenverhalten, KI-Lotsen, Konflikte, Punkte
js/commands.js    Befehlszeile
js/render.js      gemalte 2D-Karte
js/ui.js          Flugliste, Detailpanel, Funk-Log, Hilfe
js/tutorial.js    Tutorial
js/main.js        Spielschleife und Steuerung
```

Die Simulation (`sim.js` und alles davor) kommt ohne Browser aus. Das ist Absicht: In Etappe 3 läuft sie auf dem Server, damit alle Mitspieler denselben Flughafen sehen.

## Fahrplan

1. **Boden: Delivery und Ground** ✅
2. **Tower und Luftraum:** Start- und Landefreigaben, Line-up, Go-around, Approach/Departure mit Kurs, Höhe, Geschwindigkeit, Direct, Holding, ILS, SID/STAR, Wirbelschleppenstaffelung in der Luft, Gewitterzellen
3. **Multiplayer:** Raum-Code, bis zu 6 Lotsen, Übergaben zwischen Spielern, Lotsen-Chat mit Koordinationsnachrichten (Server z. B. auf Render.com)
4. **Feinschliff:** Sounds, mehr Notfälle, Szenarien, Statistiken
