# Plan: Umplanen ohne Lehrperson (Raumausfall als zweiter Solver-Pfad)

Status: **beschlossen, Umsetzung vertagt.** Aufgenommen am Tag der TUM-Videoproduktion.
Betrifft: `src/components/CalendarPanel.tsx`, die Werkzeugschicht, das CP-SAT-Modell, `config/aoi/*.json`, i18n, `e2e/replan.spec.ts`.

## Das Problem, in einem Satz

**Ausgerechnet der Standort mit den besten Daten kann die beste Fähigkeit nicht zeigen.**

Der Umplanen-Balken hängt heute an einer einzigen Bedingung:

```tsx
// src/components/CalendarPanel.tsx
{scope === 'teacher' && data?.subject?.id && !mismatch && (
  <div data-testid="replan-bar"> … </div>
)}
```

Also nur, wenn der Wochenplan auf eine **konkrete Lehrperson** eingegrenzt ist. Der begleitende
Kommentar begründet das auch:

> *Lecturers only: a cohort or a room cannot "become unavailable" in a way the solver models.*

Für Semestergruppen stimmt das. **Für Räume stimmt es nicht.** Ein Raum fällt sehr wohl aus:
Sanierung, Wasserschaden, defekte Technik, kurzfristige Fremdbelegung. Das ist einer der
häufigsten realen Planungsanlässe überhaupt.

Die Folge zeigte sich in Garching. Der Standort hat echte Grundrisse, echte Räume und echte
TUMonline-Buchungen, aber die Lehrendenzuordnung ist erfunden. Deshalb verweigert die
Werkzeugschicht bewusst jede namentliche Personenfrage, und die App fragt stattdessen zurück:

> „Welche Lehrperson ist gemeint? Ich brauche den Namen oder das Kürzel der Lehrperson."

Damit ist der Umplanen-Balken dort **unerreichbar**. Nicht kaputt, sondern zugesperrt. Im
Demo-Video für die TUM fehlt deshalb der stärkste Beat, obwohl die Datenlage dort die beste ist.

## Der Vorschlag: Raumausfall als zweiter Einstieg

Ein Raumausfall braucht **keine Person**. Er benutzt ausschließlich Daten, die in Garching echt
sind: den Raum, seine Kapazität und die echten Buchungen darin. Er ist damit an jedem Standort
ehrlich, dessen Raumbestand vermessen ist, unabhängig von der Lehrendenfrage.

Szenario auf der Folie: *„Hörsaal 5510.EG.001 ist am Freitag gesperrt. Was ist betroffen, und wie
kommen wir mit möglichst wenig Verschiebung durch die Woche?"*

## Schritte

1. **Fähigkeit deklarieren, nicht erraten.**
   Neues Feld je Standort in `config/aoi/*.json`, zum Beispiel `replanScopes: ["teacher", "room"]`.
   Es wird aus der Provenienz abgeleitet und nicht geraten: `teacher` nur, wo die Zuordnung echt
   ist, `room` nur, wo der Raumbestand vermessen ist. Garching bekommt `["room"]`, die OTH beide.
   Ohne diesen Schritt wandert die Ehrlichkeitsregel in die Oberfläche, wo sie niemand findet.

2. **Werkzeugschicht erweitern.**
   Gegenstück zur bestehenden Lehrpersonen-Ermittlung: betroffene Termine für einen Raum an einem
   Tag. Die Verweigerungsregel bleibt unangetastet, sie wird nur nicht mehr fälschlich zum
   Totalausfall des Umplanens, weil es jetzt einen zweiten, sauberen Pfad gibt.

3. **CP-SAT: dieselbe Form von Nebenbedingung.**
   Eine Raumsperre ist strukturell identisch zur Lehrpersonensperre, nämlich ein verbotenes Paar
   aus Ressource und Tag. Das Modell weist Räume bereits zu, es kommt eine harte Bedingung hinzu,
   die diesen Raum an diesem Tag ausschließt. Zielfunktion und Optimalitätsnachweis bleiben, wie
   sie sind.
   ⚠️ **Infeasibilität ist hier ein realistischer Ausgang**, viel eher als beim Lehrpersonenfall:
   ein großer Hörsaal hat womöglich keinen gleichwertigen Ersatz. Das braucht eine klare Antwort
   („keine konfliktfreie Lösung ohne Kapazitätsverlust, hier sind die Engpässe"). Das ist kein
   Makel, sondern selbst ein gutes Demo-Ergebnis, weil es zeigt, dass das System nicht schwindelt.

4. **Oberfläche aufmachen.**
   Die Bedingung wird von `scope === 'teacher'` auf „Bereich ist für diesen Standort freigegeben"
   umgestellt. Beschriftung und Bestätigungstext unterscheiden sich je Bereich, das Freigabetor
   vor der Übernahme bleibt unverändert bestehen.

5. **i18n.**
   Neue Zeichenketten in `de.json` und `en.json`, danach der Paritätstest
   (`npx vitest run src/i18n/__tests__/catalogue.test.ts`).

6. **Tests.**
   `e2e/replan.spec.ts` um den Raumfall erweitern, ausgeführt an einem Standort mit erfundener
   Lehrendenzuordnung. Der Test muss beides zeigen: der Vorschlag entsteht, und er wird ohne
   Bestätigung nicht übernommen.

7. **Demo nachziehen.**
   `tools/demo/record-guide-tum.mjs` bekommt den Umplanen-Beat zurück, diesmal über den Raum.
   Danach `tools/demo/build-guide-video-tum.py` neu laufen lassen und die Anhangsfolie im Deck
   erneuern (`node tools/deck/build-exec.cjs --site garching`).

## Verworfene Alternative

**Den Lehrpersonenfall in Garching einfach erlauben und mit einem Hinweis versehen.**
Verworfen. Es würde echte Zahlen über eine erfundene Person behaupten, und genau das ist die
Aussage, die diese App an jeder anderen Stelle verweigert. Ein Warnhinweis darunter macht die
Behauptung nicht wahr, er macht sie nur kleiner gedruckt.
