# Rule Do/Don't chart images

Drop the per-rule chart pictures here. Two files per IBCS rule:

- `do/<CODE>.png`   — the compliant ("Do") chart
- `dont/<CODE>.png` — the violation ("Don't") chart, **with the diagonal
  strike-through line removed** (the games mark violations themselves)

`<CODE>` is the rule code with spaces and dots replaced by hyphens
(e.g. `SI 1.1` → `SI-1-1.png`).

The full list of expected filenames for all 98 rules is in
[`docs/IBCS-Rule-Image-Mapping.md`](../../../docs/IBCS-Rule-Image-Mapping.md).

Until a file exists, the games fall back to the procedural chart glyph drawn by
`ibcs_charts.js`, so the bank can be filled in incrementally.
