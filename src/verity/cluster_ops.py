"""Safe, narrow shell-out to the ccloud CLI for agent-driven cluster awareness.

Only ever invokes a fixed script with a fixed argument list (no user input
is ever interpolated into a shell command), and only to *read* cluster
state — this is deliberately not a general "run arbitrary ccloud command"
tool. Used as a preflight check before bulk document ingestion so the
pipeline fails fast with a clear reason instead of hammering a
degraded cluster.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

_OPS_DIR = Path(__file__).resolve().parent.parent.parent / "ops" / "ccloud"

# On Windows, plain "bash" can resolve to the WSL launcher at
# C:\Windows\System32\bash.exe instead of Git Bash, if both are installed and
# System32 comes first on PATH. WSL's bash runs in a separate Linux
# filesystem/environment with no access to Windows PATH or ccloud.exe, so
# scripts silently fail with "command not found". Prefer Git Bash explicitly
# when it exists; fall back to plain "bash" (correct on macOS/Linux/CI).
_GIT_BASH_CANDIDATES = [
    r"C:\Program Files\Git\usr\bin\bash.exe",
    r"C:\Program Files\Git\bin\bash.exe",
]


def _resolve_bash() -> str:
    for candidate in _GIT_BASH_CANDIDATES:
        if Path(candidate).exists():
            return candidate
    return "bash"


def preflight_health_check(cluster_name: str) -> dict:
    """Run ops/ccloud/health_check.sh and return its parsed JSON result.

    Raises RuntimeError if the script fails or the cluster is unhealthy —
    callers (e.g. ingestion.ingest_document for large batches) should treat
    that as "do not proceed", not as something to silently swallow.
    """
    script = _OPS_DIR / "health_check.sh"
    bash = _resolve_bash()
    try:
        result = subprocess.run(
            [bash, str(script), cluster_name],
            # Extend, don't replace, the environment - passing a bare dict
            # here would drop PATH and every other inherited variable, so
            # the script's `ccloud` / `jq` calls would fail to resolve at all.
            env={**os.environ},
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except FileNotFoundError as exc:
        raise RuntimeError(
            "bash not found — ccloud health checks require a bash-capable shell "
            "(Git Bash / WSL on Windows)."
        ) from exc

    try:
        payload = json.loads(result.stdout.strip().splitlines()[-1])
    except (json.JSONDecodeError, IndexError) as exc:
        raise RuntimeError(f"Unexpected ccloud health check output: {result.stdout!r}") from exc

    if not payload.get("healthy"):
        raise RuntimeError(f"Cluster is not healthy for bulk operations: {payload}")

    return payload
