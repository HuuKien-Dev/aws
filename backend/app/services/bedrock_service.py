"""Bedrock transport using SDK bearer-token inference or the standard IAM chain."""

from __future__ import annotations

import asyncio
import json
import os
from types import SimpleNamespace

from app.core.config import settings


def aws_client(service: str, timeout: float):
    import boto3
    from botocore.config import Config

    return boto3.client(
        service,
        region_name=settings.AWS_REGION or None,
        config=Config(
            # The SDK treats even an empty bearer environment variable as a token.
            # Use IAM when it is empty, and always for Knowledge Base Retrieve.
            signature_version=(
                None
                if service == "bedrock-runtime" and os.environ.get("AWS_BEARER_TOKEN_BEDROCK")
                else "v4"
            ),
            connect_timeout=min(10, timeout),
            read_timeout=timeout,
            retries={"mode": "standard", "total_max_attempts": 1},
        ),
    )


def translate_messages(messages: list[dict]) -> tuple[list[dict], list[dict]]:
    system = []
    turns = []
    for message in messages:
        role = message["role"]
        if role == "system":
            system.append({"text": message["content"]})
            continue
        content = []
        if role == "tool":
            content.append(
                {
                    "toolResult": {
                        "toolUseId": message["tool_call_id"],
                        "content": [{"text": message["content"]}],
                    }
                }
            )
            role = "user"
        else:
            if message.get("content"):
                if not isinstance(message["content"], str):
                    raise ValueError("Bedrock currently accepts text chat content only")
                content.append({"text": message["content"]})
            for call in message.get("tool_calls", []):
                content.append(
                    {
                        "toolUse": {
                            "toolUseId": call["id"],
                            "name": call["function"]["name"],
                            "input": json.loads(call["function"]["arguments"]),
                        }
                    }
                )
        if content:
            if turns and turns[-1]["role"] == role:
                turns[-1]["content"].extend(content)
            else:
                turns.append({"role": role, "content": content})
    if not turns:
        turns = [{"role": "user", "content": [{"text": "Generate the requested content."}]}]
    return system, turns


def _chunk(text: str | None = None, calls: list | None = None, usage=None):
    return SimpleNamespace(
        choices=[SimpleNamespace(delta=SimpleNamespace(content=text, tool_calls=calls))],
        usage=usage,
    )


class BedrockTransport:
    async def chat(self, messages, stream, tools, timeout):
        from app.services.llm_adapter import LLMError, LLMResponseError

        if not settings.AWS_REGION or not settings.BEDROCK_MODEL_ID:
            raise LLMError("Chưa cấu hình AWS_REGION và BEDROCK_MODEL_ID cho gia sư AI.")
        system, turns = translate_messages(messages)
        request = {
            "modelId": settings.BEDROCK_MODEL_ID,
            "messages": turns,
            "inferenceConfig": {"maxTokens": settings.BEDROCK_MAX_TOKENS},
        }
        if system:
            request["system"] = system
        if tools:
            request["toolConfig"] = {
                "tools": [
                    {
                        "toolSpec": {
                            "name": tool.name,
                            "description": tool.description,
                            "inputSchema": {"json": tool.input_schema},
                        }
                    }
                    for tool in tools
                ]
            }
        client = None
        try:
            client = await asyncio.to_thread(
                aws_client, "bedrock-runtime", min(timeout, settings.BEDROCK_TIMEOUT_SECONDS)
            )
            response = await asyncio.to_thread(
                client.converse_stream if stream else client.converse, **request
            )
        except Exception as exc:
            if client is not None:
                client.close()
            raise bedrock_error(exc) from None
        if stream:
            return self._events(response["stream"], client)
        try:
            if response.get("stopReason") != "end_turn":
                raise LLMResponseError("Bedrock did not complete the response")
            text = "".join(
                block.get("text", "") for block in response["output"]["message"]["content"]
            )
            if not text:
                raise LLMError("Bedrock returned an empty response")
            return text
        finally:
            client.close()

    async def _events(self, events, client):
        from app.services.llm_adapter import LLMResponseError

        iterator = iter(events)
        sentinel = object()
        completed = False
        has_content = False
        try:
            while True:
                event = await asyncio.to_thread(next, iterator, sentinel)
                if event is sentinel:
                    break
                if any(key.endswith("Exception") for key in event):
                    raise LLMResponseError("Bedrock stream failed; please retry")
                if "contentBlockStart" in event:
                    block = event["contentBlockStart"]
                    tool = block["start"].get("toolUse")
                    if tool:
                        has_content = True
                        yield _chunk(
                            calls=[
                                SimpleNamespace(
                                    index=block["contentBlockIndex"],
                                    id=tool["toolUseId"],
                                    function=SimpleNamespace(name=tool["name"], arguments=""),
                                )
                            ]
                        )
                if "contentBlockDelta" in event:
                    block = event["contentBlockDelta"]
                    delta = block["delta"]
                    if "text" in delta:
                        has_content = has_content or bool(delta["text"])
                        yield _chunk(text=delta["text"])
                    if "toolUse" in delta:
                        yield _chunk(
                            calls=[
                                SimpleNamespace(
                                    index=block["contentBlockIndex"],
                                    id=None,
                                    function=SimpleNamespace(
                                        name=None, arguments=delta["toolUse"]["input"]
                                    ),
                                )
                            ]
                        )
                if "metadata" in event:
                    usage = event["metadata"].get("usage", {})
                    yield _chunk(
                        usage=SimpleNamespace(
                            prompt_tokens=usage.get("inputTokens"),
                            completion_tokens=usage.get("outputTokens"),
                            total_tokens=usage.get("totalTokens"),
                        )
                    )
                if "messageStop" in event:
                    reason = event["messageStop"]["stopReason"]
                    if reason not in ("end_turn", "tool_use"):
                        raise LLMResponseError("Bedrock stopped before completing the response")
                    completed = True
            if not completed:
                raise LLMResponseError("Bedrock stream ended before completion")
            if not has_content:
                raise LLMResponseError("Bedrock returned an empty stream")
        except LLMResponseError:
            raise
        except Exception as exc:
            raise bedrock_error(exc) from None
        finally:
            events.close()
            client.close()


def bedrock_error(exc: Exception):
    from botocore.exceptions import ConnectTimeoutError, EndpointConnectionError, ReadTimeoutError

    from app.services.llm_adapter import LLMError, LLMTimeoutError, LLMUnavailableError

    if isinstance(exc, (ConnectTimeoutError, ReadTimeoutError)):
        return LLMTimeoutError("AWS phản hồi quá chậm. Vui lòng thử lại.")
    if isinstance(exc, EndpointConnectionError):
        return LLMUnavailableError("Không thể kết nối AWS. Vui lòng thử lại sau.")
    code = getattr(exc, "response", {}).get("Error", {}).get("Code", "")
    if code in ("ThrottlingException", "ServiceUnavailableException", "ModelNotReadyException"):
        return LLMUnavailableError("AWS đang bận. Vui lòng thử lại sau.")
    # Never put provider exception payloads, prompts, or credentials in user errors/logs.
    return LLMError(
        "Không thể gọi AWS. Kiểm tra region, model, API key còn hạn hoặc IAM và khả năng streaming/tool calling."
    )
