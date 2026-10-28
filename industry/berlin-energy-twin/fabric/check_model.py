"""Agreement check: the model open in Power BI Desktop against the app's own figures.

fabric/build/expected.json is written by `npm run export:model` from the app's
functions; this script queries the refreshed model through the local engine
(fabric/query_desktop.ps1) and fails on any difference.

    python fabric/check_model.py <port>
"""
from __future__ import annotations

import csv
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
BUILD = HERE / "build"
sys.path.insert(0, str(HERE))
from gen_model import TABLES  # noqa: E402
from measures import MEASURES  # noqa: E402


def dax(port: int, query: str) -> list[dict]:
    f = BUILD / "_query.dax"
    f.write_text(query, encoding="utf-8")
    out = subprocess.run(
        ["pwsh", "-NoProfile", "-File", str(HERE / "query_desktop.ps1"), "-Port", str(port), "-DaxFile", str(f)],
        capture_output=True, text=True, encoding="utf-8",
    )
    if out.returncode:
        raise SystemExit(out.stderr or out.stdout)
    data = json.loads(out.stdout or "[]")
    rows = data if isinstance(data, list) else [data]
    return [{k.split("[")[-1].rstrip("]"): v for k, v in r.items()} for r in rows]


def tq(name: str) -> str:
    return "'" + name.replace("'", "''") + "'"


