"""Which site a Fabric script is working on, and everything that differs between sites.

The lakehouse, the model, the agreement gate and the report were written for one campus, with
`AOI = "garching"` at the top of each file and TUM's vocabulary in the descriptions. A second site
does not need a second copy of those scripts; it needs the handful of facts below, in one place.

⚠️ ONE SITE, ONE LAKEHOUSE, ONE MODEL, ONE REPORT. Sites are deliberately NOT columns in a shared
model. A report page is opened with a URL filter, and a filter is a request, not a permission:
anyone who may open a shared model can remove it. With Direct Lake a viewer also needs access to
the data behind the model. So data that may be shown to anyone (the demo site) and data that may
not (a real university's bookings) live in separate items, and access is granted per item.
A site may have that one report in a second language (`English`): another report, the same model.

⚠️ THE IDS STILL COME FROM THE ENVIRONMENT (`fabric_ids.py`), AND THAT IS THE DANGEROUS PART. The
shell that loaded Garching a minute ago still has Garching's lakehouse id in it. So every script
that writes checks the NAME of the item behind the id against the site it was asked for
(`expect_lakehouse`) and refuses on a mismatch, before anything is written.

Usage, in every script here:  --site garching | campus-demo   (default: garching)
"""
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class English:
    """A site's second report, in English, over the SAME model.

    ⚠️ ONE MODEL, TWO REPORTS, NOT TWO MODELS. The numbers come from the measures both reports share,
    so they cannot differ between languages. Only what a report cannot translate itself is added to
    the model for it: the two measures that return text (`build_semantic_model.py`) and the label
    columns of the load stamp (`build_lakehouse_tables.py`).

    ⚠️ A SITE THAT HAS THIS NEEDS ITS LAKEHOUSE RELOADED BEFORE ITS MODEL IS PUBLISHED. The model then
    names stamp columns the old `data_load` table does not have.
    """

    report_name: str
    #: What the English report may call the load, per semantics.
    source_labels: dict[str, str]
    semester_label: str | None
    footnote: str


@dataclass(frozen=True)
class Site:
    key: str
    #: The AOI whose `public/terrain/<aoi>/rooms.json` and `occupancy.bin` are the source.
    aoi: str
    #: Shown on the report and in messages.
    label: str
    lakehouse_name: str
    model_name: str
    report_name: str
    #: Folder names under `fabric/`, without the `.SemanticModel` / `.Report` suffix.
    artefact: str
    #: The release lever that decides whether this site's data may be real, or `None`.
    governed_by: str | None
    #: Set where the data is synthetic BY CONSTRUCTION and the rooms file carries no stamp saying
    #: so. Without it a missing stamp reads as "real", which is right for Garching and would be a
    #: false claim about an invented university.
    fixed_semantics: str | None
    #: What a report may call the load, per semantics. German, because the report is.
    source_labels: dict[str, str]
    #: What the stamp calls the period, where the rooms file's own wording is not fit to show.
    #: The stamp is one line on a 1280 px page; about 100 characters is all it holds.
    semester_label: str | None
    #: Whether rooms carry names worth a column in the report.
    room_names: bool
    #: A model collation, where the default (which ignores letter case) would merge two codes.
    collation: str | None
    #: A line under the report page. German.
    footnote: str
    #: The site's English report, where it has one. `None`: the site has the German report only.
    english: English | None = None

    @property
    def model_dir(self) -> Path:
        return ROOT / "fabric" / f"{self.artefact}.SemanticModel"

    @property
    def report_dir(self) -> Path:
        return ROOT / "fabric" / f"{self.artefact}.Report"

    @property
    def languages(self) -> tuple[str, ...]:
        return ("de", "en") if self.english else ("de",)

    def report_name_in(self, lang: str) -> str:
        return self.in_language(lang).report_name

    def report_dir_in(self, lang: str) -> Path:
        self.in_language(lang)
        return self.report_dir if lang == "de" else ROOT / "fabric" / f"{self.artefact}EN.Report"

    def in_language(self, lang: str) -> "Site | English":
        """The texts of this site's report in `lang`, refusing a language the site has no report in.

        ⚠️ REFUSED, NOT FALLEN BACK. A request for Garching's English report that quietly produced the
        German one would be published under the German report's name and replace it.
        """
        if lang == "de":
            return self
        if lang == "en" and self.english:
            return self.english
        raise SystemExit(f"{self.label} has no report in {lang!r}; it has: {', '.join(self.languages)}")

    @property
    def terrain(self) -> Path:
        return ROOT / "public" / "terrain" / self.aoi

    def hero_building(self) -> str:
        """The building the app's own demo path opens, from the AOI config. Used as a spot check."""
        config = json.loads((ROOT / "config" / "aoi" / f"{self.aoi}.json").read_text(encoding="utf-8"))
        return str(config["rooms"]["heroBuilding"])


