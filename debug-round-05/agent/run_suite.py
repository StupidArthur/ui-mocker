"""debug-round-05 Case Suite 编排器。

用法：
  LLM_API_KEY=... python3 run_suite.py --phase 1 --runs 1 --cases 01,02,...
  LLM_API_KEY=... python3 run_suite.py --phase 2 --runs 5 --cases 01,04,05,...

每个 run：停后端 -> reset demo -> 起后端 -> (按需) API 预置 sensor_sample -> 跑 Case，
artifact 存到 agent/p<phase>/case-XX-run-YY.jsonl，指标追加到 agent/runs.csv。
API key 仅来自环境变量，不写入文件。
"""

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request

BASE = "/Users/arthur/code/ui-mocker"
DEMO = f"{BASE}/demo_01"
BACKEND = f"{DEMO}/backend"
FRONTEND = f"{DEMO}/frontend"
ROUND = f"{BASE}/debug-round-05"
CASES_DIR = f"{ROUND}/cases"
RUN_AGENT = f"{ROUND}/agent/run_agent.py"
CSV = f"{ROUND}/agent/runs.csv"

# case -> (file, needs_dataset)
CASES = {
    "01": ("case-01-login-nav.yaml", False),
    "02": ("case-02-admin-modal.yaml", False),
    "03": ("case-03-upload.yaml", False),
    "04": ("case-04-create-project-route.yaml", True),
    "05": ("case-05-algorithm-result.yaml", True),
    "06": ("case-06-publish-toggle.yaml", True),
    "07": ("case-07-delete-confirm.yaml", True),
    "08": ("case-08-full-chain.yaml", True),
    "09": ("case-09-login-failure.yaml", False),
}

CSV_HEADER = (
    "case,run,phase,status,elapsedMs,actionCount,modelCallCount,promptTokens,completionTokens,totalTokens,"
    "firstSuccessIteration,terminalLag,sameSnapshotObserveCount,verificationCount,rescue,"
    "malformedModelResponseCount,mcpErrorCount,duplicateOperationCount,decisionEfficiency,businessCheck,reason"
)

API = "http://localhost:8000/api"


def _api(path, method="GET", token=None, body=None):
    req = urllib.request.Request(API + path, method=method)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    if body is not None:
        req.add_header("content-type", "application/json")
        req.data = json.dumps(body).encode()
    with urllib.request.urlopen(req, timeout=8) as r:
        return json.loads(r.read().decode())


def _admin_token():
    return _api("/auth/login", "POST", body={"username": "admin", "password": "admin123"})["token"]


def business_check(case_id, status):
    """False-positive guard: 独立于 Agent 的 verifier，用后端真实业务状态复核。"""
    if case_id == "09":
        return "expected-failed" if status == "failed" else "UNEXPECTED-PASS"
    if case_id in ("01",):
        return "n/a"
    try:
        t = _admin_token()
        if case_id == "02":
            users = _api("/admin/users", token=t)
            return "ok" if any(u.get("username") == "case_user" for u in users) else "MISSING case_user"
        if case_id in ("03", "07"):
            datasets = _api("/datasets", token=t)
            has = any(d.get("name") == "sensor_sample" for d in datasets)
            if case_id == "03":
                return "ok" if has else "MISSING sensor_sample"
            return "ok" if not has else "STILL-PRESENT sensor_sample"
        if case_id in ("04", "05", "06"):
            projects = _api("/projects?scope=mine", token=t)
            wanted = {"04": "导航项目", "05": "算法项目", "06": "公开验证项目"}[case_id]
            proj = next((p for p in projects if p.get("name") == wanted), None)
            if not proj:
                return f"MISSING project {wanted}"
            if case_id == "05":
                runs = _api(f"/projects/{proj['id']}/runs", token=t)
                return "ok" if len(runs) >= 1 else "NO runs"
            if case_id == "06":
                return "ok" if proj.get("is_public") else "NOT public"
            return "ok"
        if case_id == "08":
            projects = _api("/projects?scope=mine", token=t)
            for p in projects:
                runs = _api(f"/projects/{p['id']}/runs", token=t)
                if any(r.get("status") == "approved" for r in runs):
                    return "ok"
            return "NO approved run"
    except Exception as exc:
        return f"check-error {exc}"
    return "unknown"


def sh(cmd, cwd=None, timeout=180):
    return subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True, timeout=timeout)


def http_ok(url, timeout=3):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status == 200
    except Exception:
        return False


def ensure_frontend():
    if http_ok("http://localhost:5173/login"):
        return
    sh(f"nohup npm run dev > {ROUND}/demo/frontend-run.log 2>&1 & disown", cwd=FRONTEND)
    for _ in range(15):
        time.sleep(1)
        if http_ok("http://localhost:5173/login"):
            return
    raise RuntimeError("frontend did not start")


def reset_demo(needs_dataset):
    sh("pkill -f 'uvicorn main:app'")
    time.sleep(1)
    sh("python3 reset_demo.py", cwd=DEMO)
    time.sleep(1)
    sh(f"nohup .venv/bin/python -m uvicorn main:app --port 8000 >> {ROUND}/demo/backend-run.log 2>&1 & disown", cwd=BACKEND)
    for _ in range(20):
        time.sleep(1)
        if http_ok("http://localhost:8000/api/health"):
            break
    else:
        raise RuntimeError("backend did not start")
    if needs_dataset:
        r = sh(f"bash {ROUND}/demo/seed_dataset.sh", cwd=BASE, timeout=60)
        if r.returncode != 0:
            raise RuntimeError(f"seed failed: {r.stderr[-300:]}")


