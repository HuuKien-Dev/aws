# Development

## Ubuntu VMware without an NVIDIA GPU

Use Docker Engine with the Compose plugin on the Ubuntu guest. Accessing the Docker daemon from
a sandboxed coding workspace may require additional permission; build/start operations need an
explicit maintainer request. The local validation toolchain below is separate from container builds.
No local Ollama, embeddings or vector database
is needed with Bedrock. PostgreSQL 16 and Redis 7 remain required.

From the repository root, preserve an existing `.env`. Only on a new installation:

```bash
test -f .env || cp .env.example .env
```

Configure database/Redis passwords and `SECRET_KEY` securely before starting. Keep the existing
`DATA_PATH` to reuse PostgreSQL, Redis, avatars and audio. Do not change the Compose project name
of an existing installation or delete its volumes. Startup applies the repository's committed
Alembic revisions as before; this customization adds no schema revision.

Build and start the modified source, overriding any old local-speech selection without editing `.env`:

```bash
export LLM_PROVIDER=bedrock TTS_PROVIDER=disabled STT_PROVIDER=disabled
docker compose -f docker-compose.dev.yml build backend frontend
docker compose -f docker-compose.dev.yml up -d
docker compose -f docker-compose.dev.yml ps
docker compose -f docker-compose.dev.yml logs -f --tail=100 backend frontend
```

Open `http://localhost:3000` in the Ubuntu browser. Backend HTTP is bound to `127.0.0.1:8000`;
the frontend source and catalogs are mounted and Next.js/Uvicorn reload edits. Dependency or
Dockerfile changes require rebuilding. To access from the VMware host, forward guest port 3000
or use the guest address on a reachable VM network. Voice from another machine additionally needs
an HTTPS microphone context and an explicitly configured reachable WebSocket URL; localhost
defaults target the Ubuntu browser.

Frontend containers use `/app/frontend` for code and `/app/messages` for translation catalogs,
matching the monorepo's sibling directories. Turbopack and file tracing share that root; production
standalone output runs from its generated `frontend/server.js` path. Docker ignore files keep local
toolchains, previous builds, environment files and persistent user files out of image build contexts.

To validate Compose without printing interpolated passwords, use:

```bash
docker compose -f docker-compose.dev.yml config --quiet
```

### Private localhost overrides and bundled fonts

Keep an existing `.env` unchanged when preparing a separate local review. A Git-ignored
`.local/localhost.env` can override the JWT secret with a newly generated, private random value
of at least 32 characters, plus local URLs, `COOKIE_SECURE=false`, disabled speech, email,
analytics and Stripe. Store this file with mode `0600`, keep it stable across restarts, and never
commit or print its secret. The application's insecure-key startup guard remains enabled.

When Google font downloads are unavailable inside the development container, use an already
successful local frontend build instead of removing fonts or changing learned-language typography.
Build with `./scripts/local.sh frontend npm run build`, then configure
`.local/compose.localhost.yml` as:

```yaml
services:
  frontend:
    command: npm run start
```

The mounted frontend directory supplies the built `.next` assets, including the bundled fonts;
the container supplies its installed Node dependencies. This review mode serves the built interface,
so rebuild after frontend edits. The default development Compose command remains `npm run dev`
with source reload. With the private overrides already configured, rebuild/start and inspect logs:

```bash
COMPOSE_PROFILES= docker compose --env-file .env --env-file .local/localhost.env \
  -f docker-compose.dev.yml -f .local/compose.localhost.yml up -d --build
docker compose --env-file .env --env-file .local/localhost.env \
  -f docker-compose.dev.yml -f .local/compose.localhost.yml logs -f --tail=100 backend frontend
```

These overrides do not change `DATA_PATH`, PostgreSQL credentials, database contents or Redis
storage. They do not bypass the authentication implementation or configure AWS access.

