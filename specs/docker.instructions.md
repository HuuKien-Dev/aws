---
description: "Current production and development Compose topology, images, persistence, environment propagation, and container startup behavior."
applyTo: "docker-compose*.yml, .env.example, .env.dev, backend/Dockerfile, frontend/Dockerfile*, .github/workflows/docker-publish*.yml"
---

# Docker Runtime

## Production topology

`docker-compose.yml` defines:

- `postgres`: PostgreSQL 16 with authenticated health check.
- `redis`: Redis 7 with password and authenticated health check.
- `backend`: published FreeLingo image; waits for PostgreSQL and Redis, applies existing Alembic
  revisions, then starts Uvicorn.
- `frontend`: published FreeLingo image; exposes port 3000 and talks to backend through private
  `BACKEND_URL`.
- `kokoro`: local TTS GPU image, required only when `TTS_PROVIDER=local`.
- `whisper`: local STT GPU image, required only when `STT_PROVIDER=local`.

Ollama is not a Compose service. It is an optional provider configured through
`host.docker.internal:11434`. The backend service declares the Linux host-gateway mapping.
The custom `.env.example` selects Bedrock with an explicit region/model and disabled speech.
The production Compose file still uses upstream images; use development Compose to run this checkout.

## Development topology

`docker-compose.dev.yml` defines PostgreSQL, Redis, a locally built backend with source mount and
Uvicorn reload, and a locally built frontend with source/message mounts and `npm run dev`.

The frontend is exposed at `http://localhost:3000`. The backend publishes port 8000 only on
`127.0.0.1`. Server-side frontend requests use `BACKEND_URL=http://backend:8000`; browser voice
connections use `NEXT_PUBLIC_API_URL=http://localhost:8000`, producing
`ws://localhost:8000/ws/conversation`. Next.js HTTP rewrites do not forward this WebSocket route.
`.env.dev` supplies localhost application and billing return URLs for this topology.

Development extends the Kokoro and Whisper definitions from production Compose under the optional
`speech-local` profile. Neither service starts in the CPU-only path. `TTS_PROVIDER=disabled` and
`STT_PROVIDER=disabled` select no adapter. An existing `.env` can override defaults: explicitly export
these values when starting a CPU-only installation. Data paths and service/container names remain
the same, allowing the existing PostgreSQL/Redis mounts to be reused without deleting data.

`frontend/Dockerfile.dev` is used only by development Compose. Publishing workflows use the production
backend and frontend Dockerfiles.

## Images and publication

Backend images use Python 3.14.9 and pip 26.2.2 with `requirements.txt` plus `constraints.txt`.
Frontend production/development images use Node 26.13.0 LTS, explicitly install npm 11.20.0, and use the
committed lockfile through `npm ci`. These exact runtime and package-manager versions match the local
toolchain and PR CI. Production uses Next.js standalone output.

Frontend containers place application source in `/app/frontend` and catalogs in `/app/messages`.
The shared `/app` root matches the monorepo layout used by Turbopack and output-file tracing.
Production copies standalone output to `/app` and runs `server.js` from `/app/frontend`, preserving
the generated relative path. Development mounts source/catalogs at those same paths with a separate
node_modules volume. Root `.dockerignore` limits the frontend build context to source, catalogs and
the license, excluding local dependencies, build output and secret configuration. Backend context
has its own `.dockerignore`; persistent user files and local environment files are not copied.
Next.js checks types with `frontend/tsconfig.build.json`, which excludes `tests/`; test imports resolve
against the monorepo layout and are checked by the full `tsconfig.json` in PR CI.

Push workflows for `main` and `develop` build and publish separate Linux `amd64` and `arm64` image
names with `latest` and short-SHA tags. They publish images only; they do not deploy to a VPS.

Publication uses GitHub-hosted `ubuntu-24.04` runners for `amd64`, preparation, and manifest merging,
and `ubuntu-24.04-arm` for `arm64`. The changelog release workflow also uses `ubuntu-24.04`.
These labels select the Ubuntu 24.04 LTS series; GitHub continues updating the runner images and
their preinstalled tools. Container base images remain defined by the Dockerfiles.

## Persistence

The Compose files use bind mounts below `DATA_PATH`; they do not declare named volumes.

- PostgreSQL: `${DATA_PATH}/postgres`.
- Redis: `${DATA_PATH}/redis`.
- Avatars: `${DATA_PATH}/avatars`.
- Generated audio: `${DATA_PATH}/audio`.
- TTS previews: `${DATA_PATH}/tts_previews`.

Avatar and media access remains controlled by backend endpoints; a host mount does not make files
public.

## Environment propagation

`.env.example` is the operator-facing deployment template. Compose explicitly forwards environment
values; a field present in backend `Settings` but absent from Compose is not configurable merely by
placing it in `.env`.

Both Compose files forward optional `OPENAI_REASONING_EFFORT` with an empty default. It controls
`reasoning.effort` on OpenAI Responses requests only; nonempty values must be supported by the selected
model. An empty value leaves reasoning to the provider. `LLM_PROVIDER=openai` requires a model and
endpoint supporting Responses, not only Chat Completions.

Both Compose files forward `EXERCISE_GENERATION_TIMEOUT_SECONDS` with a default of 600. This positive
integer limits the complete Listening/Reading background job, including LLM output, JSON correction,
audio synthesis where applicable, and persistence. `.env.example` documents it for operators using
slow local models. The frontend receives the generation deadline through the API rather than a
separate environment variable.

