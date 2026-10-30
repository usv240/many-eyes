# Regenerate Mission Reports

Mission Reports in `reports/` are derived artifacts. Regenerate their published counts and results by replaying every event in `data/ledger.jsonl`, preserving the ledger's append-only hash chain. Write the regenerated JSON to `reports/latest.json` and its human-readable Markdown companion to `reports/latest.md`. Run `npm run verify` to recompute the report and compare it with `reports/latest.json`; resolve any mismatch by fixing the source ledger or report generator, never by editing a published total by hand.
