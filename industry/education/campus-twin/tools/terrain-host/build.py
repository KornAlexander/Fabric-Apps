"""Stellt die Nutzlast fuer den Terrain-Host zusammen und baut das Abbild.

    python tools/terrain-host/build.py            # nur zusammenstellen und bauen
    python tools/terrain-host/build.py --local    # lokal bauen statt in der Registry

⚠ DIE SPERRE AUS release.json GILT HIER GENAUSO WIE IM PAKET. `vite.config.ts` sagt es fuer den
Bundle-Fall selbst: "Hiding a link is not withholding a file." Ein Terrain-Host, der einfach alles
aus public/terrain kopiert, wuerde einen Standort ausliefern, den der Build zurueckhaelt - und
zwar an einer Adresse, die niemand prueft, weil sie nicht das Paket ist. Deshalb liest dieses
Skript dieselbe Datei und laesst dieselben Standorte weg.

⚠ ES FAELLT ZU, NICHT AUF. Laesst sich release.json nicht lesen oder nicht verstehen, bricht der
Lauf ab, statt vorsichtshalber alles mitzunehmen. Das ist die umgekehrte Entscheidung wie im
Prune-Schritt von vite.config.ts, und mit Absicht: dort bedeutet ein Fehler ein Paket, dem
Standorte fehlen, die niemand streichen wollte; hier bedeutet er eine Veroeffentlichung, die
niemand beschlossen hat. Der teurere Fehler gewinnt.

⚠ `assetsFrom` WIRD MITGENOMMEN. Der generische Standort hat kein eigenes Gelaende, sondern zeigt
auf das eines anderen. Wird der Spender ausgeschlossen, faellt der generische Standort still auf
eine leere Karte - das Skript sagt es dann laut.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
TERRAIN = ROOT / 'public' / 'terrain'
PAYLOAD = HERE / 'payload'

RESOURCE_GROUP = 'rg-digitaltwin-swc'
IMAGE = 'campus-terrain'


def registry() -> str:
    """Den Namen der Registry ERFRAGEN, nicht aufschreiben.

    ⚠ `tools/verify_publishable.py` hat den fest verdrahteten Namen gefunden, und zu Recht: eine
    Registry ist eine benannte Ressource in einem konkreten Abonnement, und dieses Repository soll
    veröffentlichbar bleiben. Sie hier nachzuschlagen kostet einen Aufruf und hält das Repository
    frei davon — und nebenbei geht der Lauf auf einem anderen Abonnement einfach weiter, statt in
    eine fremde Registry zu schieben.

    ⚠ GENAU EINE ERWARTET. Gibt es keine, ist nichts da, wohin gebaut werden könnte; gibt es
    mehrere, wäre die Auswahl geraten, und ein Abbild in der falschen Registry fällt erst beim
    Ausrollen auf.
    """
    override = os.environ.get('CAMPUS_TERRAIN_ACR')
    if override:
        return override
    roh = subprocess.run(
        ['az', 'acr', 'list', '--resource-group', RESOURCE_GROUP,
         '--query', '[].loginServer', '-o', 'json'],
        capture_output=True, text=True, shell=True)
    treffer = json.loads(roh.stdout or '[]')
    if len(treffer) != 1:
        raise SystemExit(
            f'ABBRUCH: {len(treffer)} Registries in {RESOURCE_GROUP} gefunden, erwartet genau '
            f'eine. Die gewuenschte mit CAMPUS_TERRAIN_ACR=<name>.azurecr.io vorgeben.')
    return treffer[0]


def gelesene_sperre() -> set[str]:
    """Die ausgeschlossenen Standorte, oder ein Abbruch."""
    p = ROOT / 'config' / 'release.json'
    try:
        release = json.loads(p.read_text(encoding='utf-8'))
    except Exception as e:                                    # noqa: BLE001 - Absicht, siehe Kopf
        raise SystemExit(f'ABBRUCH: {p} nicht lesbar ({e}). Es wird nichts veroeffentlicht.')
    roh = release.get('excludeAois')
    if roh is None or not isinstance(roh, list) or any(not isinstance(x, str) for x in roh):
        raise SystemExit(f'ABBRUCH: excludeAois in {p} fehlt oder ist keine Liste von Strings.')
    return set(roh)


def alle_standorte() -> dict[str, dict]:
    return {
        p.stem: json.loads(p.read_text(encoding='utf-8'))
        for p in sorted((ROOT / 'config' / 'aoi').glob('*.json'))
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--local', action='store_true',
                    help='lokal mit Docker bauen statt in der Registry (braucht Docker Desktop)')
    ap.add_argument('--tag', default='latest')
    args = ap.parse_args()

    ausgeschlossen = gelesene_sperre()
    standorte = alle_standorte()

    if PAYLOAD.exists():
        shutil.rmtree(PAYLOAD)
    PAYLOAD.mkdir(parents=True)

    genommen, uebersprungen, fehlend = [], [], []
    for aoi, cfg in standorte.items():
        if aoi in ausgeschlossen:
            uebersprungen.append(aoi)
            continue
        quelle = TERRAIN / (cfg.get('assetsFrom') or aoi)
        if not quelle.is_dir():
            fehlend.append(f'{aoi} (erwartet {quelle.name})')
            continue
        ziel = PAYLOAD / quelle.name
        if not ziel.exists():
            shutil.copytree(quelle, ziel)
        genommen.append(aoi)

        spender = cfg.get('assetsFrom')
        if spender and spender in ausgeschlossen:
            raise SystemExit(
                f'ABBRUCH: {aoi} borgt sein Gelaende von {spender}, und {spender} ist '
                f'ausgeschlossen. Ausgeliefert wuerde ein Standort ohne Karte.')

    mb = sum(f.stat().st_size for f in PAYLOAD.rglob('*') if f.is_file()) / 1e6
    print(f'  aufgenommen:   {len(genommen)} Standorte, {mb:.1f} MB')
    if uebersprungen:
        print(f'  ausgeschlossen: {", ".join(sorted(uebersprungen))}  (aus config/release.json)')
    if fehlend:
        print(f'  ⚠ ohne Gelaende: {", ".join(fehlend)} - nicht gebaut, wird nicht ausgeliefert')
    if not genommen:
        raise SystemExit('ABBRUCH: kein einziger Standort in der Nutzlast.')

    reg = registry()
    tag = f'{IMAGE}:{args.tag}'
    if args.local:
        # ⚠ BRAUCHT EINEN LAUFENDEN DOCKER-DAEMON. Ohne Docker Desktop scheitert es mit
        # "failed to connect to the docker API at npipe:...", was wie ein Netzwerkfehler aussieht
        # und keiner ist.
        print(f'\n  docker build -> {reg}/{tag}')
        subprocess.run(['docker', 'build', '-t', f"{reg}/{tag}", str(HERE)], check=True)
        return 0

    # ⚠ IN DER REGISTRY BAUEN, NICHT LOKAL. `az acr build` laedt den Kontext hoch und baut dort,
    # also ohne laufenden Docker-Daemon und ohne dass 246 MB durch die lokale Maschine muessen,
    # bevor sie wieder hochgeladen werden. Es schiebt das Ergebnis gleich mit.
    print(f'\n  az acr build -> {reg}/{tag}   (Kontext {mb:.1f} MB, das dauert)')
    subprocess.run(
        ['az', 'acr', 'build', '--registry', reg.split(".")[0],
         '--image', tag, '--file', str(HERE / 'Dockerfile'), str(HERE)],
        check=True, shell=True)
    print(f'  fertig: {reg}/{tag}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