Error Detective, Sentence Order, and Vocabulary Pairs share `EXERCISE_GENERATION_TIMEOUT_SECONDS`
for generation and semantic review.
Both Compose files forward `FREEMIUM_GAMES_DAILY` (default 3), also documented in `.env.example`.
Zero prevents new free games; subscriptions, active trials and Stripe-disabled deployments bypass it.
Game sessions, creation-request identities, and global admission reservations are persisted in
PostgreSQL. Games needs no extra service or volume.

Operators must review database/data path, Redis password, JWT secret, CORS/cookie security,
registration, email, available languages, LLM/speech providers, quotas, Stripe/freemium, and logging.

`BACKEND_URL` is the frontend's private backend-connectivity variable.

The production and development Compose files currently inject an `AVAILABLE_TARGET_LANGUAGES`
fallback containing only `en-US` and `en-GB` when the variable is absent, while `Settings` and
`.env.example` default to the complete supported set. Operators should provide the explicit value from
`.env.example`; the injected Compose value takes precedence.

`ACCESS_TOKEN_EXPIRE_MINUTES`, `REFRESH_TOKEN_EXPIRE_DAYS`, `RATE_LIMIT_ENABLED`, and
`AUDIO_STORAGE_PATH` exist in backend Settings but are not forwarded by the current Compose contract.
Their in-code defaults therefore apply in containers.

## Startup and migrations

Schema changes include their Alembic revision files in `backend/alembic/versions/`, linked to the
previous revision through `down_revision` and committed with the corresponding model changes.
The backend image includes these files. On deployment, the backend startup command automatically
applies pending revisions with `alembic upgrade head` before starting Uvicorn. Startup does not
generate revisions; preparing the versioned files is part of development, not a manual deployment step.

Offline SQL checks do not replace verification of an actual PostgreSQL upgrade; tests using
`metadata.create_all` bypass Alembic.

PR checks targeting `develop` apply the migration chain to an empty ephemeral PostgreSQL 16 database
before running backend tests. CI overrides Alembic's Docker-specific script location for that step;
the deployment configuration remains `/app/alembic`. The CI check covers fresh installation, not
data-dependent upgrades of existing deployments. See `testing.instructions.md`.

## GPU and provider selection

Both Compose topologies reserve NVIDIA GPUs only for explicitly selected `speech-local` services.
CPU-only web operation leaves that profile disabled and disables speech, or uses configured cloud
speech. Selecting local speech on a CPU-only host requires an appropriate upstream CPU image and
removing GPU reservations; exact upstream CPU tags are not a stable FreeLingo contract.

Both files forward `AWS_REGION`, `BEDROCK_MODEL_ID`, `BEDROCK_MAX_TOKENS`,
`BEDROCK_TIMEOUT_SECONDS`, `BEDROCK_KNOWLEDGE_BASE_ID`, `BEDROCK_RAG_RESULTS`,
`BEDROCK_RAG_MIN_SCORE` and `CUSTOM_SOURCE_URL` to the backend only. No AWS secrets are built into
frontend images. `docker-compose.aws-local.yml` explicitly mounts a securely provisioned shared
AWS configuration directory read-only and selects `AWS_PROFILE`. EC2 deployments should use their
instance IAM role without that override. AWS resources are configured separately, never provisioned
by Compose. Maintainer build/start/log commands are in `DEVELOPMENT.md`.

When TTS or STT uses OpenAI, the corresponding local speech service is unnecessary. LLM, TTS, STT,
recognition-language, and provider HTTP contracts belong to `services.instructions.md` and
`speech-services.instructions.md`.

## Host requirements

- Set `vm.overcommit_memory=1` for reliable Redis background persistence.
- Production voice conversation requires HTTPS and a reverse proxy that forwards `/ws/*` to backend.
- Keep provider API keys and `CHANGE_ME_*` secrets out of version control.
- Keep backend/frontend runtime and package-manager versions aligned with their PR/publish workflows
  when intentionally upgrading them.

## Related specifications

- `.env.example`: deployable value reference.
- `architecture.instructions.md`: runtime boundaries.
- `speech-services.instructions.md`: provider contracts.
- `subscriptions-freemium.instructions.md`: billing/access configuration.
- `testing.instructions.md`: CI and local validation workflows.

## Bedrock API-key authentication

Model inference also accepts `AWS_BEARER_TOKEN_BEDROCK` through the AWS SDK's native environment
support. Compose forwards the optional token only to the backend; it is not a frontend setting,
public-config field or model ID. The SDK selects bearer-token inference for a nonempty value;
an empty value retains the standard IAM Role/SSO/profile chain. No additional SDK dependency,
manual Authorization header or global environment mutation is required. The key must be valid,
unexpired, authorized for the model and scoped to the configured region. Tokens are replaced
outside the application and are never logged or returned. Provider authentication failures stay
sanitized and do not silently switch authentication modes.

Bedrock API keys do not authorize Knowledge Base `Retrieve`. Its `bedrock-agent-runtime` client
explicitly uses SigV4 and still needs IAM credentials with `bedrock:Retrieve`. Inference can use a
key alongside separate IAM credentials for retrieval. An inference-only configuration leaves the
KB ID empty. TTS and STT remain independently configured.