Stop only application containers when needed; do not use volume-removal commands. If this checkout
already runs under the same Compose project, `up -d` reconciles the services in place. Do not run
the upstream and development Compose files as separate projects with the same fixed container names.

### Bedrock API key for local inference

For model inference, the backend also supports the official `AWS_BEARER_TOKEN_BEDROCK`
environment variable. The pinned boto3 version supports bearer-token authentication natively;
no custom Authorization header, URL setting or extra SDK is needed. A nonempty token selects
API-key authentication for inference. Leave it empty to use IAM Role/SSO/shared credentials.

On the existing localhost setup, edit `/home/huukien/FreeLingo/.local/localhost.env` privately
in your editor and add or update these lines, keeping every other setting:

```dotenv
LLM_PROVIDER=bedrock
AWS_REGION=your-key-region
BEDROCK_MODEL_ID=your-exact-model-or-inference-profile-id
AWS_BEARER_TOKEN_BEDROCK=your-private-bedrock-api-key
# Leave empty for an inference-only test without AWS IAM credentials.
BEDROCK_KNOWLEDGE_BASE_ID=
```

The token must be valid for the chosen region and have access to the selected model. Use a
Bedrock API key, not an AWS access-key ID or a key from another AI provider. The application
never generates or renews a token. When it expires, replace it privately and recreate the backend.
Do not paste the key into chat, logs, command-line arguments or a frontend variable. Keep this
ignored local file private (`chmod 600 .local/localhost.env`). This sample is placeholder-only.

From the repository root, apply the updated Compose configuration to the existing source-based
localhost backend (the frontend and existing data services stay in place):

```bash
COMPOSE_PROFILES= docker compose --env-file .env --env-file .local/localhost.env -f docker-compose.dev.yml -f .local/compose.localhost.yml up -d --no-build --no-deps backend
```

The command assumes the existing localhost images/build override have already been prepared.
A fresh checkout must follow the local source-build instructions first. Reload
`http://localhost:3000` to test. Inference can incur AWS charges; no resources or API calls are
created automatically by setting these variables. For direct Python execution, export the
variable in the backend process environment; boto3 does not read the application's dotenv file.

API keys do **not** authenticate the Agents Runtime `Retrieve` operation used by Knowledge Bases.
For RAG, keep an authorized IAM/SSO/profile credential source in addition to the inference key,
and retain the read-only AWS profile override when using a local profile. Retrieval explicitly
uses SigV4. Without IAM access, leave the KB ID empty: chat then identifies its answer as general
model knowledge. Bedrock chat keys do not enable TTS or STT.

Official references: [Bedrock API keys](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html)
and [API key limitations](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys-reference.html).

### Existing AWS resources and credentials

The application never creates a Knowledge Base, S3 bucket, vector store, embedding model deployment,
IAM role or cloud deployment. The account administrator sets them up separately when authorized.

- Select an AWS region and an accessible model or inference profile supporting Converse, streaming
  and streaming tool use. Supply the exact ID/ARN as `BEDROCK_MODEL_ID`; no default is guessed.
  Configure an output budget accepted by that model with `BEDROCK_MAX_TOKENS`.
- Set `AWS_REGION`. Runtime uses boto3's standard credential chain. On EC2 use an instance IAM role;
  ensure the instance/container metadata network and hop-limit configuration permits that role.
- Grant least-privilege `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream` on the chosen
  model and, when applicable, inference profile and its destination model resources. The selected
  model must be enabled/available in that account. Unsupported tool use is an error, not a fallback.
- For RAG, configure an existing Knowledge Base with an S3 data source, an AWS-supported vector store,
  embedding configuration and a completed ingestion/sync. Set `BEDROCK_KNOWLEDGE_BASE_ID`. Grant
  application credentials `bedrock:Retrieve` on that KB. Its service role separately needs the S3,
  embedding, vector-store and any KMS permissions required by its AWS configuration.
