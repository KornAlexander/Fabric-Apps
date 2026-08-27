"""Build the inlined dataset (hi_appdata.json) from the two DAX extracts.

Reads hi_stud.json + hi_anf.json (produced by hi_dax.ps1) from this folder,
cleans Hochschule names, assigns Bundesland colours, and writes a compact
hi_appdata.json. Run inject.py afterwards to embed it into ../../index.html.
"""
import json, re, os

HERE = os.path.dirname(os.path.abspath(__file__))
STUD = os.path.join(HERE, "hi_stud.json")
ANF  = os.path.join(HERE, "hi_anf.json")
FIN  = os.path.join(HERE, "hi_finanzen.json")
COORDS = os.path.join(HERE, "hi_coords.json")
OUT  = os.path.join(HERE, "hi_appdata.json")

SEM = ["WS 2019/20","WS 2020/21","WS 2021/22","WS 2022/23","WS 2023/24","WS 2024/25"]
SEM_SHORT = ["19/20","20/21","21/22","22/23","23/24","24/25"]
si = {s: i for i, s in enumerate(SEM)}


def clean_name(name, city):
    n = name.strip()
    while True:
        n2 = re.sub(r'\s*\([^)]*\)\s*$', '', n).strip()
        if n2 == n:
            break
        n = n2
    if city:
        n = re.sub(r'\s+in\s+' + re.escape(city) + r'\b.*$', '', n).strip()
    n = re.sub(r'\s+in\s+[A-ZÄÖÜ][\wäöüß.\-/ ]+$', '', n).strip()
    for pat, r in [(r'^U\s+', 'Universität '), (r'^TU\s+', 'Technische Universität '),
                   (r'^TH\s+', 'Technische Hochschule '), (r'^PH\s+', 'Pädagogische Hochschule '),
                   (r'^KunstH\s+', 'Kunsthochschule '), (r'^MusikH\s+', 'Musikhochschule '),
                   (r'^KHS\s+', 'Kunsthochschule '), (r'^FH\s+', 'Hochschule '), (r'^HS\s+', 'Hochschule ')]:
        if re.match(pat, n):
            n = re.sub(pat, r, n)
            break
    return n


stud = json.load(open(STUD, encoding="utf-8"))
anf = json.load(open(ANF, encoding="utf-8"))
coords = json.load(open(COORDS, encoding="utf-8")) if os.path.exists(COORDS) else []
finance = json.load(open(FIN, encoding="utf-8")) if os.path.exists(FIN) else []

# code -> (lat, lon) for the Studenten maps
COORD = {}
for r in coords:
    lat, lon = r.get("[lat]"), r.get("[lon]")
    if lat is not None and lon is not None:
        COORD[r["Hochschulen[Hochschule_Code]"]] = [round(float(lat), 5), round(float(lon), 5)]

# --- per-campus (Hochschule_Code) records; keep granularity for Bundesland/Stadt ---
uni = {}
for r in stud:
    code = r["Hochschulen[Hochschule_Code]"]
    if code not in uni:
        uni[code] = {"c": code, "n": clean_name(r["Hochschulen[Hochschule]"], r["Hochschulen[Stadt]"]),
                     "city": r["Hochschulen[Stadt]"] or "Unbekannt",
                     "bl": r["Hochschulen[Bundesland]"] or "Ohne Zuordnung",
                     "parent": (r.get("Hochschulen[Parent_University]") or "").strip(),
                     "t": [0]*6, "i": [0]*6, "w": [0]*6, "a": [0]*6}
    k = si.get(r["Studierende[Wintersemester]"])
    if k is None:
        continue
    uni[code]["t"][k] = int(round(r.get("[total]") or 0))
    uni[code]["i"][k] = int(round(r.get("[intl]") or 0))
    uni[code]["w"][k] = int(round(r.get("[weib]") or 0))

for r in anf:
    code = r["Studienanfänger[Hochschule_Code]"]
    if code not in uni:
        continue
    k = si.get(r["Studienanfänger[Wintersemester]"])
    if k is None:
        continue
    uni[code]["a"][k] = int(round(r.get("[anf]") or 0))

# --- consolidating parents: a Parent_University that spans >=2 campuses with data
#     (e.g. IU Internationale Hochschule, Hochschule Fresenius). The Hochschule
#     dimension groups these campuses under the parent; Bundesland/Stadt stay
#     per-campus (accurate geography). Tagged via the optional "g" field. ---
from collections import defaultdict
parent_codes = defaultdict(list)
for u in uni.values():
    if u["parent"]:
        parent_codes[u["parent"]].append(u)
CONSOLIDATE = {p for p, us in parent_codes.items()
               if sum(1 for u in us if max(u["t"]) > 0) >= 2}
for u in uni.values():
    if u["parent"] in CONSOLIDATE:
        u["g"] = u["parent"]          # group label for the Hochschule dimension

unis = []
for u in uni.values():
    if max(u["t"]) == 0:
        continue
    rec = {"c": u["c"], "n": u["n"], "city": u["city"], "bl": u["bl"],
           "t": u["t"], "i": u["i"], "w": u["w"], "a": u["a"]}
    if "g" in u:
        rec["g"] = u["g"]
    ll = COORD.get(u["c"])
    if ll:
        rec["lat"], rec["lon"] = ll[0], ll[1]
    unis.append(rec)
unis.sort(key=lambda u: max(u["t"]), reverse=True)
print("Consolidated parents:", sorted(CONSOLIDATE))

BL_COLORS = {
    "Baden-Württemberg": "#2E86C1", "Bayern": "#16A2B8", "Berlin": "#E0529C",
    "Brandenburg": "#8E44AD", "Bremen": "#E67E22", "Hamburg": "#27AE60",
    "Hessen": "#F5B041", "Mecklenburg-Vorpommern": "#5DADE2", "Niedersachsen": "#CB4335",
    "Nordrhein-Westfalen": "#1ABC9C", "Rheinland-Pfalz": "#AF7AC5", "Saarland": "#F1948A",
    "Sachsen": "#48C9B0", "Sachsen-Anhalt": "#F8C471", "Schleswig-Holstein": "#7FB3D5",
    "Thüringen": "#EC7063", "Ohne Zuordnung": "#95A5A6",
}

# --- finance by Bundesland x year (EUR); fin[bl][year] = [ein,aus,dm,trg] ---
fin = {}
fin_years = set()
for r in finance:
    bl = r.get("Bundesland[Bundesland]")
    yr = r.get("Hochschulfinanzen[Jahr]")
    if not bl or not yr:
        continue
    y = int(str(yr)[:4])
    fin_years.add(y)
    fin.setdefault(bl, {})[str(y)] = [
        int(round(r.get("[ein]") or 0)),
        int(round(r.get("[aus]") or 0)),
        int(round(r.get("[dm]")  or 0)),
        int(round(r.get("[trg]") or 0)),
    ]
fin_years = sorted(fin_years)

data = {"sem": SEM, "semShort": SEM_SHORT, "blColors": BL_COLORS, "unis": unis,
        "fin": fin, "finYears": fin_years, "finKeys": ["ein", "aus", "dm", "trg"]}
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
print(f"Universities kept: {len(unis)}  with coords: {sum(1 for u in unis if 'lat' in u)}")
print(f"Finance: {len(fin)} Bundeslaender x years {fin_years}  file KB: {round(os.path.getsize(OUT)/1024,1)}")
