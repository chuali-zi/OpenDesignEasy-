## AppContainer probe (2026-07-26)
- appcontainer_probe.py: CreateAppContainerProfile + CreateProcessW with
  PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES via ctypes SUCCEEDED at the
  OS-call level (profile created, SID derived, process launched).
- Child immediately exited with 0xC0000135 (STATUS_DLL_NOT_FOUND): the
  AppContainer token has no ACL on the Python install dir, so it can't
  load python3xx.dll.
- Attempted fix: icacls grant "ALL APPLICATION PACKAGES" RX on the Python
  install dir. BLOCKED by the harness's own permission classifier as an
  unreviewed persistent machine-wide ACL change -- did not bypass, this
  itself is evidence for the RESULT.md verdict (real AppContainer sandboxing
  needs admin-level, persistent, machine-wide setup, not pure per-session
  Python).
- Found pre-existing `CodexSandboxUsers` local group + custom capability
  SIDs already on this machine (visible via icacls on Python312 dir) --
  another AI coding tool already needed this kind of OS-level setup.

## Real-world corroboration (read-only observation, no changes made)
- `netsh advfirewall firewall show rule name=all` shows pre-existing rules
  from other installed AI coding tools: "AIProxyGuard_TCP_..." /
  "AIProxyGuard_UDP443_..." block outbound TCP 80/443 and UDP 443, each
  SCOPED TO A SPECIFIC FULL EXE PATH (e.g. Codex's node_repl.exe, the
  ChatGPT/Codex VS Code extension's codex.exe). This is exactly the
  "per-executable-path firewall rule" mechanism I hypothesized as the only
  viable pure-Windows network block. It corroborates that:
  1. the mechanism works and is what shipped tools actually use;
  2. it needs admin/installer-time elevation to set up (confirmed earlier:
     `netsh advfirewall firewall add rule` fails without elevation in this
     shell) -- not something a per-session sandboxed run can self-provision.
- Also confirms real tools scope the rule to a DEDICATED binary path, not
  the shared system python.exe -- adding a rule against a shared
  interpreter would break everything else using it. A real implementation
  needs a dedicated sandboxed python.exe (or venv copy) so the firewall
  rule doesn't collateral-damage the whole machine's Python usage.

## Attack matrix run (2026-07-26)
- run_attacks.py: 24 result rows -> attack_results.json. All 6 file-escape
  attack classes (dotdot/absolute/junction/UNC/\?\) ESCAPED in both naive
  and Job-Object-hardened mode -- confirms Job Object + clean env give ZERO
  filesystem confinement, as documented in sandbox.py.
- Job Object DID correctly: reap grandchild process tree on timeout
  (heartbeat frozen vs naive proc.kill() leaving grandchild running),
  cap memory (MemoryError at ~90MB against a 100MB cap), truncate flood
  output at the configured byte cap without blocking the child.
- Credential test surfaced a real finding: this dev machine's actual shell
  env already carries DEEPSEEK_API_KEY/GITEE_TOKEN/MCP_API_KEY/etc from
  unrelated tools. Naive `env=os.environ.copy()` leaks ALL of them into
  any child; build_clean_env()'s explicit allowlist correctly excludes
  every one (verified: 8 keys total, no credential-shaped names).
- Network: no mitigation -> both raw socket and urllib escape. Proxy env
  vars only stop the proxy-aware urllib path, NOT raw sockets -- proven
  insufficient as a security boundary for untrusted/generated code.
  Firewall rule creation without admin -> "requires elevation" (confirmed
  empirically, not assumed).
- Found real corroborating evidence already on this machine: a
  `CodexSandboxUsers` local group + dedicated sandbox user accounts (Codex
  CLI), and pre-existing Windows Firewall rules from other AI coding tools
  ("AIProxyGuard_TCP/UDP...") that block outbound 80/443/443-udp scoped to
  one specific full exe path -- exactly the mechanism I'd have proposed,
  and it needed admin/installer-time setup.

## A2 render (2026-07-26)
- Playwright channel="chrome": local page loads (CSS+JS+local PNG all
  resolve), two external resources (image+script) blocked via
  context.route() interception at the Playwright/CDP layer -- captured in
  both requestfailed events and console errors (net::ERR_BLOCKED_BY_CLIENT).
  console.log/console.error both captured. Screenshot produced (18.7KB),
  visually confirms external image broken, local styling applied.
- Wrapped the whole driver (spawns Chrome as descendant) in the same Job
  Object: 150MB cap -> Playwright driver connection died (too low for a
  full Chromium stack); 1GB cap -> clean success, elapsed 2.2s. Confirms
  the same Job Object mechanism generalizes to the render tool, but the
  practical memory floor for a browser-based render sandbox is much higher
  than for a plain code-exec sandbox (150MB insufficient, 1GB sufficient).
- Gotcha found: build_clean_env()'s allowlist stripped PROGRAMFILES/
  LOCALAPPDATA, which broke Playwright's own Chrome-channel discovery --
  had to add those back via extra_env. Real lesson: the credential-safe
  env allowlist needs to be tool-aware, not a single universal list.
