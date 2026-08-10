# Verity

**Concurrent claims-processing agents with provable, time-traveled memory — built on CockroachDB, deployed on AWS.**

Verity is a fleet of autonomous claims/underwriting agents that pull work from a shared queue, decide on cases using semantic recall over historical precedent, and record every decision with enough fidelity that a compliance reviewer can later reconstruct *exactly* what the agent knew at the moment it decided — even after the underlying data has changed.

It exists to demonstrate two things most "agent with memory" demos don't:

1. **Agentic memory has a concurrency problem, not just a persistence problem.** Multiple autonomous agents acting on shared state need transactional guarantees a single-user chatbot never does — otherwise you get double-processed claims, double payouts, duplicate work. Verity proves, on demand, that no claim is ever claimed by more than one agent, using CockroachDB's serializable isolation, not application-level locking.
2. **Agent memory should be auditable, not just persistent.** Verity stores the exact cluster read-timestamp behind every decision and can replay it later with `AS OF SYSTEM TIME`, reconstructing the agent's actual memory state at decision time — a capability that's native to CockroachDB and not something an ordinary snapshot table can guarantee.

## Why this matters (the real-world problem)

Claims and underwriting automation is a real, expensive, currently under-scrutiny industry process: duplicate payouts cost insurers money, and regulators (EU AI Act high-risk classification, NAIC's AI model bulletin) are increasingly asking "what did the automated system actually know when it made this decision?" Verity's answer is a database-level guarantee, not a best-effort log.

## CockroachDB tools used

| Tool | How it's used |
|---|---|
| **Distributed Vector Indexing** | `claim_embeddings` table (`db/schema.sql`) with a `VECTOR(1024)` column and a distributed vector index, used for fraud-pattern / precedent similarity search in `src/verity/vector_memory.py`. Lives in the same transactionally consistent store as the relational claim data — no separate vector DB, no sync lag. |
| **Managed MCP Server** | Configured per `ops/mcp/mcp_config_example.json`. Lets a human (compliance reviewer, or you, live in the demo) connect Claude Code/Cursor directly to the cluster in read-only mode and query the agent's actual memory, independent of the application. |
| **ccloud CLI** | `ops/ccloud/*.sh` provision the cluster, create a scoped service account, and check cluster health/backup status. `src/verity/cluster_ops.py::preflight_health_check` shells out to `health_check.sh` as a safety gate before bulk document ingestion — the agent's environment checks its own infrastructure before doing large writes. |
| **Agent Skills Repo** | [`cockroachlabs/cockroachdb-skills`](https://github.com/cockroachlabs/cockroachdb-skills), installed via `npx skills add cockroachlabs/cockroachdb-skills` (see `.claude/skills/`, tracked in `skills-lock.json`). Used while building Verity for `designing-application-transactions` (the retry-loop pattern in `src/verity/db.py`), `cockroachdb-sql`, `managing-cluster-settings` (enabling vector indexing), `reviewing-cluster-health`, `provisioning-cluster-for-production`, and `hardening-user-privileges`. |

(Two tools are required; Verity uses all four of the above.)

## AWS services used

| Service | How it's used |
|---|---|
| **Amazon Bedrock** | Claude Sonnet 5 (`anthropic.claude-sonnet-5`) reasons over retrieved context to produce claim decisions; Titan Text Embeddings V2 generates the vectors stored in CockroachDB. |
| **AWS Lambda** | Three functions: the API (`lambdas/api_handler.py`, FastAPI via Mangum), the claims worker (`lambdas/worker_handler.py`, invoked on an interval with concurrency > 1 so agents genuinely race for work), and document ingestion (`lambdas/ingestion_handler.py`, triggered by S3 uploads). |
| **Amazon S3** | Stores raw claim attachments; uploads trigger the ingestion Lambda, which chunks and embeds them into the same CockroachDB memory store. |

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full diagram and data model.

## Judging-criteria alignment (self-assessment)

- **Agentic Memory Design** — memory is relational + vector + append-only audit log in one consistently-committed system, exercised under real concurrent load, not a single toy query.
- **Technical Implementation** — CockroachDB's documented client-side retry pattern for serialization failures (`src/verity/db.py`), a distributed vector index used for a real similarity task, and a narrow, safe (non-shell-injectable) ccloud CLI integration.
- **Real-World Impact** — claims/underwriting automation is a real, costly, increasingly-regulated enterprise process.
- **Production Readiness** — least-privilege IAM (`infra/template.yaml`), an append-only audit trail, a concurrency-safety self-check endpoint (`/audit/double-claims-check`), and a preflight cluster-health gate before bulk writes.
- **Creativity & Originality** — time-travel decision replay via `AS OF SYSTEM TIME` and a concurrency-proof demo script are not things most "chatbot with memory" submissions will build.

---

## Setup

You'll need a CockroachDB Cloud account and an AWS account. Budget ~30-45 minutes for first-time setup (most of it is waiting for Bedrock model access approval).

### 1. CockroachDB Cloud

1. Go to [cockroachlabs.cloud/signup](https://cockroachlabs.cloud/signup) and sign up (free, no credit card; new orgs start with $400 in free credit on top of the always-free Serverless tier).
2. **Install the ccloud CLI** ([docs](https://www.cockroachlabs.com/docs/cockroachcloud/ccloud-get-started)), then run `ccloud auth login`.
3. Run `ccloud quickstart` for the fastest path to a running cluster + SQL user + connection string in one interactive command — or use `ops/ccloud/provision_cluster.sh` for the scripted equivalent, which also creates a service account for agent-driven ops (used by the MCP Server key and `cluster_ops.py`'s health check). Note the cluster ID (`ccloud cluster list --output json`) — you'll need it as `CLUSTER_ID` for `ops/ccloud/*.sh`.
4. In the Cloud Console, go to your cluster → **Connect**, copy the connection string, and add `?sslmode=verify-full` if it isn't already there.
5. Apply the schema:
   ```bash
   psql "$DATABASE_URL" -f db/schema.sql
   ```
   The schema file's header comment includes `SET CLUSTER SETTING feature.vector_index.enabled = true;` — run that first if `CREATE VECTOR INDEX` errors out on your cluster's version. If vector indexing is unavailable entirely, the `VECTOR` column and `<=>` operator still work as a full-scan fallback — just drop that one `CREATE VECTOR INDEX` statement.
6. **Enable the Managed MCP Server:** in the Cloud Console, go to your cluster → **Connect** → the MCP integration option, which points you at `https://cockroachlabs.cloud/mcp`. Copy `ops/mcp/mcp_config_example.json` to `ops/mcp/mcp_config.json`, fill in your cluster ID and the service-account API key from step 3, and merge it into your Claude Code / Cursor MCP settings (see [cockroachdb/claude-plugin](https://github.com/cockroachdb/claude-plugin) for the reference config format this is based on).
7. **Pull in the Agent Skills Repo** (optional but recommended — already done in this repo, see `.claude/skills/`): `npx skills add cockroachlabs/cockroachdb-skills`.

### 2. AWS

1. Create an AWS account if you don't have one: [aws.amazon.com/free](https://aws.amazon.com/free).
2. In the **Bedrock** console (region `us-east-1`), go to **Model access** and request access to:
   - `Claude Sonnet 5` (Anthropic — note: Claude 3.5 Sonnet reached end-of-life 2026-07-30 and is no longer usable; this project targets the current model)
   - `Titan Text Embeddings V2` (Amazon)
   Titan is usually instant. Anthropic models may prompt a one-time use-case form the first time — fill it in honestly (project name, a real link, a short description of what you're building) and submit. Start this early since approval timing can vary.
3. Create an IAM user or role with:
   - `bedrock:InvokeModel` on the two model ARNs above (see `infra/template.yaml`'s `BedrockInvokePolicy` for the exact scoped policy)
   - S3 read/write on your documents bucket
   - If deploying via SAM: permissions to create Lambda functions, API Gateway, EventBridge rules, and S3 buckets (or use an admin role for the hackathon and tighten later).
4. Create an S3 bucket for claim documents (or let `infra/template.yaml` create one for you on deploy).
5. Configure credentials locally: `aws configure` (or `aws sso login` if your org uses SSO).

### 3. Local development

```bash
python -m venv .venv
source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -e .
pip install -r requirements.txt

cp .env.example .env
# fill in DATABASE_URL, AWS_REGION, DOCUMENTS_BUCKET, etc.

uvicorn verity.api:app --reload --port 8000
```

Open `web/index.html` directly in a browser (or serve it: `python -m http.server 8080 -d web`), set the API base URL to `http://localhost:8000`, and it should show "connected".

### 4. Seed data and run the demo scripts

```bash
python scripts/seed_demo_data.py
# note the printed ORG_ID and AGENT_ID

python scripts/simulate_concurrent_claims.py --org-id <ORG_ID> --claims 30 --workers 12
python scripts/demo_time_travel.py --org-id <ORG_ID> --agent-id <AGENT_ID>
```

### 5. Deploy to AWS

```bash
cd infra
sam build
sam deploy --guided
```

This provisions the API (API Gateway + Lambda), the worker (Lambda + EventBridge schedule, deployed with `ReservedConcurrentExecutions: 5` so it genuinely runs concurrently in production), the ingestion pipeline (Lambda + S3 event trigger), and the documents bucket. Update `web/app.js`'s default API base (or set it in the dashboard UI) to the deployed API URL from the stack outputs.

### 6. Tests

```bash
pytest tests/                       # pure-logic tests, no external services needed
DATABASE_URL=... pytest tests/      # also runs the live concurrency-safety integration test
```

---

## Project layout

```
db/schema.sql            CockroachDB schema: claims, events, vector index, decisions
src/verity/              Core application package
  db.py                  Connection pool + serializable-transaction retry loop
  bedrock_client.py       Bedrock embeddings + Claude decision calls
  vector_memory.py        Distributed vector index read/write
  claims_engine.py         Concurrency-safe claim/process workflow
  audit.py                Time-travel (AS OF SYSTEM TIME) decision replay
  ingestion.py             S3 document -> chunk -> embed pipeline
  cluster_ops.py           Safe ccloud CLI preflight health check
  api.py                   FastAPI app (local + Lambda)
lambdas/                  Lambda entry points (api, worker, ingestion)
infra/template.yaml       AWS SAM template
ops/ccloud/               Cluster provisioning + health/backup scripts
ops/mcp/                  Managed MCP Server config example
web/                       Minimal dashboard (claims queue, decisions, time-travel, concurrency proof)
scripts/                   Demo scripts: seed data, concurrency proof, time-travel demo
tests/                     Unit + integration tests
.claude/skills/            CockroachDB Agent Skills Repo, installed via npx skills add (see skills-lock.json)
```

## Security notes

- The ccloud CLI integration only ever runs a fixed script with a fixed argument list (`src/verity/cluster_ops.py`) — never a user-supplied or agent-composed shell command.
- `DATABASE_URL` is passed as a CloudFormation parameter for hackathon simplicity; for anything beyond a demo, move it to AWS Secrets Manager and reference it with a dynamic reference in `infra/template.yaml`.
- Bedrock IAM permissions are scoped to `InvokeModel` on the two specific model ARNs Verity uses, not a managed full-access policy.
- The MCP Server connection should always use a **read-only** API key for the audit/inspection use case described here.

## License

MIT — see [LICENSE](LICENSE).
