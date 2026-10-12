/**
 * The Power BI guidelines in German.
 *
 * Generated from content.ts and a numbered list of German texts: the same
 * structure, markers, question links, drawings and addresses, only the words
 * differ. A test holds the two files to the same shape. Change the English
 * file first, then this one in the same place.
 */
import type { GuideSection } from './content';

export const SECTIONS_DE: GuideSection[] = [
  {
    "id": "data-integration",
    "num": "1",
    "title": "Datenintegration & Power Query",
    "icon": "integration",
    "subs": [
      {
        "num": "1.1",
        "title": "Datenverbindungen",
        "items": [
          {
            "marker": "1.",
            "title": "Import",
            "text": "Der Standard. Schnellste Abfragen und alle Modellierungsfunktionen. Beginnen Sie hier und weichen Sie nur mit Grund ab."
          },
          {
            "marker": "2.",
            "title": "Direct Lake",
            "text": "Bei Bedarf: für sehr große Daten oder Daten, die aktueller sein müssen, als eine geplante Aktualisierung erlaubt, wenn die Daten in OneLake liegen."
          },
          {
            "marker": "3.",
            "title": "Direct Query",
            "text": "Fast nie. Jedes Visual schickt eine Abfrage an die Quelle: Berichte werden langsam und die Quelle trägt die Last. Nur wenn Daten nicht kopiert werden dürfen oder sekundengenau aktuell sein müssen."
          }
        ]
      },
      {
        "num": "1.2",
        "title": "Importmodus",
        "items": [
          {
            "marker": "a.",
            "text": "Entfernen Sie nicht benötigte Zeilen und Spalten aus den Quelldaten."
          },
          {
            "marker": "b.",
            "q": "source-strategy",
            "text": "Nutzen Sie Sichten als Datenquelle: Änderungen an den zugrunde liegenden Tabellen wirken sich dann nicht auf den bestehenden Bericht aus."
          },
          {
            "marker": "c.",
            "text": "Achten Sie auf optimierte Datentypen."
          },
          {
            "marker": "d.",
            "q": "split-date-time",
            "text": "Teilen Sie DateTime-Spalten in zwei Spalten (eine für das Datum, eine für die Uhrzeit): Das Modell wird schneller und ist einfacher zu nutzen."
          }
        ]
      },
      {
        "num": "1.3",
        "title": "Verbindungstyp Direct Lake",
        "intro": "Wählen Sie Direct Lake, wenn:",
        "items": [
          {
            "marker": "•",
            "text": "Daten nahezu in Echtzeit aktuell sein müssen."
          },
          {
            "marker": "•",
            "text": "Sehr große Modelle teuer zu aktualisieren sind oder sich nur inkrementell oder je Partition aktualisieren lassen."
          },
          {
            "marker": "",
            "title": "Überlegungen & Einschränkungen",
            "children": [
              {
                "marker": "a.",
                "text": "Die Einrichtung ist etwas aufwendiger."
              },
              {
                "marker": "b.",
                "text": "Nicht alle Datenquellen werden unterstützt."
              },
              {
                "marker": "c.",
                "text": "„Hilfstabellen“ lassen sich nur über Lakehouse und Verknüpfung (Shortcut) zum Power BI-Warehouse ergänzen."
              },
              {
                "marker": "d.",
                "text": "Berechnete Tabellen und berechnete Spalten sind nicht möglich."
              },
              {
                "marker": "e.",
                "text": "Feldparameter lassen sich nur mit Tabular Editor ergänzen und machen dort mehr Aufwand."
              },
              {
                "marker": "f.",
                "text": "Das Entwerfen von Direct Lake-Modellen in Power BI Desktop hat eigene Einschränkungen. Prüfen Sie sie vorab oder bauen Sie das Modell im Power BI-Dienst.",
                "link": {
                  "label": "Direct Lake in Power BI Desktop: Überlegungen und Einschränkungen",
                  "href": "https://learn.microsoft.com/en-us/fabric/get-started/direct-lake-power-bi-desktop#considerations-and-limitations"
                }
              },
              {
                "marker": "g.",
                "text": "Für Direct Lake gibt es eine längere Liste weiterer Überlegungen und Einschränkungen, die sich mit der Zeit ändert.",
                "link": {
                  "label": "Direct Lake im Überblick: Überlegungen und Einschränkungen",
                  "href": "https://learn.microsoft.com/en-us/fabric/get-started/direct-lake-overview#considerations-and-limitations"
                }
              }
            ]
          }
        ]
      },
      {
        "num": "1.4",
        "title": "Weitere bewährte Methoden",
        "items": [
          {
            "marker": "1.",
            "title": "Power Query-Transformationen minimieren",
            "text": "Verlagern Sie Transformationen wo möglich ins Data Warehouse, damit das Modell schneller verarbeitet wird, und prüfen Sie, ob Query Folding stattfindet."
          },
          {
            "marker": "2.",
            "title": "Datum und Uhrzeit trennen",
            "text": "Trennen Sie bei DateTime-Spalten, deren Werte nicht auf Mitternacht liegen, die Uhrzeit vom Datum (oder runden Sie auf Mitternacht), um die Kardinalität der Spalte zu senken."
          },
          {
            "marker": "3.",
            "title": "Lange Spalten mit hoher Kardinalität reduzieren",
            "text": "Vermeiden Sie lange Textspalten (mehr als 100 Zeichen), besonders mit vielen eindeutigen Werten: Sie verlängern die Verarbeitung, blähen das Modell auf und verlangsamen Abfragen."
          },
          {
            "marker": "4.",
            "title": "Datenmenge reduzieren",
            "text": "Laden Sie keine Zeilen oder Spalten, die für die Fragen des Berichts nicht nötig sind."
          },
          {
            "marker": "5.",
            "title": "Redundante Spalten in verbundenen Tabellen entfernen",
            "text": "Wird nur eine benötigt, löschen Sie die anderen aus dem Modell."
          },
          {
            "marker": "6.",
            "title": "Ungenutzte Quellen entfernen",
            "text": "Entfernen Sie Quellen, die im Bericht nicht verwendet oder referenziert werden."
          }
        ]
      }
    ]
  },
  {
    "id": "data-modeling",
    "num": "2",
    "title": "Datenmodellierung",
    "icon": "modeling",
    "subs": [
      {
        "num": "2.1",
        "title": "Allgemeine Datenmodellierung",
        "items": [
          {
            "marker": "1.",
            "q": "separate-report-model",
            "title": "Bericht und semantisches Modell trennen",
            "text": "Tun Sie das, wenn mehr als ein Bericht das Modell als Quelle nutzt."
          },
          {
            "marker": "2.",
            "title": "Kalendertabelle",
            "children": [
              {
                "q": "has-date-dim",
                "marker": "a.",
                "text": "Modelle sollten mindestens eine Datumstabelle haben, um Funktionen wie Zeitintelligenz und eine saubere Struktur zu nutzen."
              },
              {
                "q": "marked-date-table",
                "marker": "b.",
                "text": "Datums- und Kalendertabellen sollten als Datumstabelle markiert sein."
              },
              {
                "q": "auto-datetime",
                "marker": "c.",
                "text": "Deaktivieren Sie „Automatisches Datum/Uhrzeit“ in den Einstellungen von Power BI Desktop und entfernen Sie automatisch erzeugte Datumstabellen, um Speicher zu sparen."
              }
            ]
          },
          {
            "marker": "3.",
            "title": "Explizite Measures erstellen."
          },
          {
            "marker": "4.",
            "q": "calc-location",
            "title": "Berechnete Spalten und Power Query-Transformationen vermeiden",
            "text": "Das gehört ins Backend.",
            "children": [
              {
                "marker": "a.",
                "text": "Reduzieren Sie die Zahl berechneter Spalten: Sie komprimieren schlechter als Datenspalten, brauchen mehr Speicher und verlangsamen die Verarbeitung. Verlagern Sie die Logik ins Warehouse."
              },
              {
                "marker": "b.",
                "text": "Reduzieren Sie den Einsatz berechneter Tabellen: Verlagern Sie die Logik ins Warehouse, um technische Schulden und Abweichungen zwischen Modellen zu vermeiden."
              }
            ]
          },
          {
            "q": "remove-unused",
            "marker": "5.",
            "title": "Unnötige Spalten entfernen",
            "text": "Ausgeblendete Spalten, auf die kein DAX-Ausdruck, keine Beziehung, keine Hierarchieebene und keine Sortierspalte verweist, sollten entfernt werden."
          },
          {
            "marker": "6.",
            "title": "Unnötige Measures entfernen",
            "text": "Ausgeblendete Measures, auf die kein DAX-Ausdruck verweist, sollten der Wartbarkeit wegen entfernt werden."
          },
          {
            "marker": "7.",
            "title": "Sternschema, wo immer es geht",
            "children": [
              {
                "q": "schema-approach",
                "marker": "a.",
                "text": "Ziehen Sie wo möglich ein Sternschema einem Schneeflockenschema vor: Es ist für tabellarische Modelle optimal. Vermeiden Sie auch flache Tabellen."
              },
              {
                "marker": "b.",
                "text": "Kennzahlen gehören in Spalten, nicht in Zeilen: Anders als andere BI-Werkzeuge arbeitet Power BI am besten mit Kennzahlen in getrennten Spalten."
              },
              {
                "q": "galaxy-schema",
                "marker": "c.",
                "text": "Ziehen Sie ein Galaxy-Schema (mehrere Sterne) einem einzigen großen Sternschema vor: Das erlaubt unterschiedliche Granularität und ist auch für die Leistung optimal."
              }
            ]
          },
          {
            "marker": "8.",
            "title": "Beziehungen",
            "children": [
              {
                "marker": "a.",
                "text": "Ziehen Sie „1:n“ den „m:n“-Beziehungen vor, um die Leistung zu steigern: Brückentabellen helfen, m:n zu vermeiden."
              },
              {
                "q": "relationship-policy",
                "marker": "b.",
                "text": "m:n-Beziehungen sollten nur in eine Richtung filtern."
              },
              {
                "marker": "c.",
                "text": "Prüfen Sie, ob bidirektionale und m:n-Beziehungen berechtigt sind: Sie können die Leistung verschlechtern oder unbeabsichtigte Folgen haben."
              }
            ]
          },
          {
            "marker": "9.",
            "title": "Nutzen Sie Ihre gemeinsame Snippet-Sammlung zusammen mit der TMDL-Ansicht für",
            "children": [
              {
                "marker": "a.",
                "text": "Kalendertabelle."
              },
              {
                "q": "time-intel-cg",
                "marker": "b.",
                "text": "Berechnungsgruppen (Zeitintelligenz, Einheiten)."
              },
              {
                "marker": "c.",
                "text": "Parameter."
              },
              {
                "q": "last-refresh",
                "marker": "d.",
                "text": "Fußzeile: Zeitstempel der letzten Aktualisierung; Parametertabelle und Measure für die Datenquelle."
              },
              {
                "q": "measure-descriptions",
                "marker": "e.",
                "text": "Beschreibungen für alle Measures über die TMDL-Ansicht."
              },
              {
                "marker": "f.",
                "text": "Detailzeilenausdrücke für alle Anzeigeordner (Gruppen von Measures) über die TMDL-Ansicht."
              }
            ]
          }
        ]
      },
      {
        "num": "2.2",
        "title": "DAX: Data Analysis Expressions",
        "items": [
          {
            "q": "dax-avoid",
            "marker": "1.",
            "title": "DIVIDE für Divisionen verwenden",
            "text": "Verwenden Sie DIVIDE statt des Operators „/“: Das fängt Divisionen durch null ab und vermeidet Fehler."
          },
          {
            "marker": "2.",
            "title": "DAX-Variablen verwenden",
            "text": "Verwenden Sie VAR in einem DAX-Ausdruck, wenn Sie innerhalb einer Funktion auf etwas verweisen müssen."
          },
          {
            "marker": "3.",
            "title": "SWITCH statt verschachtelter IF verwenden",
            "text": "SWITCH(TRUE(), …) ist effizienter als verschachtelte IF/ELSE."
          },
          {
            "marker": "4.",
            "title": "IFERROR vermeiden",
            "text": "Es kann die Leistung verschlechtern. Für Divisionen durch null verwenden Sie DIVIDE."
          },
          {
            "marker": "5.",
            "title": "TREATAS statt INTERSECT verwenden",
            "text": "TREATAS ist für virtuelle Beziehungen effizienter."
          },
          {
            "marker": "6.",
            "title": "Berechnete Spalten mit RELATED reduzieren",
            "text": "Berechnete Spalten komprimieren schlecht und verlangsamen die Verarbeitung: Vermeiden Sie sie wo möglich."
          }
        ]
      },
      {
        "num": "2.3",
        "title": "Organisation der Measures",
        "items": [
          {
            "marker": "1.",
            "q": "empty-measure-table",
            "title": "Measure-Tabellen als Container verwenden",
            "text": "Halten Sie Measures in einer Containertabelle mit dem Namen „{{measure-table-name}}“.",
            "children": [
              {
                "marker": "a.",
                "text": "Eine Measure-Tabelle ist theoretisch nicht nötig, wenn alle Spalten der Faktentabelle ausgeblendet sind (vollständig denormalisiert)."
              },
              {
                "marker": "b.",
                "text": "In allen anderen Fällen legen Sie unbedingt eine Measure-Tabelle an: Das hilft auch während der Entwicklung."
              },
              {
                "marker": "c.",
                "title": "Vorteile",
                "children": [
                  {
                    "marker": "i.",
                    "text": "Measures sind leicht zu finden: ganz oben, mit einheitlichem Namen."
                  },
                  {
                    "marker": "ii.",
                    "text": "Measures aus mehreren Faktentabellen lassen sich zusammen gruppieren (z. B. Ist gegen Plan)."
                  }
                ]
              }
            ]
          },
          {
            "marker": "2.",
            "title": "Anzeigeordner verwenden",
            "children": [
              {
                "marker": "a.",
                "text": "Gruppieren Sie Measures und andere Felder in Ordnern und Unterordnern."
              },
              {
                "marker": "b.",
                "text": "Geben Sie Ordnern und Unterordnern sprechende Namen."
              },
              {
                "marker": "c.",
                "text": "Ordner legen Sie an über Modell → Measure auswählen → Eigenschaften → Anzeigeordner. Derselbe Name gruppiert Measures zusammen."
              }
            ]
          }
        ]
      },
      {
        "num": "2.4",
        "title": "Erweiterte Eigenschaften von Spalten",
        "items": [
          {
            "q": "hide-keys",
            "marker": "1.",
            "title": "Fremdschlüssel ausblenden",
            "text": "Fremdschlüssel sollten immer ausgeblendet sein."
          },
          {
            "marker": "2.",
            "title": "Spalten der Faktentabelle ausblenden",
            "text": "Blenden Sie Spalten der Faktentabelle aus, die in Measures aggregiert werden."
          },
          {
            "q": "mark-pk-key",
            "marker": "3.",
            "title": "Primärschlüssel kennzeichnen",
            "text": "Setzen Sie für Primärschlüsselspalten die Eigenschaft „Key“ auf „True“."
          },
          {
            "q": "flags-format",
            "marker": "4.",
            "title": "Kennzeichenspalten als Yes/No formatieren",
            "text": "Yes/No liest sich leichter als 0/1."
          }
        ]
      },
      {
        "num": "2.5",
        "title": "Namenskonventionen",
        "items": [
          {
            "marker": "1.",
            "text": "Verwenden Sie {{naming-casing}} für sichtbare Objekte; Tabellenpräfixe: {{dim-fact-prefix}}."
          },
          {
            "marker": "2.",
            "text": "Objektnamen sollten nicht mit einem Leerzeichen beginnen oder enden."
          },
          {
            "marker": "3.",
            "text": "Sonderzeichen in Objektnamen: {{special-chars}}."
          },
          {
            "marker": "4.",
            "text": "Qualifizierung von Verweisen: {{reference-qualification}} (z. B. TableName[Column Name], [Measure Name])."
          },
          {
            "marker": "5.",
            "text": "Verweise auf Measures sollten unqualifiziert sein, z. B. [Measure Name]."
          },
          {
            "marker": "6.",
            "text": "Geben Sie Tabellen, Spalten und Measures sprechende fachliche Namen ohne allzu kurze Abkürzungen."
          },
          {
            "marker": "7.",
            "title": "Verwandte Measures ähnlich benennen",
            "text": "z. B. Target Frequency, Target Coverage, …",
            "children": [
              {
                "marker": "a.",
                "text": "AC, PY, PM, PL, YTD, MTD, ΔPY, ΔPY %, ΔPL, ΔPL %."
              },
              {
                "marker": "b.",
                "text": "avg. (vermeiden Sie „Ø“ im internationalen Umfeld)."
              },
              {
                "marker": "c.",
                "text": "Mio., k (vermeiden Sie „billion“ im deutschen Umfeld)."
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "report-design",
    "num": "3",
    "title": "Berichtsdesign",
    "icon": "report",
    "subs": [
      {
        "num": "3.1",
        "title": "Allgemeine Empfehlungen",
        "items": [
          {
            "marker": "1.",
            "text": "Verwenden Sie die Vorlage und das Design mit eingebettetem Hintergrund. Bauen Sie den Hintergrund nicht in Power BI aus Formen und Einzelelementen."
          },
          {
            "marker": "2.",
            "title": "Dreizeiligen Titel verwenden (oben links auf jeder Seite)",
            "text": "Machen Sie ihn wo möglich mit SELECTEDVALUE dynamisch.",
            "children": [
              {
                "marker": "a.",
                "text": "Unternehmen + Bereich."
              },
              {
                "marker": "b.",
                "text": "Kennzahlen fett, mit Einheit und Währung."
              },
              {
                "marker": "c.",
                "text": "Zeitraum."
              }
            ]
          },
          {
            "marker": "3.",
            "q": "filter-strategy",
            "title": "Filterbereich statt Datenschnitten im Bericht verwenden",
            "children": [
              {
                "marker": "a.",
                "text": "Ausnahme: Datenschnitte, die für die richtige Aussage entscheidend sind. Sie sollten wie ein Visualtitel wirken oder eng eingebunden sein (z. B. Feldparameter in einem transparenten Datenschnitt über Karten)."
              },
              {
                "marker": "b.",
                "text": "Setzen Sie Datenschnitte sparsam ein: Zu viele verlangsamen den Bericht drastisch."
              }
            ]
          },
          {
            "marker": "4.",
            "text": "Verwenden Sie eine Navigation im Bericht statt der eingebauten Navigation."
          },
          {
            "marker": "5.",
            "title": "Drei-Ebenen-Konzept",
            "text": "Gliedern Sie den Bericht in zwei, besser drei Ebenen:",
            "children": [
              {
                "marker": "a.",
                "text": "Überblick: alle Kennzahlen als Kacheln oder Karten, oder besser eine Tabelle mit prozentualen Abweichungen zum Ziel."
              },
              {
                "marker": "b.",
                "text": "Analyse: einzelne Kennzahl (oder Gruppe) mit Visualisierung."
              },
              {
                "marker": "c.",
                "text": "Details: Tabellen oder Small Multiples."
              }
            ]
          },
          {
            "marker": "6.",
            "title": "Power BI-Lesezeichen für Berichtsfunktionen vermeiden",
            "children": [
              {
                "marker": "a.",
                "text": "Verwenden Sie die Aktion „Seitennavigation“ auf Schaltflächen."
              },
              {
                "q": "reduce-measures",
                "marker": "b.",
                "text": "Verwenden Sie Feldparameter für Kennzahlen und Attribute."
              }
            ]
          },
          {
            "marker": "7.",
            "text": "Verwenden Sie Kreuzfilterung statt Kreuzhervorhebung."
          },
          {
            "marker": "8.",
            "title": "Eine Seitengröße für alle Berichte verwenden: {{page-size}}",
            "text": "Eine größere 16:9-Seite behält das Seitenverhältnis des Standards und bietet mehr Pixel.",
            "children": [
              {
                "marker": "a.",
                "text": "Kein Nachteil: Der Bericht kann fast gleich aussehen; das Standarddesign gleicht mit größerer Schrift aus."
              },
              {
                "marker": "b.",
                "text": "Nur Vorteile: Visuals können etwas kleiner werden, für mehr Informationsdichte ohne Verlust an Klarheit."
              }
            ]
          },
          {
            "marker": "9.",
            "title": "QuickInfos verwenden",
            "text": "Berichts-QuickInfos zeigen zusätzliche Information auf wenig Raum und erhöhen die Informationsdichte."
          },
          {
            "marker": "10.",
            "title": "Seiten zum Scrollen vermeiden",
            "text": "Nutzen Sie ein Navigationskonzept über mehrere Seiten; bei Visuals mit Scrollbalken fassen Sie kleine Segmente zu „Sonstige“ zusammen."
          },
          {
            "marker": "11.",
            "title": "Leistung benutzerdefinierter Visuals vor dem Einsatz testen",
            "text": "Nicht zertifizierte benutzerdefinierte Visuals werden vom Power BI-Team nicht getestet: Testen Sie sie in Desktop und im Dienst."
          },
          {
            "marker": "12.",
            "title": "Unnötige Interaktionen zwischen Visuals entfernen",
            "text": "Das verringert die Zahl der Abfragen an das Backend und verbessert die Leistung."
          }
        ]
      },
      {
        "num": "3.2",
        "title": "Visualisierung im Bericht: Mustererkennung",
        "intro": "Steigern Sie Effizienz und Wirkung von Berichten durch einheitliche visuelle Muster.",
        "items": [
          {
            "marker": "1.",
            "title": "Ausrichtung von Diagrammen",
            "children": [
              {
                "marker": "a.",
                "title": "Struktur → horizontale Diagramme",
                "children": [
                  {
                    "marker": "i.",
                    "text": "Horizontale Balkendiagramme (keine Säulendiagramme) mit mehreren Ebenen."
                  },
                  {
                    "marker": "ii.",
                    "text": "Tabellen."
                  }
                ]
              },
              {
                "marker": "b.",
                "title": "Zeit → vertikale Diagramme",
                "children": [
                  {
                    "marker": "i.",
                    "text": "Vertikale Säulendiagramme (mit integrierten Abweichungen)."
                  },
                  {
                    "marker": "ii.",
                    "text": "Liniendiagramme."
                  }
                ]
              }
            ]
          },
          {
            "q": "ibcs",
            "marker": "2.",
            "title": "Abweichungen in den Mittelpunkt stellen",
            "text": "Zu Plan, Vorperiode und/oder Prognose."
          },
          {
            "marker": "3.",
            "title": "Muster der Balken",
            "children": [
              {
                "marker": "a.",
                "text": "Gefüllte Farbe: Ist-Werte = AC."
              },
              {
                "marker": "b.",
                "text": "Hellere Füllung: Vorjahreswerte = PY."
              },
              {
                "marker": "c.",
                "text": "Umrandeter Balken: Planwerte = PL."
              }
            ]
          },
          {
            "marker": "4.",
            "title": "Visuals mit geringer Informationsdichte vermeiden",
            "text": "Vor allem Kreisdiagramme und Messgeräte (Gauges), aber auch Ringdiagramme, Treemaps, Mekko, Bullet Charts und Flächenkartogramme (wenn eine Karte wirklich nötig ist, setzen Sie darauf „proportionale Kreisdiagramme“)."
          },
          {
            "marker": "5.",
            "title": "Die „neue Karte“ verwenden",
            "children": [
              {
                "marker": "a.",
                "text": "Ein Visual statt vieler einzelner alter Karten."
              },
              {
                "marker": "b.",
                "text": "Vermeiden Sie „große Zahlen“ ohne Bezug: Ergänzen Sie Referenzbezeichnungen, besser Sparklines."
              }
            ]
          },
          {
            "marker": "6.",
            "title": "Farben sollen etwas bedeuten",
            "children": [
              {
                "marker": "a.",
                "text": "Setzen Sie Farbe gezielt ein."
              },
              {
                "marker": "b.",
                "text": "Reservieren Sie Rot und Grün für Abweichungen und färben Sie nach Wirkung, nicht nach Vorzeichen: Kosten, die gegenüber dem Vorjahr gestiegen sind, sind rot."
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "other",
    "num": "4",
    "title": "Sonstiges",
    "icon": "other",
    "subs": [
      {
        "num": "4.1",
        "title": "Wartung",
        "items": [
          {
            "marker": "1.",
            "title": "Updates von Power BI Desktop",
            "text": "Arbeiten Sie mit der aktuellen Version, um Abweichungen zur Live-Version oder zu Kolleginnen und Kollegen zu vermeiden."
          },
          {
            "marker": "2.",
            "title": "Verletzungen der referenziellen Integrität beheben",
            "text": "Stellen Sie sicher, dass die Primärschlüsselspalte der Zieltabelle alle Werte der Fremdschlüsselspalte der Ausgangstabelle enthält: Verletzungen erzeugen außerdem einen leeren Eintrag in Datenschnitten."
          },
          {
            "q": "gateway",
            "marker": "3.",
            "title": "Lokales Datengateway statt persönlichem Gateway verwenden",
            "text": "Das Standardgateway wird zentral verwaltet, kann von vielen gemeinsam genutzt werden und bedient auch Direct Query und Liveverbindungen. Der persönliche Modus bedient nur Import und gehört einer Person (gilt, wenn die Quelle lokal liegt)."
          }
        ]
      },
      {
        "num": "4.2",
        "title": "Leistung",
        "items": [
          {
            "marker": "1.",
            "title": "Aggregationen mit Direct Query erwägen",
            "text": "Bei Direct Query in Power BI Premium können Aggregationen die Leistung steigern."
          },
          {
            "marker": "2.",
            "title": "Prüfen, ob dynamische RLS nötig ist",
            "text": "Dynamische Sicherheit auf Zeilenebene kostet Speicher und Leistung: Wägen Sie Nutzen und Aufwand ab."
          }
        ]
      },
      {
        "num": "4.3",
        "title": "Anhang: Namens- und Modellierungskonventionen im Detail",
        "items": [
          {
            "marker": "",
            "title": "Sichtbare Objekte",
            "children": [
              {
                "marker": "•",
                "text": "Wörter in sichtbaren Objekten durch Leerzeichen getrennt: {{words-spaces}}."
              },
              {
                "marker": "•",
                "text": "Schreibweise aller sichtbaren Objekte: {{naming-casing}}."
              },
              {
                "marker": "•",
                "text": "Unzulässige Zeichen: [ ] { } ' \" = & * : ; . / \\ # @ ! _ = ^."
              },
              {
                "marker": "•",
                "title": "Eingeschränkte Wörter",
                "children": [
                  {
                    "q": "reserved-words",
                    "marker": "•",
                    "text": "Reservierte Wörter wie Table, Measure, Column, KPI (außer „Hierarchy“ in Hierarchien)."
                  },
                  {
                    "marker": "•",
                    "text": "„Total“, um Doppelungen in Summen zu vermeiden."
                  },
                  {
                    "marker": "•",
                    "text": "„Is“, für klarere Spaltennamen."
                  },
                  {
                    "marker": "•",
                    "text": "„Amount“, „Value“, weil oft überflüssig."
                  },
                  {
                    "marker": "•",
                    "text": "„Name“, außer wo nötig, wie in „Customer Name“."
                  },
                  {
                    "marker": "•",
                    "text": "Vermeiden Sie „Hierarchy“ in Tabellennamen."
                  }
                ]
              }
            ]
          },
          {
            "marker": "",
            "title": "Kalenderdimension",
            "children": [
              {
                "marker": "•",
                "text": "Muss als Datumstabelle markiert sein."
              },
              {
                "q": "date-key-format",
                "marker": "•",
                "text": "Der Primärschlüssel (DateId) sollte INTEGER im Format YYYYMMDD sein."
              },
              {
                "marker": "•",
                "text": "Datum und Uhrzeit müssen getrennt sein: Kalender mit Granularität „Tag“, Uhrzeit feiner."
              }
            ]
          },
          {
            "marker": "",
            "title": "Namenskonventionen nach Tabellentyp",
            "children": [
              {
                "q": "db-type-prefixes",
                "marker": "•",
                "text": "Faktentabelle (z. B. Revenue im Modell, FACT_Revenue in der Datenbank)."
              },
              {
                "marker": "•",
                "text": "Dimensionstabelle (z. B. Geography im Modell, DIM_Geography in der Datenbank)."
              },
              {
                "marker": "•",
                "text": "Brückentabelle (z. B. GeographyBridge im Modell, BRIDGE_Geography in der Datenbank)."
              },
              {
                "marker": "•",
                "text": "Sicherheitstabelle (z. B. UserGeography im Modell, SEC_UserGeography in der Datenbank)."
              },
              {
                "marker": "•",
                "text": "Metadatentabelle (z. B. Data Dictionary im Modell, META_DataDictionary in der Datenbank)."
              },
              {
                "marker": "•",
                "text": "Beachten Sie: GeographyBridge und UserGeography enthalten keine Leerzeichen."
              }
            ]
          },
          {
            "marker": "",
            "title": "Ausgeblendete & private Tabellen",
            "children": [
              {
                "marker": "•",
                "text": "Ausgeblendete Tabellen lassen sich mit der Eigenschaft „private“ in Tabular Editor vollständig aus dem semantischen Modell nehmen. Das darf nicht zum Absichern von Tabellen dienen: IntelliSense greift dort nicht, aber Benutzer könnten trotzdem Measures darauf schreiben. Nutzen Sie es für Brücken- oder Benutzerrollentabellen, nie für ausgeblendete Faktentabellen (die nicht privat bleiben sollten, damit berichtsspezifische Measures möglich sind)."
              }
            ]
          },
          {
            "marker": "",
            "title": "Partitionen & Sichten",
            "children": [
              {
                "marker": "•",
                "text": "Bei Tabellen mit einer Partition sollten Partition und Tabelle gleich heißen."
              },
              {
                "marker": "•",
                "text": "Nutzen Sie einfache Sichten für schnelle Entwicklung und Flexibilität."
              },
              {
                "marker": "•",
                "text": "Sichten dürfen keine Logik enthalten: Logik gehört in gespeicherte Prozeduren."
              },
              {
                "marker": "•",
                "text": "Das Schema der Sichten sollte den Modellnamen gefolgt von „View“ tragen."
              },
              {
                "marker": "•",
                "text": "Bei Tabellen mit mehreren Partitionen müssen die Partitionsnamen mit dem Tabellennamen beginnen (z. B. Revenue FY19, Revenue FY19-Q1, Revenue FY19-M01)."
              },
              {
                "marker": "•",
                "text": "Partitioniert wird in der Datenbankschicht: Das ist effizienter und vereinfacht Abfragen."
              }
            ]
          },
          {
            "marker": "",
            "title": "Datentypen & Eigenschaften von Spalten",
            "children": [
              {
                "marker": "•",
                "text": "Kennzeichen müssen vom Datentyp STRING sein, mit Werten wie Yes, No, N/A, Unknown."
              },
              {
                "q": "pk-format",
                "marker": "•",
                "text": "Primärschlüssel sollten INTEGER sein, auf „ID“ enden, als Key markiert und in der Regel ausgeblendet sein."
              },
              {
                "marker": "•",
                "text": "Fremdschlüssel müssen ebenfalls INTEGER sein, auf „ID“ enden, ausgeblendet sein und wie der Primärschlüssel heißen."
              },
              {
                "q": "sortby-columns",
                "marker": "•",
                "text": "Sortierspalten brauchen den Datentyp INTEGER und sollten ausgeblendet sein."
              },
              {
                "marker": "•",
                "text": "Aggregierbare Spalten sollten INTEGER, CURRENCY oder DECIMAL sein, ausgeblendet, und ein Measure erhalten."
              },
              {
                "q": "nonagg-summarize",
                "marker": "•",
                "text": "Nicht aggregierbare Ganzzahlspalten sollten auf „None“ bzw. „Nicht zusammenfassen“ stehen."
              },
              {
                "marker": "•",
                "text": "Spalten in der Datenbankschicht sollten keine Leerzeichen enthalten: Leerzeichen kommen im Modell hinzu."
              },
              {
                "marker": "•",
                "text": "Primärschlüssel der Dimensionstabellen sollten zu den Fremdschlüsseln der Faktentabellen passen, ohne leere Einträge."
              },
              {
                "q": "weburl-category",
                "marker": "•",
                "text": "Kennzeichnen Sie URLs in den Spalteneigenschaften als WebURL."
              },
              {
                "marker": "•",
                "text": "Wenden Sie Formatregeln für Währung, ganze Zahlen und Prozentwerte an."
              }
            ]
          },
          {
            "marker": "",
            "title": "Benennung von Measures",
            "children": [
              {
                "marker": "•",
                "text": "Kurz und sprechend."
              },
              {
                "marker": "•",
                "text": "Präfixe wie Avg."
              },
              {
                "q": "measure-suffixes",
                "marker": "•",
                "text": "Suffixe wie PY, PQ, PM, YTD, TTM, VTB."
              },
              {
                "marker": "•",
                "text": "Verweise auf Measures tragen kein Tabellenpräfix."
              }
            ]
          },
          {
            "marker": "",
            "title": "Hierarchien",
            "children": [
              {
                "marker": "•",
                "text": "Müssen auf „Hierarchy“ enden."
              },
              {
                "marker": "•",
                "text": "Attribute müssen wie die Spalten außerhalb der Hierarchie heißen."
              },
              {
                "marker": "•",
                "text": "Die Reihenfolge sollte den natürlichen Ebenen der Hierarchie folgen."
              },
              {
                "marker": "•",
                "text": "Das erleichtert die Arbeit mit externen Werkzeugen wie Tabular Editor."
              }
            ]
          },
          {
            "marker": "",
            "title": "Rollen, Ordner & Verbindungen",
            "children": [
              {
                "marker": "•",
                "text": "Rollen dürfen nicht dazu dienen, Teile des semantischen Modells abzusichern: Nutzen Sie OLS oder besser RLS. Achten Sie darauf, dass sich Rollenmitglieder nicht zwischen Rollen überschneiden, um Fehler und unberechtigte Einsicht zu vermeiden."
              },
              {
                "marker": "•",
                "text": "Anzeigeordner gruppieren zwei oder mehr Measures oder Spalten derselben Tabelle; mehrere Ordnerebenen sollten der Einteilung der Benutzer folgen."
              },
              {
                "marker": "•",
                "text": "Namen von Verbindungszeichenfolgen sollten drei Bestandteile haben: Provider, Data Source, Initial Catalog."
              }
            ]
          },
          {
            "marker": "",
            "title": "Abkürzungen",
            "children": [
              {
                "marker": "•",
                "text": "Legen Sie Abkürzungen fest wie YoY, QoQ, MoM, YTD, QTD, MTD, PY, PQ, PM, TTM (letzte 12 Monate), VTB (Abweichung zum Budget) und VTF (Abweichung zur Prognose)."
              },
              {
                "marker": "•",
                "text": "Statt PY für das Vorjahr ist auch Y-1 zulässig: wichtig, wenn Y-2 eine fachlich relevante Kennzahl ist."
              },
              {
                "marker": "•",
                "text": "Für Ziel- und Budgetwerte wird oft „PL“ statt BUD bevorzugt (BU könnte mit Business Unit verwechselt werden, und ein dreistelliges BUD passt schlecht zum zweistelligen PY)."
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "tabular-style-guide",
    "num": "5",
    "title": "Tabular Style Guide",
    "icon": "style",
    "subs": [
      {
        "num": "5.0",
        "title": "Über diesen Leitfaden",
        "intro": "Ein weit verbreiteter Standard für Namen und Formate in tabellarischen Modellen von Michael Kovalsky (Elegant BI). Ein Modell ist Teil der Oberfläche: Menschen sehen seine Tabellen, Spalten und Measures, also sollten Namen und Formate für sie gemacht sein. Viele dieser Regeln lassen sich mit dem Best Practice Analyzer automatisch prüfen.",
        "link": {
          "label": "elegantbi.com: Tabular Style Guide",
          "href": "https://www.elegantbi.com/post/tabularstyleguide"
        },
        "items": []
      },
      {
        "num": "5.1",
        "title": "Allgemeine Regeln (alle Objekte)",
        "items": [
          {
            "marker": "•",
            "text": "Trennen Sie Wörter in allen sichtbaren Objekten immer durch Leerzeichen."
          },
          {
            "marker": "•",
            "text": "Verwenden Sie immer Title Case."
          },
          {
            "marker": "•",
            "text": "Vermeiden Sie diese Zeichen: [ ] { } ' \" = & * : ; . / \\ # @ ! _ = ^."
          },
          {
            "marker": "•",
            "title": "Diese Wörter vermeiden",
            "children": [
              {
                "marker": "•",
                "text": "Reservierte Wörter (Table, Measure, Column, KPI): außer einer Hierarchie namens „Hierarchy“."
              },
              {
                "marker": "•",
                "text": "„Total“: vermeidet Zwischen- und Gesamtsummen der Art „Total Total…“."
              },
              {
                "marker": "•",
                "text": "„Is“: vermeidet Spalten wie „IsActive“ statt „Active Flag“."
              },
              {
                "marker": "•",
                "text": "„Amount“, „Value“: oft überflüssig (ein Measure „Sales Amount“ kann einfach „Sales“ heißen)."
              },
              {
                "marker": "•",
                "text": "„Name“: manchmal zulässig („Customer Name“), aber oft überflüssig („Region Name“ → „Region“)."
              }
            ]
          }
        ]
      },
      {
        "num": "5.2",
        "title": "Tabellen",
        "items": [
          {
            "marker": "•",
            "text": "Vermeiden Sie das Wort „Hierarchy“ in Tabellennamen."
          },
          {
            "marker": "•",
            "title": "Kalenderdimension",
            "children": [
              {
                "marker": "•",
                "text": "Immer als Datumstabelle markieren."
              },
              {
                "marker": "•",
                "text": "Der Primärschlüssel (DateId) muss vom Datentyp INTEGER im Format YYYYMMDD sein."
              },
              {
                "marker": "•",
                "text": "Datum und Uhrzeit immer trennen (Kalender mit Granularität „Tag“; Uhrzeit feiner, z. B. Stunde oder Minute)."
              }
            ]
          },
          {
            "marker": "•",
            "title": "Fünf Tabellentypen",
            "text": "Name im Modell → Name der Sicht in der Datenbank:",
            "children": [
              {
                "marker": "•",
                "text": "Fakten: Revenue → FACT_Revenue."
              },
              {
                "marker": "•",
                "text": "Dimension: Geography → DIM_Geography."
              },
              {
                "marker": "•",
                "text": "Brücke: GeographyBridge → BRIDGE_Geography."
              },
              {
                "marker": "•",
                "text": "Sicherheit: UserGeography → SEC_UserGeography."
              },
              {
                "marker": "•",
                "text": "Metadaten: Data Dictionary → META_DataDictionary."
              },
              {
                "marker": "•",
                "text": "Hinweis: GeographyBridge und UserGeography haben keine Leerzeichen: zulässig, weil sie ausgeblendet sind."
              }
            ]
          }
        ]
      },
      {
        "num": "5.3",
        "title": "Partitionen",
        "items": [
          {
            "marker": "•",
            "title": "Bei Tabellen mit einer Partition muss die Partition wie die Tabelle heißen",
            "children": [
              {
                "marker": "•",
                "text": "Nutzen Sie immer einfache Sichten (SELECT * FROM [Schema].[View]). Sichten entkoppeln die Datenbankschicht vom Modell, erlauben schnelle Änderungen, lassen mehrere Modelle dieselbe Tabelle abfragen und beschleunigen die Entwicklung deutlich: besonders in Tabular Editor."
              },
              {
                "marker": "•",
                "text": "Sichten sollten keine Logik enthalten: Sämtliche Logik gehört in gespeicherte Prozeduren bzw. die Datenbankschicht."
              },
              {
                "marker": "•",
                "text": "Das Schema der Sichten sollte der (abgekürzte) Modellname mit angehängtem „View“ sein (z. B. WWIView für das Modell Worldwide Importers)."
              }
            ]
          },
          {
            "marker": "•",
            "title": "Bei Tabellen mit mehreren Partitionen müssen die Partitionsnamen mit dem Tabellennamen beginnen",
            "children": [
              {
                "marker": "•",
                "text": "Beispiele (Tabelle = Revenue): Revenue FY19, Revenue FY20; Revenue FY19-Q1, Revenue FY19-Q2; Revenue FY19-M01, Revenue FY19-M02."
              },
              {
                "marker": "•",
                "text": "Partitionieren Sie auch in der Datenbankschicht: Das erlaubt paralleles Erstellen (spart Zeit) und einfache Abfragen mit SELECT *, oder den Aufruf einer gespeicherten Prozedur mit Parameterfilter."
              }
            ]
          }
        ]
      },
      {
        "num": "5.4",
        "title": "Spalten",
        "items": [
          {
            "marker": "•",
            "title": "Kennzeichen",
            "children": [
              {
                "marker": "•",
                "text": "Müssen vom Datentyp STRING sein."
              },
              {
                "marker": "•",
                "text": "Gültige Werte: Yes, No, N/A, Unknown."
              },
              {
                "marker": "•",
                "text": "Nie 0/1 oder Y/N verwenden."
              },
              {
                "marker": "•",
                "text": "Müssen als Kennzeichen benannt sein (z. B. „Active Flag“)."
              }
            ]
          },
          {
            "marker": "•",
            "title": "Primärschlüssel",
            "children": [
              {
                "marker": "•",
                "text": "Datentyp INTEGER, enden auf „ID“, Key = True in den Eigenschaften, in der Regel ausgeblendet, außer Endbenutzer brauchen sie."
              }
            ]
          },
          {
            "marker": "•",
            "title": "Fremdschlüssel",
            "children": [
              {
                "marker": "•",
                "text": "Datentyp INTEGER, enden auf „ID“, immer ausgeblendet, heißen wie der zugehörige Primärschlüssel."
              }
            ]
          },
          {
            "marker": "•",
            "title": "Sortierspalten",
            "text": "Datentyp INTEGER, müssen ausgeblendet sein."
          },
          {
            "marker": "•",
            "title": "Aggregierbare Spalten",
            "text": "INTEGER, CURRENCY oder DECIMAL; ausgeblendet, mit einem Measure auf der Spalte; keine Leerzeichen im Spaltennamen."
          },
          {
            "marker": "•",
            "title": "Nicht aggregierbare Ganzzahlspalten",
            "text": "Setzen Sie „Summarize By“ auf „None“ bzw. „Nicht zusammenfassen“, damit sie nie versehentlich aggregiert werden."
          },
          {
            "marker": "•",
            "text": "Spalten in der Datenbankschicht (einschließlich Sichten) sollten keine Leerzeichen enthalten: Leerzeichen kommen in der Eigenschaft „Name“ des Modells hinzu."
          },
          {
            "marker": "•",
            "title": "Verweise",
            "text": "Spalten, auf die Measures verweisen, tragen immer das Tabellenpräfix."
          },
          {
            "marker": "•",
            "text": "Primärschlüssel der Dimensionstabellen sollten alle Werte der Fremdschlüssel jeder verbundenen Faktentabelle enthalten: keine leeren Einträge."
          },
          {
            "marker": "•",
            "text": "Kennzeichnen Sie URLs und Hyperlinks in den Spalteneigenschaften mit Datenkategorie = WebURL."
          }
        ]
      },
      {
        "num": "5.5",
        "title": "Measures",
        "items": [
          {
            "marker": "•",
            "title": "Formatierung",
            "children": [
              {
                "q": "currency-format",
                "marker": "•",
                "text": "Währung, keine Dezimalstellen ($32,000): \\$#,0;(\\$#,0);\\$#,0"
              },
              {
                "q": "whole-decimals",
                "marker": "•",
                "text": "Ganze Zahl, keine Dezimalstellen, Tausendertrennzeichen (32,000): #,0. Eine Dezimalstelle (#,0.0) nur wenn nötig, nie beim Zählen (z. B. Kunden)."
              },
              {
                "q": "percent-format",
                "marker": "•",
                "text": "Prozent, eine Dezimalstelle, Tausendertrennzeichen (3,200.1%): #,0.0%;-#,0.0%;#,0.0%. So wenige Dezimalstellen wie möglich."
              }
            ]
          },
          {
            "marker": "•",
            "title": "Benennung",
            "children": [
              {
                "marker": "•",
                "text": "Sprechend, aber so kurz wie möglich."
              },
              {
                "marker": "•",
                "text": "Präfixe: Avg; Produktangaben (z. B. Azure …)."
              },
              {
                "marker": "•",
                "text": "Suffixe: YoY, QoQ, MoM, YTD, QTD, MTD, PY, PQ, PM, TTM, VTB, VTF; YoY %, QoQ %, MoM %. Das %-Zeichen steht immer am Ende."
              },
              {
                "marker": "•",
                "text": "Beispiele: Billed Revenue · Billed Revenue PM · Billed Revenue MoM % · Billed Revenue YoY · Billed Revenue YTD PY · Billed Revenue YTD YoY % · Azure Billed Revenue Customer Count TTM."
              }
            ]
          },
          {
            "marker": "•",
            "title": "Verweise",
            "text": "Measures, auf die andere Measures verweisen, tragen nie das Tabellenpräfix."
          },
          {
            "marker": "•",
            "title": "Abkürzungen im Überblick",
            "text": "YoY = Jahr gegen Vorjahr · QoQ = Quartal gegen Vorquartal · MoM = Monat gegen Vormonat · YTD/QTD/MTD = seit Jahres-, Quartals-, Monatsbeginn · PY/PQ/PM = Vorjahr, Vorquartal, Vormonat · TTM = letzte 12 Monate · VTB = Abweichung zum Budget · VTF = Abweichung zur Prognose."
          }
        ]
      },
      {
        "num": "5.6",
        "title": "Hierarchien",
        "items": [
          {
            "marker": "•",
            "text": "Müssen das Suffix „Hierarchy“ tragen (z. B. „Geography Hierarchy“)."
          },
          {
            "marker": "•",
            "text": "Attribute der Hierarchie müssen wie die jeweiligen Spalten außerhalb der Hierarchie heißen."
          },
          {
            "marker": "•",
            "text": "Die Reihenfolge muss der natürlichen Ordnung der Hierarchie entsprechen (Granularität, Drilldown)."
          }
        ]
      },
      {
        "num": "5.7",
        "title": "Beziehungen, Datenquellen, Perspektiven & Rollen",
        "items": [
          {
            "marker": "•",
            "title": "Beziehungen",
            "text": "Werden automatisch benannt: keine Namensregeln nötig."
          },
          {
            "marker": "•",
            "title": "Datenquellen",
            "text": "Drei Bestandteile: Provider, Data Source, Initial Catalog (z. B. „SqlServer ServerName DatabaseName“)."
          },
          {
            "marker": "•",
            "title": "Perspektiven",
            "text": "Keine zusätzlichen Regeln über die allgemeinen hinaus."
          },
          {
            "marker": "•",
            "title": "Rollen",
            "text": "Rollenmitglieder dürfen sich nicht zwischen Rollen überschneiden: Überschneidungen können Fehler verursachen oder Daten zeigen, die jemand nicht sehen soll."
          }
        ]
      },
      {
        "num": "5.8",
        "title": "Anzeigeordner",
        "items": [
          {
            "marker": "•",
            "text": "Ordner können zwei oder mehr Measures oder Spalten derselben Tabelle gruppieren."
          },
          {
            "marker": "•",
            "text": "Bei mehreren Ordnerebenen (Drill) gliedern Sie so, wie Ihre Benutzer diese Measures und Spalten einteilen."
          }
        ]
      }
    ]
  }
];
