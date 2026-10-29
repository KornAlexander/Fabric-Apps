"""The report's cover page as one DAX measure (D58), in the style of Alexander's Hochschul-Insights
landing page: the HTML Content visual renders what the measure returns.

The style is fabric/cover.css (taken from the Hochschul measure, glyphs renamed). Every figure on
the page is a DAX expression over the model's own measures, so the cover cannot drift from the
report pages, the app or a refresh. The right third of the page stays empty: the report puts an
IBCS chart there, as the Hochschul cover does.
"""
from __future__ import annotations

from pathlib import Path

CSS = (Path(__file__).resolve().parent / "cover.css").read_text(encoding="utf-8")

# Line icons (64 x 64, stroke = currentColor), drawn faint behind the text.
GLYPHS = {
    "sun": '<circle cx="32" cy="32" r="11"/><path d="M32 6v8M32 50v8M6 32h8M50 32h8M13.6 13.6l5.7 5.7M44.7 44.7l5.7 5.7M13.6 50.4l5.7-5.7M44.7 19.3l5.7-5.7"/>',
    "plug": '<path d="M22 8v14M42 8v14M16 22h32v10a16 16 0 0 1-32 0z"/><path d="M32 48v10"/>',
    "house": '<path d="M8 30L32 10l24 20"/><path d="M14 26v28h36V26"/><path d="M18 22l8-6 8 6M36 22l8-6"/><rect x="27" y="38" width="10" height="16"/>',
    "bolt": '<path d="M36 6L14 36h16l-4 22 24-32H34z"/>',
    "bus": '<rect x="12" y="10" width="40" height="38" rx="5"/><path d="M12 30h40M20 48v6M44 48v6"/><circle cx="21" cy="40" r="2.5"/><circle cx="43" cy="40" r="2.5"/>',
}
STROKE = {"sun": "1.8", "plug": "1.8", "house": "1.6", "bolt": "2", "bus": "2"}


def _glyphs() -> str:
    return "".join(
        f'<svg class="glyph {k}" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="{STROKE[k]}" '
        f'stroke-linecap="round" stroke-linejoin="round">{v}</svg>'
        for k, v in GLYPHS.items()
    )


def _q(html: str) -> str:
    """A DAX string literal: double quotes doubled, line breaks kept out (one-line TMDL expression)."""
    return '"' + " ".join(html.split()).replace('"', '""') + '"'


def _num(measure: str, fmt: str) -> str:
    # Whole model, whatever a cross-filter on the page says: the cover states the totals.
    return f'FORMAT ( CALCULATE ( [{measure}], REMOVEFILTERS () ), "{fmt}", "de-DE" )'


def startseite() -> str:
    head = f"""<div class="landing-root"><style>{CSS}</style><div class="stage">
<div class="topbar-reserve" aria-hidden="true"></div><div class="visual-reserve" aria-hidden="true"></div>
<div class="glyphs" aria-hidden="true">{_glyphs()}</div>
<div class="content">
<div class="eyebrow"><span class="dot"></span> Berlin-Zwilling</div>
<h1>Drei Landesunternehmen,<br/><span class="accent">ein Energiepartner.</span></h1>
<p class="lede">Solar auf Dächern und Betriebshöfen, öffentliches Laden rund um die Quartiere:
Berliner Stadtwerke, degewo und BVG in einem Modell. Aus offenen Daten, aufbereitet in Microsoft
Fabric und visualisiert nach IBCS-Standards.</p>
<div class="meta"><div class="item">Quellen: Marktstammdatenregister (BNetzA), Geoportal Berlin</div>
<div class="item">Offene Daten (DL-DE)</div><div class="item">Microsoft Fabric · Importmodell</div></div>
<div class="kpis"><div class="kpi"><span class="b"></span><div class="v">"""
    k1 = """</div><div class="l">MWp Solar der drei<br/>Partner im Register</div></div>
<div class="kpi"><span class="b"></span><div class="v">"""
    k2 = """</div><div class="l">öffentliche Ladepunkte<br/>in Berlin</div></div>
<div class="kpi"><span class="b"></span><div class="v">"""
    tail = """</div><div class="l">degewo-Quartiere<br/>im Blick</div></div></div></div>
<div class="footer"><div class="brand"><span>Daten: Marktstammdatenregister, Geoportal Berlin</span><span class="sep"></span>
<span>Visualisierung nach IBCS&reg;</span><span class="sep"></span><span>Powered by Microsoft Fabric</span></div>
<div class="brand"><b>BERLIN&nbsp;ZWILLING</b></div></div></div></div>"""
    return " & ".join([
        _q(head), _num("Solarleistung MWp", "#,0.0"),
        _q(k1), _num("Ladepunkte", "#,0"),
        _q(k2), _num("Quartiere", "#,0"),
        _q(tail),
    ])