def run_case(case_id, run_no, phase):
    case_file, needs_dataset = CASES[case_id]
    outdir = f"{ROUND}/agent/p{phase}"
    os.makedirs(outdir, exist_ok=True)
    artifact = f"{outdir}/case-{case_id}-run-{run_no:02d}.jsonl"
    console = f"{outdir}/case-{case_id}-run-{run_no:02d}.console.log"
    driver = {
        "session_id": f"r05-c{case_id}-r{run_no}",
        "artifact": artifact,
        "console": console,
        "commands": [f"/run {CASES_DIR}/{case_file}"],
        "case_timeout": 340,
        "mcp_log": f"{ROUND}/agent/mcp-stderr.log",
        "env": {
            "LLM_BASE_URL": "https://api.deepseek.com/v1",
            "LLM_MODEL": "deepseek-flash",
            "LLM_REASONING_EFFORT": "low",
        },
    }
    cfg = f"{ROUND}/agent/driver-{case_id}-{run_no}.json"
    with open(cfg, "w") as f:
        json.dump(driver, f)

    started = time.time()
    hung = False
    try:
        r = subprocess.run(["python3", RUN_AGENT, cfg], capture_output=True, text=True, timeout=360, cwd=BASE)
        out = (r.stdout or "") + (r.stderr or "")
    except subprocess.TimeoutExpired:
        sh("pkill -f 'tsx src/cli.ts'")
        out = ""
        hung = True
    elapsed_ms = int((time.time() - started) * 1000)

    row = {
        "case": case_id, "run": run_no, "phase": phase,
        "status": "hung" if hung else "unknown", "elapsedMs": elapsed_ms,
        "actionCount": "", "modelCallCount": "", "promptTokens": "", "completionTokens": "", "totalTokens": "",
        "firstSuccessIteration": "", "terminalLag": "", "sameSnapshotObserveCount": "", "verificationCount": "",
        "rescue": "", "malformedModelResponseCount": "", "mcpErrorCount": "", "duplicateOperationCount": "",
        "decisionEfficiency": "", "reason": "",
    }
    for line in out.splitlines():
        if line.startswith("[driver] result after"):
            _, _, rest = line.partition(": ")
            seg = rest.split(":", 1)
            if len(seg) == 2:
                row["status"] = seg[0].split("] ", 1)[-1].strip()
                row["reason"] = seg[1].strip()[:160]
            break

    try:
        rec = None
        for line in open(artifact):
            line = line.strip()
            if not line:
                continue
            j = json.loads(line)
            if j.get("recordType") == "case":
                rec = j
        if rec:
            usage = rec.get("usage") or {}
            m = rec.get("metrics") or {}
            iters = len(rec.get("iterations", []))
            row["status"] = rec.get("status", row["status"])
            row["actionCount"] = rec.get("actionCount", "")
            row["modelCallCount"] = rec.get("modelCallCount", "")
            row["promptTokens"] = usage.get("promptTokens", "")
            row["completionTokens"] = usage.get("completionTokens", "")
            row["totalTokens"] = usage.get("totalTokens", "")
            row["firstSuccessIteration"] = m.get("firstSuccessIteration", "")
            if isinstance(m.get("firstSuccessIteration"), int):
                row["terminalLag"] = iters - m["firstSuccessIteration"]
            row["sameSnapshotObserveCount"] = m.get("sameSnapshotObserveCount", "")
            row["verificationCount"] = m.get("verificationCount", "")
            row["rescue"] = m.get("rescue", "") or ""
            row["malformedModelResponseCount"] = m.get("malformedModelResponseCount", "")
            row["mcpErrorCount"] = m.get("mcpErrorCount", "")
            row["duplicateOperationCount"] = m.get("duplicateOperationCount", "")
            if rec.get("actionCount") and rec.get("modelCallCount"):
                row["decisionEfficiency"] = round(rec["actionCount"] / rec["modelCallCount"], 3)
    except Exception as exc:
        row["reason"] = (row["reason"] + f" | artifact parse error: {exc}")[:200]

    row["businessCheck"] = business_check(case_id, row["status"])
    with open(CSV, "a") as f:
        f.write(",".join(str(row[k]) for k in CSV_HEADER.split(",")) + "\n")
    print(
        f"[case {case_id} run {run_no}] {row['status']} business={row['businessCheck']} actions={row['actionCount']} "
        f"calls={row['modelCallCount']} tokens={row['totalTokens']} terminalLag={row['terminalLag']} "
        f"sameObs={row['sameSnapshotObserveCount']} rescue={row['rescue'] or '-'} ({elapsed_ms}ms)",
        flush=True,
    )
    return row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase", default="1")
    ap.add_argument("--runs", type=int, default=1)
    ap.add_argument("--cases", default=",".join(CASES.keys()))
    args = ap.parse_args()
    if not os.environ.get("LLM_API_KEY"):
        print("ERROR: LLM_API_KEY env required", file=sys.stderr)
        sys.exit(2)
    ids = [c.strip().zfill(2) for c in args.cases.split(",") if c.strip()]
    if not os.path.exists(CSV):
        with open(CSV, "w") as f:
            f.write(CSV_HEADER + "\n")
    ensure_frontend()
    for case_id in ids:
        for run_no in range(1, args.runs + 1):
            _, needs_dataset = CASES[case_id]
            reset_demo(needs_dataset)
            run_case(case_id, run_no, args.phase)


if __name__ == "__main__":
    main()
