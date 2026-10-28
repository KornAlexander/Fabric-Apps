"""Address parsing cases taken from the real register names (review S3)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from addresses import HouseNo, normalise_street, parse_address, unit_address  # noqa: E402


def test_street_spellings_normalise_to_one_form():
    assert normalise_street("Kleeblattstr.") == "kleeblattstraße"
    assert normalise_street("Kleeblattstraße") == "kleeblattstraße"
    assert normalise_street("Kleeblattstrasse") == "kleeblattstraße"
    assert normalise_street("Wernigeroder Str.") == "wernigeroder straße"
    assert normalise_street("Fritz-Erler-Allee") == "fritz-erler-allee"
    assert normalise_street("Am  Falkenberg") == "am falkenberg"


def test_plain_name():
    a = parse_address("Kleeblattstr. 34", "12524")
    assert a.street == "kleeblattstraße" and a.numbers == [(34, 34, "")] and a.plz == "12524"


def test_prefix_and_trailing_city_are_ignored():
    a = parse_address("BHKW Pascalstr. 7, 10587 Berlin")
    assert a.street == "pascalstraße" and a.numbers == [(7, 7, "")] and a.plz == "10587"
    a = parse_address("PV Potsdamer Str. 60 - 37,5 kWp")
    assert a.street == "potsdamer straße" and a.numbers == [(60, 60, "")]


def test_ranges_lists_and_letters():
    a = parse_address("Greizer Straße 2-6 ger., 12279 Berlin")
    assert a.numbers == [(2, 6, "")] and a.covers(HouseNo(4)) and not a.covers(HouseNo(8))
    a = parse_address("Siegfriedstraße 30/45")
    assert a.covers(HouseNo(30)) and a.covers(HouseNo(45)) and not a.covers(HouseNo(31))
    a = parse_address("Libboldallee 4B, 6")
    assert a.covers(HouseNo(4, "B")) and a.covers(HouseNo(6)) and not a.covers(HouseNo(4, "A"))
    a = parse_address("Am Falkenberg 11D (3a)")
    assert a.street == "am falkenberg" and a.covers(HouseNo(11, "D")) and not a.covers(HouseNo(11, "C"))


def test_letter_on_one_side_only_still_matches():
    # The atlas often stores "11" for a building the register calls "11C".
    assert parse_address("Am Falkenberg 11C").covers(HouseNo(11))
    assert parse_address("Wernigeroder Str. 2 H").covers(HouseNo(2, "H"))


def test_no_address_gives_none():
    assert parse_address("Dach") is None
    assert parse_address("Mach Ost") is None
    assert parse_address("BFI - Parabel") is None


def test_register_street_field_wins_over_name():
    u = {"name": "Havensteinstr. 22", "street": "Havensteinstraße", "no": "20", "plz": "12249"}
    a = unit_address(u)
    assert a.numbers == [(20, 20, "")] and a.plz == "12249"


def test_estate_names_before_the_address_are_skipped():
    a = parse_address("Pankeviertel 12 - Pankower Str. 19", "13156")
    assert a.street == "pankower straße" and a.numbers == [(19, 19, "")]
    a = parse_address("Rathausviertel 3 Döbelner Str. 8")
    assert a.street == "döbelner straße" and a.numbers == [(8, 8, "")]
    assert parse_address("Karower Chaussee 145").street == "karower chaussee"
    # "Anlage 2" is a plant number; the street has none, so there is no address to match.
    assert parse_address("Gewobag Rhinstr. Anlage 2") is None
    assert parse_address("Berlinovo Rostocker Anlage 2") is None
    assert parse_address("4-Farb-Karree Anlage 1") is None
