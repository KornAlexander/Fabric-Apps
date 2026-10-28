// erzeugt von `dwg app page` aus der App-Spec „Caldova GuV“, nicht von Hand ändern.
import type { DwgPageSpec } from '../dwg-page';

export const page: DwgPageSpec = {
  "name": "GuV Statement",
  "id": "statement",
  "template": "T03A",
  "description": "Wie steht die GuV im laufenden Jahr gegenüber Vorjahr und Plan, Zeile für Zeile bis zum Jahresergebnis?",
  "width": 1920,
  "height": 1080,
  "background": "#F4F4F1",
  "zones": {
    "header": {
      "x": 0,
      "y": 0,
      "w": 1920,
      "h": 96
    },
    "footer": {
      "x": 0,
      "y": 1044,
      "w": 1920,
      "h": 36
    },
    "content": {
      "x": 27,
      "y": 123,
      "w": 1866,
      "h": 894
    }
  },
  "filters": [
    {
      "column": "'Calender'[Year]",
      "values": [
        2026
      ]
    },
    {
      "column": "'Calender'[Month]",
      "values": [
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9
      ]
    }
  ],
  "tiles": [
    {
      "id": "statement",
      "visual": "pnl",
      "rect": [
        27,
        123,
        1866,
        894
      ],
      "bindings": {
        "levels": [
          "'dim-konten'[L1]",
          "'dim-konten'[L2]",
          "'dim-konten'[L3]"
        ],
        "account": "'dim-konten'[AccountID]",
        "accountName": "'dim-konten'[Name]",
        "sortOrder": "'dim-konten'[SortOrder]",
        "rowType": "'dim-konten'[RowType]",
        "formulaDef": "'dim-konten'[FormulaDef]",
        "signConvention": "'dim-konten'[SignConvention]",
        "displayInvert": "'dim-konten'[DisplayInvert]",
        "varianceInvert": "'dim-konten'[VarianceInvert]",
        "comment": "'dim-konten'[Kommentar]",
        "ac": "'fact-guv'[GuV AC]",
        "py": "'fact-guv'[GuV PY]",
        "pl": "'fact-guv'[GuV PL]"
      },
      "objects": {
        "titleBlock": {
          "unitLine": "Caldova Logistikzentrum Köln",
          "measureLine": "GuV in Tsd. EUR",
          "periodLine": "Jan..Sep 2026 (YTD), AC gegen PY und PL"
        },
        "columns": {
          "template": "T03A",
          "templateApplied": "T03A",
          "minuend": "ac",
          "showPY": true,
          "showPL": true,
          "showMinuend": true,
          "valueCascade": false,
          "dPyAbs": true,
          "dPyBar": false,
          "dPyWaterfall": false,
          "dPyPct": true,
          "dPyPin": false,
          "dPlAbs": true,
          "dPlBar": false,
          "dPlWaterfall": false,
          "dPlPct": true,
          "dPlPin": false,
          "secondBlock": false,
          "structureSubtotals": true,
          "showPctRows": true,
          "thresholds": false,
          "scenarioMarks": true,
          "chartLabels": true,
          "capBars": false,
          "sort": "cat",
          "sortBlock": "ytd",
          "blockKind": "ytd",
          "leftBlockKind": "month",
          "pctRevenue": false
        },
        "numbers": {
          "scaling": "k",
          "decimals": 0,
          "pctDecimals": 1,
          "unitText": "EUR"
        },
        "hierarchy": {
          "defaultLevel": 2
        },
        "toolbar": {
          "show": true,
          "showLegend": true,
          "foldable": true,
          "startFolded": false
        },
        "style": {
          "fontPreset": "fullhd",
          "density": "compact"
        }
      }
    }
  ]
};