def main(port: int) -> None:
    exp = json.loads((BUILD / "expected.json").read_text(encoding="utf-8"))
    fails: list[str] = []

    def same(label: str, got, want, tol=0.01) -> None:
        ok = (got is None and want is None) or (got is not None and want is not None and abs(float(got) - float(want)) <= tol)
        print(f"  {'ok ' if ok else 'BAD'} {label}: model {got} / app {want}")
        if not ok:
            fails.append(label)

    # 1. row counts per table = csv rows
    counts = dax(port, "EVALUATE ROW(" + ", ".join(f'"{n}", COUNTROWS({tq(n)})' for n in TABLES) + ")")[0]
    for n in TABLES:
        with (BUILD / f"{n}.csv").open(encoding="utf-8") as f:
            same(f"rows {n}", counts[n], sum(1 for _ in csv.DictReader(f, delimiter=";")), 0)

    # 2. every measure evaluates without error at the grand total
    all_m = dax(port, "EVALUATE ROW(" + ", ".join(f'"{m[0]}", [{m[0]}]' for m in MEASURES) + ")")[0]
    print(f"  ok  all {len(all_m)} measures evaluate")

    # 3. headline figures, the same the app's tour test pins
    per = dax(port, """EVALUATE SUMMARIZECOLUMNS(Partner[Partner-Schlüssel], "kwp", [Solarleistung kWp], "n", [Solaranlagen], "other", [Leistung andere Energieträger kW])""")
    by = {r["Partner-Schlüssel"]: r for r in per}
    for p in ("bsw", "degewo", "bvg"):
        same(f"Solarleistung kWp {p}", by[p]["kwp"], exp["solarKwp"][p])
        same(f"Solaranlagen {p}", by[p]["n"], exp["solarUnits"][p], 0)
    same("Leistung andere Energieträger kW", sum(r["other"] or 0 for r in per), exp["otherKw"])
    same("Ladepunkte", all_m["Ladepunkte"], exp["chargingPoints"], 0)
    same("Ladepunkte Stadtwerke", all_m["Ladepunkte Stadtwerke"], exp["bswChargingPoints"], 0)
    same("Quartiere", all_m["Quartiere"], exp["estates"], 0)
    same("Ladepunkte bis 300 m um Quartiere", all_m["Ladepunkte bis 300 m um Quartiere"], exp["pointsNear300"], 0)
    same("Stadtwerke-Ladepunkte bis 300 m um Quartiere", all_m["Stadtwerke-Ladepunkte bis 300 m um Quartiere"], exp["bswPointsNear300"], 0)
    same("Quartiere ohne Stadtwerke-Ladepunkt", all_m["Quartiere ohne Stadtwerke-Ladepunkt"], len(exp["bswGaps300"]), 0)
    same("Offenes Potenzial Fokusdächer kWp", all_m["Offenes Potenzial Fokusdächer kWp"], exp["focusRoofOpenKwp"])
    same("Betriebshöfe", all_m["Betriebshöfe"], exp["depots"], 0)
    same("Einwohner", all_m["Einwohner"], exp["residents"], 0)

    # 4. per estate: the distinct-count measure equals the app's per-estate column (one estate = no double count possible)
    est = dax(port, """EVALUATE SUMMARIZECOLUMNS(Quartier[Quartier], Quartier[Ladepunkte bis 300 m], Quartier[Stadtwerke-Ladepunkte bis 300 m],
        FILTER(ALL(Quartier[Eigenständiges Quartier]), Quartier[Eigenständiges Quartier] = "ja"),
        "m", [Ladepunkte bis 300 m um Quartiere], "b", [Stadtwerke-Ladepunkte bis 300 m um Quartiere])""")
    for r in est:
        same(f"300 m {r['Quartier'][:30]}", r["m"] or 0, r["Ladepunkte bis 300 m"], 0)
        same(f"300 m Stadtwerke {r['Quartier'][:30]}", r["b"] or 0, r["Stadtwerke-Ladepunkte bis 300 m"], 0)
    gap = dax(port, """EVALUATE CALCULATETABLE(VALUES(Quartier[Quartier]), Quartier[Stadtwerke-Ladelücke 300 m] = "ja", Quartier[Eigenständiges Quartier] = "ja")""")
    same("Ladelücke ist Himbeersteig", int(sorted(r["Quartier"] for r in gap) == sorted(exp["bswGaps300"])), 1, 0)

    # 4b. a Bezirk filter must not drop stations across the district border (review 2026-10-28):
    # per Bezirk, the near-estate measure equals the same measure over that Bezirk's estates with no Bezirk filter
    bz = dax(port, """EVALUATE ADDCOLUMNS(VALUES(Quartier[Bezirk]),
        "viaBezirk", CALCULATE([Ladepunkte bis 300 m um Quartiere], TREATAS({Quartier[Bezirk]}, Bezirk[Bezirk])),
        "viaQuartier", VAR b = Quartier[Bezirk] RETURN CALCULATE([Ladepunkte bis 300 m um Quartiere], REMOVEFILTERS(Quartier), Quartier[Bezirk] = b))""")
    for r in bz:
        same(f"300 m mit Bezirksfilter {r['Bezirk']}", r["viaBezirk"] or 0, r["viaQuartier"] or 0, 0)
    pop = dax(port, """EVALUATE ROW("q", CALCULATE([Einwohner], Quartier[Quartier] = "Gropiusstadt"))""")[0]
    same("Einwohner leer unter Quartierfilter", pop["q"], None)

    # 5. year logic: cumulative to the last year = total; prior year of 2024 = additions in 2023
    yr = dax(port, """EVALUATE ROW("cum", CALCULATE([Solarleistung kumuliert kWp], Jahr[Jahr] = MAX(Jahr[Jahr])), "tot", [Solarleistung kWp],
        "py", CALCULATE([Solarleistung Vorjahr kWp], Jahr[Jahr] = 2024), "y23", CALCULATE([Solarleistung kWp], Jahr[Jahr] = 2023))""")[0]
    same("Solarleistung kumuliert = Bestand", yr["cum"], yr["tot"])
    same("Solarleistung Vorjahr 2024 = Zubau 2023", yr["py"], yr["y23"])

    # 6. expected-by-residents adds up to the city total over the districts
    ex = dax(port, """EVALUATE ROW("sum", SUMX(VALUES(Bezirk[Bezirk]), [Ladepunkte erwartet nach Einwohnern]),
        "inBerlin", CALCULATE([Ladepunkte], NOT ISBLANK(Ladestation[Bezirk])))""")[0]
    same("Ladepunkte erwartet nach Einwohnern summiert", ex["sum"], ex["inBerlin"], 1)

    print("FAIL: " + ", ".join(fails) if fails else "all checks passed")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main(int(sys.argv[1]))