_BLANKS = "Leer oder grau: kein Kalender vorhanden, also unbekannt und nicht 0. "

SITES: dict[str, Site] = {
    "garching": Site(
        key="garching",
        aoi="garching",
        label="TUM Garching",
        # Names kept exactly as they were before sites existed, so a deployment made back then
        # finds its items again.
        lakehouse_name="campus_scheduler_lh",
        model_name="Campus Scheduler — Raum & Belegung",
        report_name="Campus Scheduler Gebäudebericht",
        artefact="CampusScheduler",
        governed_by="navigatumData",
        fixed_semantics=None,
        source_labels={
            "navigatum": "Echte Belegung (TUMonline / NavigaTUM)",
            "synthetic": "Synthetische Belegung (erzeugt, keine echten Buchungen)",
        },
        semester_label=None,
        room_names=True,
        collation=None,
        footnote=(
            _BLANKS
            + "Plätze sind synthetisch (Fläche geteilt durch eine Planungsdichte). "
            + "Auslastung: Lehrräume mit Kalender, wie im Gebäudepanel der App."
        ),
    ),
    "campus-demo": Site(
        key="campus-demo",
        aoi="campus-demo",
        label="Beispiel-Universität",
        lakehouse_name="campus_scheduler_demo_lh",
        model_name="Campus Scheduler Demo Raum & Belegung",
        report_name="Campus Scheduler Demo Gebäudebericht",
        artefact="CampusSchedulerDemo",
        # No lever: nothing about this site is anybody's real data, in any release posture.
        governed_by=None,
        fixed_semantics="synthetic",
        source_labels={"synthetic": "Synthetisch, erfundene Hochschule"},
        semester_label="generierter Plan",
        room_names=False,
        collation="Latin1_General_100_BIN2_UTF8",
        footnote=(
            "Beispiel-Universität ist eine erfundene Hochschule: Räume, Plätze und Belegung sind generiert, "
            "nur die Gebäudeumrisse sind echt. "
            + _BLANKS
            + "Auslastung: Lehrräume mit Kalender, wie im Gebäudepanel der App."
        ),
        english=English(
            report_name="Campus Scheduler Demo Building Report",
            source_labels={"synthetic": "Synthetic, invented university"},
            semester_label="generated timetable",
            footnote=(
                "Beispiel-Universität is an invented university: rooms, seats and bookings are generated, "
                "only the building outlines are real. "
                "Empty or grey: no calendar, so unknown and not 0. "
                "Utilisation: teaching rooms with a calendar, as in the app's building panel."
            ),
        ),
    ),
}


def add_site_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--site",
        choices=sorted(SITES),
        default="garching",
        help="which site's lakehouse, model and report to work on (default: garching)",
    )


def add_language_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--lang",
        choices=("de", "en"),
        default="de",
        help="which of the site's reports: German (default) or, where the site has one, English",
    )


def site_from_cli(description: str) -> Site:
    """For the scripts whose only option is the site."""
    parser = argparse.ArgumentParser(description=description)
    add_site_argument(parser)
    return SITES[parser.parse_args().site]


def expect_lakehouse(site: Site, lakehouse_display_name: str) -> None:
    """Refuse when the id in the environment belongs to another site's lakehouse.

    ⚠️ THE WRITE WOULD SUCCEED. Delta tables do not care which campus they describe, so loading the
    demo site into Garching's lakehouse replaces real bookings with invented ones under a model that
    says they are real, and the other way round puts a real university's bookings into the item
    that is shared with everyone. The name is the only thing that can tell the two apart in time.
    """
    if lakehouse_display_name != site.lakehouse_name:
        raise SystemExit(
            f"FABRIC_LAKEHOUSE_ID points at the lakehouse {lakehouse_display_name!r}, but --site {site.key} "
            f"works on {site.lakehouse_name!r}. Set FABRIC_LAKEHOUSE_ID to that lakehouse's id "
            "(tools/fabric/setup_lakehouse.py prints it)."
        )
