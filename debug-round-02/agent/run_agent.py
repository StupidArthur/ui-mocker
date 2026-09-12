"""Debug harness: drive the webui-agent REPL command-by-command over a pipe.

Sends a command only after the agent banner appears, and waits for the
case result line before sending the next command. Captures merged console
output to a log. This is evidence tooling only; it does not modify the agent.
"""

import os
import queue
import re
import subprocess
import sys
import threading
import time

AGENT_DIR = "/Users/arthur/code/ui-mocker/webui-agent"
RESULT_RE = re.compile(r"^\[\d+\] (passed|failed|blocked|timeout):")
BANNER = "WebUI step agent connected"


def drive(session_id, artifact, console, commands, case_timeout, headless=False, mcp_log=None):
    env = os.environ.copy()
    env["WEBUI_SESSION_ID"] = session_id
    env["WEBUI_ARTIFACT_PATH"] = artifact
    env["WEBUI_MCP_LOG_PATH"] = mcp_log or "/Users/arthur/code/ui-mocker/debug-round-01/agent/mcp-stderr.log"
    if headless:
        env["WEBUI_HEADLESS"] = "1"

    proc = subprocess.Popen(
        ["npx", "tsx", "src/cli.ts"],
        cwd=AGENT_DIR,
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    log = open(console, "w")
    lines: "queue.Queue[str]" = queue.Queue()

    def reader():
        for line in proc.stdout:
            log.write(line)
            log.flush()
            lines.put(line)

    threading.Thread(target=reader, daemon=True).start()

    def wait_for(pred, timeout):
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                line = lines.get(timeout=min(1.0, max(0.0, deadline - time.time())))
            except queue.Empty:
                continue
            if pred(line):
                return line
        return None

    if wait_for(lambda l: BANNER in l, 180) is None:
        print("FATAL: banner not seen", file=sys.stderr)
        proc.kill()
        return 1

    for command in commands:
        print(f"[driver] sending: {command[:80]}", flush=True)
        started = time.time()
        proc.stdin.write(command + "\n")
        proc.stdin.flush()
        result = wait_for(lambda l: RESULT_RE.match(l), case_timeout)
        elapsed = time.time() - started
        if result is None:
            print(f"[driver] no result line within {case_timeout}s", flush=True)
            break
        print(f"[driver] result after {elapsed:.0f}s: {result.strip()}", flush=True)

    proc.stdin.write("/exit\n")
    proc.stdin.flush()
    try:
        proc.wait(timeout=60)
    except subprocess.TimeoutExpired:
        proc.kill()
    log.close()
    return proc.returncode or 0


if __name__ == "__main__":
    import json

    config = json.load(open(sys.argv[1]))
    raise SystemExit(
        drive(
            config["session_id"],
            config["artifact"],
            config["console"],
            config["commands"],
            config.get("case_timeout", 600),
            config.get("headless", False),
            config.get("mcp_log"),
        )
    )
