import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import { ArtifactRecord } from "./types.js";
import type { ArtifactSink } from "./session.js";

const SENSITIVE_KEY = /authorization|api[-_]?key|password|secret|token|credential/i;
const SENSITIVE_STRING = /Bearer\s+[A-Za-z0-9._~+\-/]+=*|sk-[A-Za-z0-9_-]+/gi;
// LLM 用量字段：名字含 "Tokens" 会被上面的正则误伤，但这些是纯数字指标，不是密钥。
const USAGE_KEYS = new Set(["promptTokens", "completionTokens", "totalTokens"]);

/** Appends one sanitized JSON record per line; raw browser evidence remains structured. */
export class JsonlArtifactSink implements ArtifactSink {
  constructor(readonly path: string) {}
  async write(record: ArtifactRecord): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(sanitizeForArtifact(record))}\n`, "utf8");
  }
}

export function sanitizeForArtifact(value: unknown, key?: string): unknown {
  if (key && USAGE_KEYS.has(key)) return value;
  if (key && SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") return value.replace(SENSITIVE_STRING, "[REDACTED]");
  if (Array.isArray(value)) return value.map((item) => sanitizeForArtifact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, sanitizeForArtifact(entryValue, entryKey)]));
  }
  return value;
}
