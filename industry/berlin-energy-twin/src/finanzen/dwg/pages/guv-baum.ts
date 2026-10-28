// erzeugt von `dwg app page` aus der App-Spec „Caldova GuV“, nicht von Hand ändern.
import type { DwgPageSpec } from '../dwg-page';

export const page: DwgPageSpec = {
  "name": "GuV Baum",
  "id": "baum",
  "description": "Wie entsteht das Jahresergebnis aus Umsatz und Kosten, und welche Zweige weichen vom Plan ab?",
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
      "id": "baum",
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
        "pl": "'fact-guv'[GuV PL]",
        "fc": "'fact-guv'[GuV FC]",
        "fcFy": "'fact-guv'[GuV FC FY]",
        "plFy": "'fact-guv'[GuV PL FY]"
      },
      "objects": {
        "titleBlock": {
          "unitLine": "Caldova Logistikzentrum Köln",
          "measureLine": "GuV als Werttreiberbaum in Tsd. EUR",
          "periodLine": "Jan..Sep 2026 (YTD), AC gegen PL"
        },
        "numbers": {
          "scaling": "k",
          "decimals": 0,
          "pctDecimals": 1,
          "unitText": "EUR"
        },
        "state": {
          "uiState": "{\"view\":\"tree\",\"preset\":\"acref\",\"ref\":\"pl\",\"unit\":\"k\",\"density\":\"compact\",\"pctRev\":false,\"hideZero\":true,\"fit\":false,\"collapsed\":[],\"spark\":[],\"treeRoot\":\"\",\"treeCollapsed\":[\"L:Wareneinsatz\",\"L:Sonstiges betriebliches Ergebnis\",\"L:Abschreibungen\",\"L:Finanzergebnis\",\"L:Steuern vom Einkommen und vom Ertrag\",\"L:Betriebliche Aufwendungen¦Raumkosten\",\"L:Betriebliche Aufwendungen¦Sonstige Aufwendungen\"],\"treeStatus\":true,\"treeV\":2}"
        },
        "toolbar": {
          "show": true,
          "showLegend": true,
          "showLevels": true
        },
        "style": {
          "fontPreset": "fullhd"
        }
      }
    }
  ]
};
