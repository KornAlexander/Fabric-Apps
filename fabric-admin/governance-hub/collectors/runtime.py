"""Shared notebook runtime helpers (PLAN.md §15).

Inlined into every collector notebook. Unlike the shaping layer this *does*
touch Spark and the network, so it is thin on purpose: everything with a
decision in it lives in `collectors/shape_*.py` and is tested offline.
"""

from __future__ import annotations

import json
import time
from typing import Any, Callable


class RestError(RuntimeError):
    def __init__(self, status: int, url: str, body: str) -> None:
        super().__init__(f"{status} {url}: {body[:400]}")
        self.status = status
        self.url = url


def fabric_client():
    """A `sempy` REST client for Fabric / Power BI, under the running identity."""
    import sempy.fabric as fabric  # type: ignore

    return fabric.FabricRestClient()


def rest_get(client, path: str, *, retries: int = 4) -> dict[str, Any]:
    """GET with backoff on 429/5xx.

    Admin APIs are rate-limited (25 req/min on some tenant-setting endpoints), and
    a nightly crawl that gives up on the first 429 silently under-reports — which
    is the worst possible failure mode for a governance inventory.
    """
    delay = 2.0
    last: Exception | None = None
    for _ in range(retries):
        response = client.get(path)
        if response.status_code == 200:
            return response.json() if response.text else {}
        if response.status_code in (429, 500, 502, 503, 504):
            retry_after = response.headers.get("Retry-After")
            time.sleep(float(retry_after) if retry_after else delay)
            delay = min(delay * 2, 60)
            last = RestError(response.status_code, path, response.text)
            continue
        raise RestError(response.status_code, path, response.text)
    raise last or RestError(0, path, "exhausted retries")


def graph_token(scope: str = "https://graph.microsoft.com/.default") -> str:
    """Delegated Graph token for the identity the notebook runs as."""
    import notebookutils  # type: ignore

    return notebookutils.credentials.getToken(scope)


def graph_get(token: str, url: str, *, retries: int = 4) -> dict[str, Any]:
    import urllib.error
    import urllib.request

    if not url.startswith("http"):
        url = f"https://graph.microsoft.com{url}"

    delay = 2.0
    for _ in range(retries):
        request = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        try:
            with urllib.request.urlopen(request) as response:  # noqa: S310 - fixed host
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code in (429, 500, 502, 503, 504):
                time.sleep(delay)
                delay = min(delay * 2, 60)
                continue
            raise RestError(exc.code, url, exc.read().decode("utf-8", "replace")) from exc
    raise RestError(0, url, "exhausted retries")


def graph_call(token: str, method: str, url: str, body: dict | None = None) -> dict[str, Any]:
    """Graph request with a method — the write-capable sibling of `graph_get`.

    Deliberately **not** retried on 5xx: a POST that may have partially applied
    must not be replayed blindly. The actuator's read-before-write makes a
    retry safe only after re-reading, and that is the caller's decision.
    """
    import urllib.error
    import urllib.request

    if not url.startswith("http"):
        url = f"https://graph.microsoft.com{url}"

    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(url, data=data, method=method.upper())
    request.add_header("Authorization", f"Bearer {token}")
    if data is not None:
        request.add_header("Content-Type", "application/json")

    try:
        with urllib.request.urlopen(request) as response:  # noqa: S310 - fixed host
            payload = response.read().decode("utf-8")
            return json.loads(payload) if payload else {}
    except urllib.error.HTTPError as exc:
        raise RestError(exc.code, url, exc.read().decode("utf-8", "replace")) from exc


def fabric_call(client, method: str, path: str, body: dict | None = None) -> dict[str, Any]:
    """Fabric REST with a method, through the `sempy` client.

    Same no-retry stance as `graph_call`, for the same reason.
    """
    verb = method.upper()
    if verb == "GET":
        response = client.get(path)
    elif verb == "POST":
        response = client.post(path, json=body or {})
    elif verb == "PATCH":
        response = client.patch(path, json=body or {})
    elif verb == "DELETE":
        response = client.delete(path)
    else:
        raise ValueError(f"unsupported method {method}")

    if response.status_code not in (200, 201, 202, 204):
        raise RestError(response.status_code, path, response.text)
    return response.json() if response.text else {}


def write_table(
    spark,
    lakehouse: str,
    table: str,
    rows: list[dict],
    *,
    dry_run: bool,
    log: Callable[[str, str, str], None],
) -> int:
    """Overwrite one `gov_actual_*` table with this run's rows.

    Overwrite, not append: these tables are a *snapshot of current reality*, and
    the run ledger plus `gov_audit` carry the history. An append-only actual-state
    table is how a drift engine starts comparing against last month.
    """
    if dry_run:
        log(table, "Planned", f"{len(rows)} rows")
        return len(rows)
    if not rows:
        log(table, "Skipped (no permission)", "no rows collected")
        return 0
    try:
        df = spark.createDataFrame(rows)
        df.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(
            f"{lakehouse}.{table}"
        )
        log(table, "Created", f"{len(rows)} rows")
        return len(rows)
    except Exception as exc:  # noqa: BLE001
        log(table, "Failed", f"{type(exc).__name__}: {exc}")
        return 0


def write_run_row(spark, lakehouse: str, summary: dict, *, dry_run: bool) -> None:
    if dry_run:
        return
    try:
        spark.createDataFrame([summary]).write.mode("append").option(
            "mergeSchema", "true"
        ).saveAsTable(f"{lakehouse}.gov_runs")
    except Exception as exc:  # noqa: BLE001
        print(f"gov_runs append failed: {exc}")


def finish(ledger, spark, lakehouse: str, *, dry_run: bool) -> str:
    summary = ledger.finish()
    write_run_row(spark, lakehouse, summary, dry_run=dry_run)
    result = ledger.exit_value(dry_run=dry_run)
    try:
        import notebookutils  # type: ignore

        notebookutils.notebook.exit(json.dumps(result))
    except ImportError:
        print(json.dumps(result, indent=2))
    return json.dumps(result)
