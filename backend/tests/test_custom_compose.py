"""Static Compose checks; no Docker daemon, interpolation or real secrets are used."""

from pathlib import Path

import yaml


def test_source_builds_keep_data_mounts_and_make_gpu_services_optional():
    root = Path(__file__).resolve().parents[2]
    production = yaml.safe_load((root / "docker-compose.yml").read_text())["services"]
    development = yaml.safe_load((root / "docker-compose.dev.yml").read_text())["services"]
    assert development["backend"]["build"] == "./backend"
    assert development["frontend"]["build"] == {
        "context": ".",
        "dockerfile": "frontend/Dockerfile.dev",
    }
    assert "image" not in development["backend"]
    assert "image" not in development["frontend"]
    for service in ("postgres", "redis"):
        assert development[service]["volumes"] == production[service]["volumes"]
    assert "./backend:/app" in development["backend"]["volumes"]
    assert "./frontend:/app/frontend" in development["frontend"]["volumes"]
    assert "./messages:/app/messages:ro" in development["frontend"]["volumes"]
    assert "/app/frontend/node_modules" in development["frontend"]["volumes"]
    dockerfile = (root / "frontend/Dockerfile").read_text()
    assert "WORKDIR /app/frontend" in dockerfile
    assert "/app/frontend/.next/standalone /app/" in dockerfile
    assert "COPY messages/ /app/messages/" in dockerfile
    for service in ("kokoro", "whisper"):
        assert production[service]["profiles"] == ["speech-local"]
        assert development[service]["extends"] == {
            "file": "docker-compose.yml",
            "service": service,
        }
    for service in ("backend", "frontend", "postgres", "redis"):
        assert "deploy" not in development[service]
    assert development["backend"]["environment"]["TTS_PROVIDER"] == "${TTS_PROVIDER:-disabled}"
    assert development["backend"]["environment"]["STT_PROVIDER"] == "${STT_PROVIDER:-disabled}"


def test_aws_configuration_stays_backend_only_and_local_mount_is_read_only():
    root = Path(__file__).resolve().parents[2]
    for filename in ("docker-compose.yml", "docker-compose.dev.yml"):
        services = yaml.safe_load((root / filename).read_text())["services"]
        assert (
            services["backend"]["environment"]["AWS_BEARER_TOKEN_BEDROCK"]
            == "${AWS_BEARER_TOKEN_BEDROCK:-}"
        )
        assert "BEDROCK_MODEL_ID" in services["backend"]["environment"]
        assert "BEDROCK_KNOWLEDGE_BASE_ID" in services["backend"]["environment"]
        assert not any(
            "AWS" in key or "BEDROCK" in key for key in services["frontend"]["environment"]
        )
    override = yaml.safe_load((root / "docker-compose.aws-local.yml").read_text())
    assert list(override["services"]) == ["backend"]
    assert all(volume.endswith(":ro") for volume in override["services"]["backend"]["volumes"])
