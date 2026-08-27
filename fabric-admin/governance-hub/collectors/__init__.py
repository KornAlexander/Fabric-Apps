"""Collector shaping layer (PLAN.md §15).

Pure Python, no Spark and no network, so the risky part of a collector — the
shaping — is unit tested offline and then inlined verbatim into the notebooks by
`bootstrap/build_ipynb.py`.
"""