- Use only curriculum material shared with every user of this installation. This integration does
  not implement private document uploads or per-user document access controls. Do not mix private
  documents into the shared KB. Configure `BEDROCK_RAG_RESULTS` and calibrate
  `BEDROCK_RAG_MIN_SCORE` against your own retrieval results.
- `BEDROCK_TIMEOUT_SECONDS` bounds SDK read waits, with a maximum of three adapter attempts on
  request creation. Retrieval uses at most three transient-error attempts and a 30-second read
  timeout per attempt. Streams that fail after emitting content are not replayed.

On local Ubuntu, securely provision a shared AWS credentials/config directory or an already logged-in
AWS IAM Identity Center profile on the host. Never send keys through chat or add them to Git.
To explicitly mount that directory read-only into the backend:

```bash
export AWS_CONFIG_DIRECTORY="$HOME/.aws"
export AWS_PROFILE=your-profile
export AWS_REGION=your-region
export BEDROCK_MODEL_ID=your-model-or-inference-profile
export BEDROCK_KNOWLEDGE_BASE_ID=your-existing-knowledge-base-id
docker compose -f docker-compose.dev.yml -f docker-compose.aws-local.yml up -d --build
```

Renew expired SSO sessions on the host; the container mount is read-only. Do not use that override
on EC2 when relying on the instance role. Both shared profiles and region/model variables are backend
configuration only. Leave the KB ID empty to use Bedrock without RAG. With no credentials or model
configured, the web can open but AI features cannot work; offline tests do not establish AWS access.

Retrieval uses AWS `Retrieve`, then the existing model adapter. This preserves application-managed
chat history, memory tools, streaming, CEFR prompts and Pydantic JSON validation. It does not use
`RetrieveAndGenerate` sessions. Sources shown in chat and lesson explanations are retrieved locations,
not fabricated page numbers or guaranteed claim-level citations. A no-match answer is explicitly
identified as general model knowledge. AWS errors do not silently become no-match results.

