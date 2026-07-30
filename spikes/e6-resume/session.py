"""Persistable agent session for the E6 resume spike.

Workspace layout (trimmed from agent-engine-spec.md 3 to what this spike
needs -- no repo/ or out/, just the agent's free area and its session state):

  <workspace_dir>/
    work/            agent's file area; read_file/write_file/list_files
                      operate here. Files are plain disk files -- they
                      survive a simulated crash for free.
    .agent/
      turns.json     turn history: system/user/assistant/tool messages,
                      exactly what would be replayed to the model to resume.
      budget.json     cumulative token/step/duration ledger. Never reset by
                      load(); resume continues accumulating into it.
      tool_log.json  per-call log: step, tool name, path, ok/error. No file
                      content or prompt text (runtime-recovery.md 8
                      allowlist: audit metadata only, not payloads).
      meta.json      last known termination_reason.

A "crash" is simulated by simply stopping the Python loop after N completed
steps (save() has already run at that point, since save() happens at the end
of every step). Resuming means constructing a brand new AgentSession purely
by reading these files back off disk -- no Python object or variable is
shared across the simulated crash boundary, which is the point: this is what
a real process restart would see.
"""
from __future__ import annotations

import json
import random
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path

SPIKE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SPIKE_DIR))
sys.path.insert(0, str(SPIKE_DIR.parent / "_lib"))

from kimi import chat  # noqa: E402
from tools import TOOLS_SCHEMA, execute_tool, validate_call  # noqa: E402

MAX_TOKENS_PER_CALL = 4096
RETRY_MAX_ATTEMPTS = 5
RETRY_BASE_DELAY_S = 2.0

SYSTEM_PROMPT = (
    "You are a careful coding agent operating autonomously in a persistent "
    "workspace that may survive across multiple process lifetimes. You must "
    "accomplish the task using only the provided tools. Think step by step, "
    "use tools to make progress, and verify your own work before declaring "
    "completion."
)

TASK_PROMPT = """Build a tiny 3-file static website in your workspace: \
index.html, styles.css, script.js. Paths you pass to tools are relative to \
the workspace root (e.g. 'index.html'), never absolute.

Requirements:
1. Use write_file to create index.html: a valid HTML5 doctype, a <title>, a \
heading, one paragraph of real (non-lorem-ipsum) text about a fictional \
small product of your choosing, a <link rel="stylesheet" href="styles.css"> \
and a <script src="script.js"></script>.
2. Right after writing index.html, use read_file to read it back and \
confirm the content is what you intended. This self-check is required for \
every file you create, right after you create it.
3. Use write_file to create styles.css with a handful of real CSS rules \
that style the page (body, the heading, the paragraph). Then read it back \
to self-check.
4. Use write_file to create script.js with one small real function (e.g. it \
logs a greeting or toggles something on the page). Then read it back to \
self-check.
5. You may use list_files at any point to see what already exists in your \
workspace.
6. When all three files exist and each has been self-checked, stop calling \
tools and reply with a short plain-text summary of what you built. Do not \
call any more tools after that summary.

Work only inside your workspace; do not attempt to access anything outside \
it.
"""


def _is_retryable_error(msg: str) -> bool:
    return "HTTP 429" in msg or any(f"HTTP 5{d}" in msg for d in "0123456789")


def _call_with_retry(messages, tools) -> tuple[dict, dict, float]:
    attempt = 0
    while True:
        try:
            return chat(messages, tools=tools, max_tokens=MAX_TOKENS_PER_CALL, temperature=1)
        except RuntimeError as exc:
            msg = str(exc)
            attempt += 1
            if not _is_retryable_error(msg) or attempt > RETRY_MAX_ATTEMPTS:
                raise
            delay = RETRY_BASE_DELAY_S * (2 ** (attempt - 1)) + random.uniform(0, 0.5)
            time.sleep(delay)


@dataclass
class Budget:
    """Cumulative ledger. Persisted; never reset by load()."""

    steps: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    reasoning_tokens: int = 0
    total_tokens: int = 0
    api_elapsed_s: float = 0.0
    wall_clock_s: float = 0.0

    def add_usage(self, usage: dict, elapsed: float) -> None:
        self.steps += 1
        self.prompt_tokens += usage.get("prompt_tokens", 0) or 0
        self.completion_tokens += usage.get("completion_tokens", 0) or 0
        self.total_tokens += usage.get("total_tokens", 0) or 0
        details = usage.get("completion_tokens_details")
        if isinstance(details, dict):
            self.reasoning_tokens += details.get("reasoning_tokens", 0) or 0
        self.api_elapsed_s = round(self.api_elapsed_s + elapsed, 3)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Budget":
        known = {f: d.get(f, 0) for f in cls.__dataclass_fields__}
        return cls(**known)


