"""Actual pinned SDK signing contracts with synthetic credentials and intercepted HTTP."""

import json
from unittest.mock import Mock

import boto3
import pytest
from botocore.awsrequest import AWSResponse

from app.core.config import settings
from app.services.bedrock_service import aws_client


@pytest.fixture(autouse=True)
def isolated_aws(monkeypatch, tmp_path):
    # Prevent reading any real shared profile or fetching container/instance credentials.
    empty = tmp_path / "empty-aws-config"
    empty.write_text("")
    monkeypatch.setenv("AWS_SHARED_CREDENTIALS_FILE", str(empty))
    monkeypatch.setenv("AWS_CONFIG_FILE", str(empty))
    monkeypatch.setenv("AWS_EC2_METADATA_DISABLED", "true")
    for name in (
        "AWS_PROFILE",
        "AWS_DEFAULT_PROFILE",
        "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
        "AWS_CONTAINER_CREDENTIALS_FULL_URI",
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_SESSION_TOKEN",
        "AWS_BEARER_TOKEN_BEDROCK",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(boto3, "DEFAULT_SESSION", None)
    monkeypatch.setattr(settings, "AWS_REGION", "us-east-1")


def intercept(client, payload):
    requests = []

    def before_send(request, **kwargs):
        requests.append(request)
        raw = Mock()
        raw.stream.return_value = iter([json.dumps(payload).encode()])
        return AWSResponse(request.url, 200, {"content-type": "application/json"}, raw)

    client.meta.events.register("before-send", before_send)
    return requests


def test_api_key_signs_inference_without_iam_credentials(monkeypatch):
    monkeypatch.setenv("AWS_BEARER_TOKEN_BEDROCK", "offline-synthetic-bedrock-token")
    client = aws_client("bedrock-runtime", 10)
    try:
        requests = intercept(
            client,
            {
                "output": {"message": {"role": "assistant", "content": [{"text": "Hello"}]}},
                "stopReason": "end_turn",
            },
        )
        response = client.converse(
            modelId="example-model", messages=[{"role": "user", "content": [{"text": "Hello"}]}]
        )
        assert response["stopReason"] == "end_turn"
        assert len(requests) == 1
        assert requests[0].headers["Authorization"] == b"Bearer offline-synthetic-bedrock-token"
        assert client.meta.config.retries["total_max_attempts"] == 1
    finally:
        client.close()


@pytest.mark.parametrize("token", ["", "offline-synthetic-bedrock-token"])
def test_knowledge_base_retrieval_keeps_iam_signing_even_with_api_key(monkeypatch, token):
    monkeypatch.setenv("AWS_BEARER_TOKEN_BEDROCK", token)
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "offline-access-id")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "offline-secret")
    client = aws_client("bedrock-agent-runtime", 10)
    try:
        requests = intercept(client, {"retrievalResults": []})
        assert (
            client.retrieve(knowledgeBaseId="EXAMPLE1234", retrievalQuery={"text": "grammar"})[
                "retrievalResults"
            ]
            == []
        )
        authorization = requests[0].headers["Authorization"]
        assert authorization.startswith(b"AWS4-HMAC-SHA256 ")
        assert b"Bearer" not in authorization
    finally:
        client.close()


@pytest.mark.parametrize("token", [None, ""])
def test_empty_key_keeps_standard_iam_inference(monkeypatch, token):
    if token is not None:
        monkeypatch.setenv("AWS_BEARER_TOKEN_BEDROCK", token)
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "offline-access-id")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "offline-secret")
    client = aws_client("bedrock-runtime", 10)
    try:
        requests = intercept(client, {"stopReason": "end_turn"})
        client.converse(
            modelId="example-model", messages=[{"role": "user", "content": [{"text": "Hello"}]}]
        )
        assert requests[0].headers["Authorization"].startswith(b"AWS4-HMAC-SHA256 ")
    finally:
        client.close()
