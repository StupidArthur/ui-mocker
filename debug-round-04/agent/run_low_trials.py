"""DeepSeek flash low 连续 Case B 试验编排。

每个 trial：停后端 → reset → 起后端 → API 预置数据集 → 跑一次 Case B（DeepSeek low），
收集 status/actions/modelCalls/metrics/usage，追加到 trials.csv。
API key 从进程环境变量 LLM_API_KEY 读取，不写入任何文件。
"""

import json
import os
import subprocess
import sys
import time

BASE = "/Users/arthur/code/ui-mocker"
DEMO = f"{BASE}/demo_01"
BACKEND = f"{DEMO}/backend"
AGENT = f"{BASE}/webui-agent"
ROUND = f"{BASE}/debug-round-04"
CASE = f"{ROUND}/agent/case-b.yaml"
CSV = f"{ROUND}/trials.csv"

os.environ.setdefault("LLM_API_KEY", "")
assert os.environ.get("LLM_API_KEY"), "LLM_API_KEY env required"

MCP_LOG = f"{ROUND}/agent/mcp-stderr.log"
CSV_HEADER = "trial,status,actions,modelCalls,tokens,firstSuccessIteration,sameSnapshotObserveCount,rescue,reason"


def sh(cmd, cwd=None, timeout=180):
    return subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True, timeout=timeout)


def reset_and_seed():
    sh("pkill -f 'uvicorn main:app'")
    time.sleep(1)
    sh("python3 reset_demo.py", cwd=DEMO)
    time.sleep(1)
    sh("nohup .venv/bin/python -m uvicorn main:app --port 8000 "
       f">> {ROUND}/demo/backend-run.log 2>&1 & disown", cwd=BACKEND)
    time.sleep(4)
    r = sh(f"bash {ROUND}/demo/seed_dataset.sh", cwd=BASE, timeout=60)
    if r.returncode != 0:
        print("seed failed:", r.stderr[-500:], flush=True)


def run_one(trial):
    artifact = f"{ROUND}/agent/case-b-deepseek-low-run{trial:02d}.jsonl"
    console = f"{ROUND}/agent/case-b-deepseek-low-run{trial:02d}.console.log"
    driver_json = {
        "session_id": f"ds-low-trial-{trial}",
        "artifact": artifact,
        "console": console,
        "commands": [f"/run {CASE}"],
        "case_timeout": 700,
        "mcp_log": MCP_LOG,
        "env": {
            "LLM_BASE_URL": "https://api.deepseek.com/v1",
            "LLM_MODEL": "deepseek-flash",
            "LLM_REASONING_EFFORT": "low",
        },
    }
    cfg = f"{ROUND}/agent/trial-{trial:02d}.driver.json"
    with open(cfg, "w") as f:
        json.dump(driver_json, f)
    # 每轮前清理上一轮可能残留的 agent/Chrome
    sh("pkill -f 'tsx src/cli.ts'")
    started = time.time()
    try:
        r = subprocess.run(
            ["python3", f"{ROUND}/agent/run_agent.py", cfg],
            capture_output=True, text=True, timeout=300, cwd=BASE,
        )
        out = (r.stdout or "") + (r.stderr or "")
        hung = False
    except subprocess.TimeoutExpired:
        sh("pkill -f 'tsx src/cli.ts'")
        out = ""
        hung = True
    elapsed = int(time.time() - started)
    status = reason = "unknown"
    if hung:
        status, reason = "hung", "driver watchdog killed it after 300s"
    for line in out.splitlines():
        if line.startswith("[driver] result after"):
            head, _, rest = line.partition(": ")
            seg = rest.split(":", 1)
            status = seg[0].split("] ", 1)[-1].strip() if len(seg) == 2 else "unknown"
            reason = seg[1].strip()[:180] if len(seg) == 2 else rest[:180]
            break
    # metrics from artifact
    actions = model_calls = tokens = first_it = same_obs = -1
    rescue = ""
    try:
        for line in open(artifact):
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            if rec.get("recordType") != "case":
                continue
            actions = rec.get("actionCount")
            model_calls = rec.get("modelCallCount")
            tokens = (rec.get("usage") or {}).get("totalTokens", -1)
            m = rec.get("metrics") or {}
            first_it = m.get("firstSuccessIteration", -1)
            same_obs = m.get("sameSnapshotObserveCount", -1)
            rescue = m.get("rescue", "") or ""
    except Exception as exc:
        print("artifact parse error:", exc, flush=True)
    row = f"{trial},{status},{actions},{model_calls},{tokens},{first_it},{same_obs},{rescue},{reason}"
    with open(CSV, "a") as f:
        f.write(row + "\n")
    print(f"[trial {trial}] {status} actions={actions} modelCalls={model_calls} "
          f"tokens={tokens} firstSuccessIt={first_it} sameObserve={same_obs} rescue={rescue or '-'} "
          f"({elapsed}s)", flush=True)


def main():
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    count = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    if start == 1 and not os.path.exists(CSV):
        with open(CSV, "w") as f:
            f.write(CSV_HEADER + "\n")
    for i in range(start, start + count):
        reset_and_seed()
        run_one(i)


if __name__ == "__main__":
    main()
