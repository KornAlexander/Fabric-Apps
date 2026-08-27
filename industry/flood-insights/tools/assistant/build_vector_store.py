"""Build the Foundry vector store over the fictional Musterschutz AVB — PLAN §8, §11.1 tool 10.

The assistant must never paraphrase coverage from memory. `search_policy_wording` retrieves the
actual clause, and this script is what puts the clause where it can be retrieved from.

Everything talks to the Azure OpenAI **v1** surface on the AIServices account, authenticated with
an Entra token from the Azure CLI — no keys are written to disk, and nothing here belongs in the
repository except this script and the document it uploads.

Usage
  python tools/assistant/build_vector_store.py
  python tools/assistant/build_vector_store.py --ask "Ist ein Rueckstauschaden gedeckt?"
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ACCOUNT = "aif-flutinsights-swc"
BASE = f"https://{ACCOUNT}.cognitiveservices.azure.com/openai/v1"
RESOURCE = "https://cognitiveservices.azure.com"
DOC = Path(__file__).with_name("AVB-Musterschutz-Wohngebaeude-2021.md")
STORE_NAME = "flut-insights-avb"
CHAT_DEPLOYMENT = "gpt-chat"


def token() -> str:
    out = subprocess.run(
        ["az", "account", "get-access-token", "--resource", RESOURCE, "--query", "accessToken", "-o", "tsv"],
        capture_output=True,
        text=True,
        shell=True,
        check=True,
    )
    return out.stdout.strip()


def call(method: str, path: str, body: dict | None = None, tok: str | None = None) -> dict:
    tok = tok or token()
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(f"{BASE}{path}", data=data, method=method)
    req.add_header("Authorization", f"Bearer {tok}")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", "replace")
        raise SystemExit(f"{method} {path} -> {err.code}\n{detail}") from err


def upload_file(tok: str) -> str:
    """Multipart upload by hand — the alternative is a dependency for twenty lines of boundary."""
    boundary = f"----flut{uuid.uuid4().hex}"
    content = DOC.read_bytes()
    mime = mimetypes.guess_type(DOC.name)[0] or "text/markdown"
    parts = [
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"purpose\"\r\n\r\nassistants\r\n".encode(),
        (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{DOC.name}"\r\n'
            f"Content-Type: {mime}\r\n\r\n"
        ).encode(),
        content,
        f"\r\n--{boundary}--\r\n".encode(),
    ]
    payload = b"".join(parts)

    req = urllib.request.Request(f"{BASE}/files", data=payload, method="POST")
    req.add_header("Authorization", f"Bearer {tok}")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    try:
        with urllib.request.urlopen(req, timeout=180) as res:
            out = json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        raise SystemExit(f"upload -> {err.code}\n{err.read().decode('utf-8', 'replace')}") from err
    print(f"  uploaded {DOC.name} ({len(content) / 1024:.1f} KB) -> {out['id']}")
    return out["id"]


def find_store(tok: str) -> dict | None:
    for store in call("GET", "/vector_stores", tok=tok).get("data", []):
        if store.get("name") == STORE_NAME:
            return store
    return None


def build() -> str:
    tok = token()

    existing = find_store(tok)
    if existing:
        # Rebuild rather than append, so a re-run never leaves two revisions of the wording in
        # the same store answering the same question differently.
        print(f"  removing previous store {existing['id']}")
        call("DELETE", f"/vector_stores/{existing['id']}", tok=tok)

    file_id = upload_file(tok)
    store = call(
        "POST",
        "/vector_stores",
        {"name": STORE_NAME, "file_ids": [file_id], "metadata": {"project": "flut-insights", "synthetic": "true"}},
        tok=tok,
    )
    store_id = store["id"]
    print(f"  vector store {store_id}")

    for _ in range(60):
        status = call("GET", f"/vector_stores/{store_id}", tok=tok)
        counts = status.get("file_counts", {})
        if counts.get("in_progress", 0) == 0:
            print(f"  indexed: {json.dumps(counts)}")
            if counts.get("failed", 0):
                raise SystemExit("a file failed to index — the store is not usable")
            return store_id
        time.sleep(2)
    raise SystemExit("timed out waiting for the store to index")


def ask(store_id: str, question: str) -> None:
    """Prove the retrieval works, rather than assuming a green create means a usable store."""
    tok = token()
    body = {
        "model": CHAT_DEPLOYMENT,
        "input": question,
        "instructions": (
            "Du bist ein nüchterner Analyst für eine Demonstrationsanwendung. Antworte auf Deutsch. "
            "Stütze jede Aussage zur Deckung auf die Bedingungen im Dokument und nenne den Paragraphen. "
            "Erfinde keine Zahlen. Weise darauf hin, dass es sich um ein fiktives Bedingungswerk handelt."
        ),
        "tools": [{"type": "file_search", "vector_store_ids": [store_id]}],
    }
    out = call("POST", "/responses", body, tok=tok)
    text = []
    for item in out.get("output", []):
        for chunk in item.get("content", []) or []:
            if chunk.get("type") == "output_text":
                text.append(chunk["text"])
    print("\n--- answer ---")
    print("\n".join(text) if text else json.dumps(out)[:1500])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ask", help="ask a question against the store once it is built")
    parser.add_argument("--store-id", help="skip the build and query an existing store")
    args = parser.parse_args()

    store_id = args.store_id
    if not store_id:
        if not DOC.exists():
            raise SystemExit(f"missing {DOC}")
        print(f"building vector store '{STORE_NAME}' on {ACCOUNT}")
        store_id = build()

    if args.ask:
        ask(store_id, args.ask)

    print(f"\nVECTOR_STORE_ID={store_id}")


if __name__ == "__main__":
    main()
    sys.exit(0)
