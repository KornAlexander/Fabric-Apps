"""Inject hi_appdata.json into the /*__HI_DATA__*/ marker in ../../index.html."""
import io, os

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.normpath(os.path.join(HERE, "..", "..", "index.html"))
DATA = os.path.join(HERE, "hi_appdata.json")

MARK_EMPTY = "/*__HI_DATA__*/ {}"

with io.open(APP, "r", encoding="utf-8") as f:
    html = f.read()
with io.open(DATA, "r", encoding="utf-8") as f:
    data = f.read().strip()

start = html.find("/*__HI_DATA__*/")
if start == -1:
    raise SystemExit("marker /*__HI_DATA__*/ not found in index.html")
# replace whatever follows the marker up to the ';' that ends the assignment
semi = html.find(";", start)
line_end = html.find("\n", start)
end = semi if (semi != -1 and (line_end == -1 or semi < line_end)) else line_end
head = html[:start] + "/*__HI_DATA__*/ " + data
tail = html[end:]
html = head + tail

with io.open(APP, "w", encoding="utf-8", newline="\n") as f:
    f.write(html)
print(f"Injected {len(data)} bytes into index.html ({len(html)} bytes total).")
