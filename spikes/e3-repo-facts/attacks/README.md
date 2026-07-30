# Q8 contradiction attacks

This directory tests false negatives without changing repository product files or the saved
no-false-positive corpus.

- `fixtures.json` mutates one existing fact ID per attack in an isolated copy of
  `outputs/fact_package.json`.
- `run_attacks.py` reuses `run_generation.py` prompts, calls Kimi only through
  `spikes/_lib/kimi.py` with `temperature=1`, and reviews model text against the unchanged
  `outputs/facts.json` via `reviewer.py`.
- The runner launches no subprocesses. Credentials remain inside the in-process Kimi client
  and are not written to requests or results.
- Only HTTP 429 and 5xx failures are retried, with exponential backoff. Persistent API errors,
  stale fixtures, empty responses, omitted injected claims, or runner errors produce
  `results/run_summary.json` with `status: BLOCKED` and stop the track.
- Raw reviewer label `traceable_contradict` is the existing implementation's documented
  equivalent of canonical `traceable_but_contradictory`; both are retained in judgments.

Run all attacks from the repository root:

```powershell
python spikes/e3-repo-facts/attacks/run_attacks.py
```
