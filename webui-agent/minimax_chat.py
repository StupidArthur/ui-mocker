"""MiniMax-M3 同步 chat 调用模块。

只做一件事：用 MiniMax-M3 模型做同步 chat 调用。
支持 thinking 开/关（对应官方参数 thinking.type 的 adaptive / disabled），
支持流式 / 非流式两种返回方式。

设计考量：
- 端点与模型名固定（api.minimaxi.com/v1 + MiniMax-M3），不做注册表与配置持久化，
  需要更多模型/供应商时再扩展。
- reasoning_split 恒为 True：M3 的思考过程放在 reasoning_content，content 返回干净答案，
  避免下游解析被 think 污染。
- M3 是深度思考模型，thinking 关闭时响应快约 3 倍；开启时适合复杂推理场景。
"""

from __future__ import annotations

import logging
import time
from collections.abc import Iterator

import openai

# ====== 配置（模块最上方，便于调整）======
API_KEY = "sk-cp-aXV4X8TlWZeR3E1hpIaPtjEFnafrpbEi_IMlm6NhSY_0-CQHOV5WupxDkg4LV2JXfB3sO_AoGodPCkQ6irIC7PuIoxC29MVKqG70AYz_hQ1VIjNDgSpCvOo"
API_URL = "https://api.minimaxi.com/v1"
MODEL = "MiniMax-M3"
DEFAULT_TEMPERATURE = 0.2
DEFAULT_MAX_TOKENS = 4096
MAX_RETRIES = 3          # 最多重试次数，与 Go 端 LlmMaxRetries 保持一致
BASE_DELAY_MS = 2000      # 重试基础退避毫秒，指数增长 2s/4s

log = logging.getLogger(__name__)

_client: openai.OpenAI | None = None


def _get_client(api_key: str) -> openai.OpenAI:
    """按 key 缓存同步客户端。

    缓存按 api_key 区分：不同 key 复用各自的连接池，避免 key 切换时串用旧客户端。
    """
    global _client
    if _client is None or _client.api_key != api_key:
        _client = openai.OpenAI(api_key=api_key, base_url=API_URL)
    return _client


def _extra_body(thinking: bool) -> dict:
    """构造 M3 需要的扩展参数。

    thinking=True  -> {"type": "adaptive"}  开启深度思考（M3 默认行为）
    thinking=False -> {"type": "disabled"}  关闭思考，直接回答（速度快约 3 倍）
    reasoning_split 恒开：思考过程与答案分离，content 只含干净回答。
    """
    return {
        "reasoning_split": True,
        "thinking": {"type": "adaptive" if thinking else "disabled"},
    }


def chat(
    messages: list[dict[str, str]],
    *,
    api_key: str = API_KEY,
    thinking: bool = True,
    temperature: float = DEFAULT_TEMPERATURE,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    max_retries: int = MAX_RETRIES,
) -> str:
    """向 M3 发送 messages，返回 assistant 纯文本（非流式）。

    失败时按指数退避重试（2s/4s），全部失败抛 RuntimeError。
    """
    client = _get_client(api_key)
    last_error: Exception | None = None

    for attempt in range(1, max_retries + 1):
        try:
            completion = client.chat.completions.create(
                model=MODEL,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                extra_body=_extra_body(thinking),
            )
            content = completion.choices[0].message.content
            if not content:
                raise ValueError("AI 返回空结果")
            return content
        except Exception as e:
            last_error = e
            if attempt < max_retries:
                delay = BASE_DELAY_MS * (2 ** (attempt - 1)) / 1000
                log.warning("调用失败（%s），第 %s 次重试，%ss 后重试...", e, attempt, delay)
                time.sleep(delay)

    raise RuntimeError(f"调用失败，已重试 {max_retries} 次: {last_error}")


def chat_stream(
    messages: list[dict[str, str]],
    *,
    api_key: str = API_KEY,
    thinking: bool = True,
    temperature: float = DEFAULT_TEMPERATURE,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    max_retries: int = MAX_RETRIES,
) -> Iterator[str]:
    """向 M3 发送 messages，逐块返回 assistant 文本（流式）。

    生成器：外层 for 循环消费。连接失败时在创建流阶段重试，
    流建立后中途断流则直接抛错（由调用方决定是否整体重试）。
    """
    client = _get_client(api_key)
    last_error: Exception | None = None

    for attempt in range(1, max_retries + 1):
        try:
            stream = client.chat.completions.create(
                model=MODEL,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                stream=True,
                extra_body=_extra_body(thinking),
            )
            for chunk in stream:
                piece = chunk.choices[0].delta.content
                if piece:
                    yield piece
            return
        except Exception as e:
            last_error = e
            if attempt < max_retries:
                delay = BASE_DELAY_MS * (2 ** (attempt - 1)) / 1000
                log.warning("流式调用失败（%s），第 %s 次重试，%ss 后重试...", e, attempt, delay)
                time.sleep(delay)

    raise RuntimeError(f"流式调用失败，已重试 {max_retries} 次: {last_error}")


if __name__ == "__main__":
    # 调试入口：直接改下面的 api_key 与消息即可，不做 CLI 解析
    _api_key = "sk-请替换为你的MiniMaxKey"
    messages = [{"role": "user", "content": "用一句话介绍你自己"}]

    print("=== 非流式 / thinking 关闭 ===")
    print(chat(messages, api_key=_api_key, thinking=False))

    print("=== 流式 / thinking 开启 ===")
    buf = []
    for piece in chat_stream(messages, api_key=_api_key, thinking=True):
        buf.append(piece)
    print("".join(buf))
