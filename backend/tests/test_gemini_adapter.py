"""Gemini transport contracts without network requests."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.config import settings
from app.services.llm_adapter import (
    GeminiCompletionStream,
    LLMAdapter,
    LLMResponseError,
    LLMTool,
    LLMToolResult,
    LLMUnavailableError,
)


class FakeStream:
    def __init__(self, chunks):
        self.chunks = chunks
        self.close = AsyncMock()

    async def __aiter__(self):
        for chunk in self.chunks:
            yield chunk


def chunk(text=None, calls=None, finish=None):
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                delta=SimpleNamespace(content=text, tool_calls=calls), finish_reason=finish
            )
        ],
        usage=None,
    )


@pytest.fixture
def adapter(monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "gemini")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "fake-test-key")
    monkeypatch.setattr(settings, "GEMINI_MODEL", "test-gemini-model")
    return LLMAdapter()


async def test_tool_signature_survives_stream_and_continuation(adapter):
    signature = {"google": {"thought_signature": "opaque-signature"}}
    call = SimpleNamespace(
        index=0,
        id="call_1",
        function=SimpleNamespace(name="save_user_memory", arguments='{"content":"Likes tea"}'),
        extra_content=signature,
    )
    first = FakeStream([chunk(calls=[call]), chunk(finish="stop")])
    second = FakeStream([chunk(text="Remembered."), chunk(finish="stop")])
    create = AsyncMock(side_effect=[first, second])
    adapter.client.chat.completions.create = create
    executor = AsyncMock(side_effect=lambda call: LLMToolResult(call, {"saved": True}))
    stream = await adapter.chat(
        [{"role": "user", "content": "I like tea"}],
        stream=True,
        tools=[LLMTool("save_user_memory", "Save memory", {"type": "object"})],
        tool_executor=executor,
    )
    parts = [part async for part in stream]
    assert parts[-1] == "Remembered."
    executor.assert_awaited_once()
    continuation = create.call_args_list[1].kwargs["messages"]
    assert continuation[-2]["tool_calls"][0]["extra_content"] == signature
    assert continuation[-1]["tool_call_id"] == "call_1"
    first.close.assert_awaited_once()
    second.close.assert_awaited_once()


@pytest.mark.parametrize("finish", [None, "length", "content_filter"])
async def test_rejects_incomplete_stream_and_closes_response(finish):
    response = FakeStream([chunk(text="Partial", finish=finish)])
    with pytest.raises(LLMResponseError):
        _ = [part async for part in GeminiCompletionStream(response)]
    response.close.assert_awaited_once()


async def test_missing_key_never_calls_provider(adapter, monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")
    create = AsyncMock()
    adapter.client.chat.completions.create = create
    with pytest.raises(LLMUnavailableError):
        await adapter._do_chat([{"role": "user", "content": "Hello"}])
    create.assert_not_awaited()


async def test_rejects_truncated_json_before_schema_validation(adapter):
    adapter.client.chat.completions.create = AsyncMock(
        return_value=SimpleNamespace(
            choices=[
                SimpleNamespace(finish_reason="length", message=SimpleNamespace(content='{"ok":1}'))
            ]
        )
    )
    with pytest.raises(LLMResponseError):
        await adapter._do_chat([{"role": "user", "content": "Generate JSON"}])
