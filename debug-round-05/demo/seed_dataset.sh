#!/bin/bash
# 环境准备：通过后端 API 预置 sensor_sample 数据集（不使用 agent/UI 上传操作）。
# 用法：bash seed_dataset.sh
set -euo pipefail

BASE="http://localhost:8000/api"
CSV="/Users/arthur/code/ui-mocker/demo_01/backend/sample_data/sensor_sample.csv"

TOKEN=$(curl -sS -m 10 -X POST "$BASE/auth/login" \
  -H 'content-type: application/json' \
  -d '{"username":"admin","password":"admin123"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

curl -sS -m 30 -X POST "$BASE/datasets" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@$CSV" \
  -F "name=sensor_sample" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print("seeded dataset:", d.get("id"), d.get("name"), d.get("row_count"), "rows")'