Official API references: [ConverseStream](https://docs.aws.amazon.com/boto3/latest/reference/services/bedrock-runtime/client/converse_stream.html),
[Retrieve](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_agent-runtime_Retrieve.html),
[model tool support](https://docs.aws.amazon.com/bedrock/latest/userguide/tool-use-client-side.html),
and [SDK credentials](https://docs.aws.amazon.com/boto3/latest/guide/credentials.html).

### Optional speech

Keep `TTS_PROVIDER=disabled` and `STT_PROVIDER=disabled` for a CPU-only web application. Bedrock
inference does not provide speech recognition or synthesis. For cloud speech configure the existing
OpenAI providers and their securely supplied API key. For local NVIDIA speech, explicitly enable:

```bash
TTS_PROVIDER=local STT_PROVIDER=local docker compose -f docker-compose.dev.yml --profile speech-local up -d
```

That profile reserves NVIDIA GPUs and is not the VMware CPU-only path. Existing speech, language
ownership and authentication remain intact. Optional local services have not been deleted.

### Customization and cleanup

The edition keeps FreeLingo attribution, AGPL-3.0, copyright and legal notices. Configure
`CUSTOM_SOURCE_URL` with the corresponding modified source before a network deployment; an upstream
source link is not a substitute. No remote publication is performed by the development workflow.

The unused `frontend/public/github.svg` and `frontend/public/github_white.svg` were removed after
checking code, scripts, Docker, CI and documentation references. The landing already uses its own
GitHub link, and no dynamic asset loader uses these files. Restore either with
`git restore --source=HEAD -- frontend/public/github.svg frontend/public/github_white.svg` while the
deletions are uncommitted, or select the commit before the cleanup after committing. Language lists
in registration/settings now reuse the locale catalog; unused context constants and the obsolete
browser locale-detection script were removed. Speech assets, migrations, tests, lockfiles, provider
configuration, docs and legal material are retained because they still serve supported flows.

## Local validation environment

Local work uses backend tests/static checks and frontend lint, typecheck and unit tests. Backend
tests use in-memory SQLite and mocked services. Docker and a running application are not required;
deployment checks belong to the maintainer. Container configuration is documented in
`specs/docker.instructions.md`.

The supported hosts are macOS and glibc-based Linux on arm64 or x86_64. Bootstrap needs the OS utilities
Bash, curl, tar and a SHA-256 utility (`shasum` or `sha256sum`), plus network access. Python, Node,
npm, pip and project libraries are installed inside this checkout. No Homebrew installation or global
package-manager setup is needed.

## Setup

From the repository root:

```bash
./scripts/bootstrap.sh
```

`scripts/toolchain.env` pins Python 3.14.9, Node 26.13.0 LTS, bundled npm 11.20.0 and pip 26.2.2. Bootstrap
downloads standalone CPython from `astral-sh/python-build-standalone` and Node from `nodejs.org`,
verifying their archives against committed SHA-256 checksums before extraction.

Generated directories are ignored by Git:

- `.local/python/` and `.local/node/`: versioned, self-contained language runtimes.
- `.local/cache/`, `.local/tmp/`, `.local/home/`, `.local/config/`, `.local/share/`, and `.local/state/`:
  downloads, package/tool caches, temporary files and process-local user directories.
- `.venv/`: Python environment based on the repository's standalone interpreter.
- `frontend/node_modules/`: frontend dependencies installed with `npm ci`.

Python installation uses `backend/requirements-dev.txt`, which includes runtime requirements and
the pinned Ruff/Black tools. `constraints.txt` and `constraints-dev.txt` pin indirect dependencies.
Bootstrap rejects an unpinned resolved dependency and requires binary wheels, avoiding implicit
compiler installations and unpinned build dependencies. The frontend uses the committed npm lockfile.

## Running commands

Use the command runner from the repository root:

```bash
# Targeted backend tests; disable the aggregate coverage threshold for focused runs
./scripts/local.sh backend python -m pytest tests/test_auth.py -v --no-cov

# Frontend tests and static checks
./scripts/local.sh frontend npm run test:run
./scripts/local.sh frontend npm run lint
./scripts/local.sh frontend ./node_modules/.bin/tsc --noEmit

# Canonical formatting and full pre-push validation, when explicitly requested
./scripts/format.sh
./scripts/pre-push.sh
```

`scripts/local.sh` accepts `root`, `backend` or `frontend` as its working directory, followed by a
command and its arguments. It verifies the local runtimes and uses a project-only toolchain PATH plus
basic OS utilities. It isolates HOME, XDG directories, temporary files and package-manager settings
for the child process. The calling shell's configuration is unchanged.

Format and pre-push scripts use the same environment. They invoke installed tools directly, so missing
tools fail instead of being downloaded by `npx`. Pre-push does not install dependencies; bootstrap is
the explicit installation step. Running bare system `python`, `npm` or `npx` bypasses this isolation.

Ask before launching tests, checks or formatters. Stop on a test failure and obtain approval before
changing code or tests. See `specs/testing.instructions.md` for validation boundaries.

## Recreating and updating

If the generated directories are deleted, rerun `./scripts/bootstrap.sh`. To replace an existing,
broken or outdated virtual environment and reinstall frontend dependencies:

```bash
./scripts/bootstrap.sh --recreate
```

This removes `.venv` and recreates it from the local interpreter; `npm ci` recreates `node_modules`.
Cached downloads and runtimes are reused. The generated folders contain no authoritative project
configuration and should not hold secrets or user data. After moving the checkout, recreate the
environment because virtualenv scripts contain absolute paths.

Review dependency updates in the committed requirements, constraints and npm lockfile. Runtime
updates require matching versions and archive checksums in `scripts/toolchain.env`; npm must match
the selected Node archive's bundled version. Keep exact Python, Node, npm and pip versions aligned
with CI and images. Use the local npm 11.20.0 when intentionally regenerating the frontend lockfile.
