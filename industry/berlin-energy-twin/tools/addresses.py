"""Address parsing and matching between register units and solar-atlas buildings
(PLAN §4.1, review S3).

The register's addresses are free text, mostly the unit's NAME ("Kleeblattstr. 34",
"Greizer Straße 2-6 ger., 12279 Berlin", "BHKW Pascalstr. 7, 10587 Berlin",
"Am Falkenberg 11D (3a)"). The solar atlas gives a street and a house number per
building. Matching is deliberately strict: same normalised street, same
postcode where both have one, and a house number inside the unit's number set.
Anything else is "unmatched" and is shown as such, never guessed.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

#: Prefixes that describe the plant, not the place.
_PREFIX = re.compile(r"^\s*(?:BHKW\s*\d*|PV|KWK|Dach)\s+", re.I)
#: Trailing noise after the house numbers: ", 12279 Berlin", " ger.", " (3a)", " - 37,5 kWp".
_POSTCODE = re.compile(r"\b(1[0-4]\d{3})\b")
#: House numbers have at most four digits; a five-digit token is the postcode, not a list item.
_NO = r"\d{1,4}(?!\d)\s?(?:[A-Za-z](?![A-Za-z]))?"
#: A range hyphen has no spaces ("12-14"); " - 37,5 kWp" is a description, not a range.
_NUMBERS = rf"{_NO}(?:(?:\s*[/,]\s*|-){_NO})*"
_ADDRESS = re.compile(rf"^(?P<street>[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß.\- ]*?)\s+(?P<nums>{_NUMBERS})(?![\d])")


def normalise_street(s: str) -> str:
    """'Kleeblattstr.' / 'Kleeblattstrasse' / 'Kleeblatt-Straße' -> 'kleeblattstraße'."""
    t = s.strip().lower()
    t = re.sub(r"\s+", " ", t)
    t = re.sub(r"str\.?$", "straße", t)
    t = re.sub(r"str\.(?=\s|$)", "straße", t)
    t = t.replace("strasse", "straße")
    t = re.sub(r"-straße$", "straße", t)
    return t


@dataclass(frozen=True)
class HouseNo:
    number: int
    letter: str = ""

    @staticmethod
    def parse(s: str) -> "HouseNo | None":
        m = re.fullmatch(r"\s*(\d+)\s*([A-Za-z]?)\s*", s or "")
        return HouseNo(int(m.group(1)), m.group(2).upper()) if m else None


@dataclass
class Address:
    street: str  # normalised
    numbers: list[tuple[int, int, str]] = field(default_factory=list)  # (from, to, letter)
    plz: str | None = None

    def covers(self, h: HouseNo) -> bool:
        """Is house number `h` one of this address's numbers? A letter must match when both have one."""
        for lo, hi, letter in self.numbers:
            if lo <= h.number <= hi:
                if letter and h.letter and letter != h.letter:
                    continue
                return True
        return False


def _parse_numbers(text: str) -> list[tuple[int, int, str]]:
    out: list[tuple[int, int, str]] = []
    # "12-14" is a range, "30/45" and "4B, 6" are lists.
    for part in re.split(r"\s*[/,]\s*", text):
        r = re.fullmatch(r"(\d+)\s?([A-Za-z]?)\s*-\s*(\d+)\s?[A-Za-z]?", part)
        if r:
            lo, hi = int(r.group(1)), int(r.group(3))
            if lo <= hi and hi - lo <= 40:
                out.append((lo, hi, ""))
            continue
        s = re.fullmatch(r"(\d+)\s?([A-Za-z]?)", part)
        if s:
            out.append((int(s.group(1)), int(s.group(1)), s.group(2).upper()))
    return out


#: A token sequence only counts as a street if it looks like one: a typical suffix,
#: or a typical leading word. "Rathausviertel 3" or "Anlage 2" are names, not addresses.
_SUFFIX = re.compile(
    r"(straße|str\.?|weg|allee|platz|ring|chaussee|damm|ufer|steig|pfad|gasse|promenade|zeile|"
    r"aue|anger|markt|brücke|graben|hof|park|steg|grund|höhe|bogen|berg|feld|garten|winkel|tor)$"
)
_LEADING = re.compile(r"^(am|an der|an den|auf der|im|in den|zum|zur|alt-|alte|hinter der|unter den) ", re.I)


def _looks_like_street(street: str) -> bool:
    n = normalise_street(street)
    return bool(_SUFFIX.search(n) or _LEADING.match(n + " ") or _LEADING.match(n))


def parse_address(text: str | None, plz: str | None = None) -> Address | None:
    """Street and house numbers from a register name or street field; None if there are none.

    Scans every "words + number" candidate left to right and takes the first whose words look like a
    street, so "Pankeviertel 12 - Pankower Str. 19" gives Pankower Straße 19, not Pankeviertel 12.
    """
    if not text:
        return None
    t = _PREFIX.sub("", text)
    for start in [0] + [m.end() for m in re.finditer(r"[\s,\-]+", t)]:
        m = _ADDRESS.match(t[start:])
        if not m or not _looks_like_street(m.group("street")):
            continue
        nums = _parse_numbers(m.group("nums"))
        if not nums:
            continue
        pc = _POSTCODE.search(t[start + m.end():])
        return Address(normalise_street(m.group("street")), nums, plz or (pc.group(1) if pc else None))
    return None


def unit_address(unit: dict) -> Address | None:
    """The register's street field when it has one, else the unit's name."""
    if unit.get("street") and unit.get("no"):
        return parse_address(f"{unit['street']} {unit['no']}", unit.get("plz"))
    return parse_address(unit.get("name"), unit.get("plz"))