class AgentSession:
    def __init__(self, workspace_dir: Path):
        self.workspace_dir = Path(workspace_dir)
        self.work_dir = self.workspace_dir / "work"
        self.agent_dir = self.workspace_dir / ".agent"
        self.work_dir.mkdir(parents=True, exist_ok=True)
        self.agent_dir.mkdir(parents=True, exist_ok=True)
        self.messages: list[dict] = []
        self.budget = Budget()
        self.tool_log: list[dict] = []
        self.termination_reason: str | None = None

    # ---------------- persistence ----------------

    def save(self) -> None:
        (self.agent_dir / "turns.json").write_text(
            json.dumps(self.messages, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        (self.agent_dir / "budget.json").write_text(
            json.dumps(self.budget.to_dict(), indent=2), encoding="utf-8"
        )
        (self.agent_dir / "tool_log.json").write_text(
            json.dumps(self.tool_log, indent=2), encoding="utf-8"
        )
        (self.agent_dir / "meta.json").write_text(
            json.dumps({"termination_reason": self.termination_reason}, indent=2),
            encoding="utf-8",
        )

    @classmethod
    def load(cls, workspace_dir: Path) -> "AgentSession":
        """Reconstruct a session purely from what is on disk. Simulates a
        fresh process reading persisted state after a restart -- nothing
        Python-level is shared with whatever wrote these files."""
        sess = cls(workspace_dir)
        turns_path = sess.agent_dir / "turns.json"
        if not turns_path.exists():
            raise FileNotFoundError(f"no persisted turn history at {turns_path}")
        sess.messages = json.loads(turns_path.read_text(encoding="utf-8"))
        budget_path = sess.agent_dir / "budget.json"
        if budget_path.exists():
            sess.budget = Budget.from_dict(json.loads(budget_path.read_text(encoding="utf-8")))
        tool_log_path = sess.agent_dir / "tool_log.json"
        if tool_log_path.exists():
            sess.tool_log = json.loads(tool_log_path.read_text(encoding="utf-8"))
        meta_path = sess.agent_dir / "meta.json"
        if meta_path.exists():
            sess.termination_reason = json.loads(meta_path.read_text(encoding="utf-8")).get(
                "termination_reason"
            )
        return sess

    def start_fresh(self, system_prompt: str = SYSTEM_PROMPT, task_prompt: str = TASK_PROMPT) -> None:
        self.messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": task_prompt},
        ]
        self.save()

    # ---------------- the loop ----------------

    def run(self, max_steps: int, stop_after_steps: int | None = None) -> str:
        """Advance the loop.

        stop_after_steps: absolute cumulative step count (self.budget.steps)
        at which to simulate a crash BEFORE issuing the next API call -- the
        realistic "process died between turns, after the previous turn's
        result was already persisted" point. None means run to natural
        completion or max_steps.

        Returns termination_reason: 'self_terminated' | 'step_limit' |
        'api_error' | 'simulated_crash' | 'malformed_tool_call_no_id'.
        """
        while True:
            if stop_after_steps is not None and self.budget.steps >= stop_after_steps:
                self.termination_reason = "simulated_crash"
                self.save()
                return self.termination_reason
            if self.budget.steps >= max_steps:
                self.termination_reason = "step_limit"
                self.save()
                return self.termination_reason

            step_t0 = time.time()
            try:
                message, usage, elapsed = _call_with_retry(self.messages, TOOLS_SCHEMA)
            except RuntimeError as exc:
                self.termination_reason = "api_error"
                self.tool_log.append({"step": self.budget.steps + 1, "error": str(exc)[:200]})
                self.save()
                return self.termination_reason

            self.budget.add_usage(usage, elapsed)
            step_no = self.budget.steps

            tool_calls = message.get("tool_calls") or []
            assistant_msg = {"role": "assistant", "content": message.get("content") or ""}
            if tool_calls:
                assistant_msg["tool_calls"] = tool_calls
            self.messages.append(assistant_msg)

            if not tool_calls:
                self.termination_reason = "self_terminated"
                self.budget.wall_clock_s = round(self.budget.wall_clock_s + (time.time() - step_t0), 3)
                self.save()
                return self.termination_reason

            broke_on_missing_id = False
            for tc in tool_calls:
                tc_id = tc.get("id")
                fn = tc.get("function") or {}
                name = fn.get("name")
                arguments_raw = fn.get("arguments")

                args, err = validate_call(name, arguments_raw)
                if err is not None:
                    result_content = json.dumps({"error": err})
                    ok = False
                    path = None
                else:
                    result_content, ok, path = execute_tool(self.work_dir, name, args)

                self.tool_log.append({"step": step_no, "tool": name, "path": path, "ok": ok})

                if tc_id is None:
                    broke_on_missing_id = True
                    break
                self.messages.append(
                    {"role": "tool", "tool_call_id": tc_id, "content": result_content}
                )

            self.budget.wall_clock_s = round(self.budget.wall_clock_s + (time.time() - step_t0), 3)
            if broke_on_missing_id:
                self.termination_reason = "malformed_tool_call_no_id"
                self.save()
                return self.termination_reason

            self.save()  # persist after every full step -- this is what makes resume possible
