# Verity

**Concurrent claims-processing agents with provable, time-traveled memory — built on CockroachDB, deployed on AWS.**

Verity is a fleet of autonomous claims-processing agents that pull work from a shared queue, decide on cases using semantic recall over historical precedent, and record every decision with enough fidelity that a compliance reviewer can later reconstruct *exactly* what the agent knew at the moment it decided — even after the underlying data has changed.

It exists to demonstrate two things most "agent with memory" demos don't:

1. **Agentic memory has a concurrency problem, not just a persistence problem.** Real claims platforms (e.g. Guidewire ClaimCenter, the industry-standard system) avoid this problem today by routing every claim through a centralized dispatcher — round-robin or rules-based assignment to a single human adjuster — specifically so two workers never have to race for the same case. That works when "workers" are humans: slow, limited in number, easy to serialize through one dispatcher. It stops working once "workers" are AI agents that can act in parallel, across regions, far faster than any human queue can dispatch — the centralized assignment service becomes both a bottleneck and a single point of failure. Verity removes the central dispatcher entirely: any number of agents can call `claim_next_pending()` concurrently, and CockroachDB's serializable isolation — not application-level locking — guarantees none of them ever double-claim a case. `scripts/simulate_concurrent_claims.py` proves this under load.
2. **Agent memory should be auditable, not just persistent.** Verity stores the exact cluster read-timestamp behind every decision and can replay it later with `AS OF SYSTEM TIME`, reconstructing the agent's actual memory state at decision time — a capability that's native to CockroachDB and not something an ordinary snapshot table can guarantee.

## Why this matters (the real-world problem)

This isn't a speculative use case — AI-driven claims automation is already live and valuable in production: Lemonade approves and pays some claims via AI in about two seconds with ~30-40% of claims now touchless, Tractable's computer-vision damage assessment runs at ~95% accuracy, and Shift Technology catches over $5B/year in claims fraud using AI. The stakes are real too: insurance fraud costs the US an estimated **$308.6B/year** (Coalition Against Insurance Fraud), with 10-20% of all claims estimated fraudulent.

Regulators are responding directly to systems like this. The **NAIC Model Bulletin on the Use of AI by Insurers** (adopted Dec 2023, now in force in ~24+ US states) requires insurers to maintain a documented AI governance program whose outputs "can be interpreted and communicated to consumers and regulators in plain terms" — not just to the data scientists who built it. Verity's `AS OF SYSTEM TIME` decision replay is a concrete technical mechanism for meeting exactly that requirement: reconstructing precisely what an agent knew, on demand, rather than trusting a static log that could be incomplete or stale. (Note: the EU AI Act's Annex III high-risk classification specifically covers life/health insurance *underwriting* — risk assessment and pricing — not claims adjudication; it's relevant context for where insurance-AI regulation is heading generally, not a direct citation for this specific use case.)

## CockroachDB tools used

| Tool | How it's used |
|---|---|
| **Distributed Vector Indexing** | `claim_embeddings` table (`db/schema.sql`) with a `VECTOR(1024)` column and a distributed vector index, used for fraud-pattern / precedent similarity search in `src/verity/vector_memory.py`. Lives in the same transactionally consistent store as the relational claim data — no separate vector DB, no sync lag. |
| **Managed MCP Server** | Configured per `ops/mcp/mcp_config_example.json`. Lets a human (compliance reviewer, or you, live in the demo) connect Claude Code/Cursor directly to the cluster in read-only mode and query the agent's actual memory, independent of the application. |
| **ccloud CLI** | `ops/ccloud/*.sh` provision the cluster and check cluster health (`ccloud cluster info`). `src/verity/cluster_ops.py::preflight_health_check` shells out to `health_check.sh` as a safety gate before bulk document ingestion — the agent's environment checks its own infrastructure before doing large writes. |
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
- **Real-World Impact** — AI claims automation is already live in production at scale (Lemonade, Tractable, Shift Technology); insurance fraud costs the US $308.6B/year (Coalition Against Insurance Fraud); the NAIC Model Bulletin on AI (live in 24+ states) directly requires the kind of explainability Verity provides.
- **Production Readiness** — least-privilege IAM (`infra/template.yaml`), an append-only audit trail, a concurrency-safety self-check endpoint (`/audit/double-claims-check`), and a preflight cluster-health gate before bulk writes.
- **Creativity & Originality** — real claims platforms avoid the concurrency problem with a centralized human dispatcher; Verity's insight is that AI-agent throughput breaks that assumption, and removing the dispatcher entirely (relying on CockroachDB's serializable isolation instead) is only safe because of what CockroachDB specifically guarantees. Time-travel decision replay via `AS OF SYSTEM TIME` is a second angle most "chatbot with memory" submissions won't build.

---

## Setup

You'll need a CockroachDB Cloud account and an AWS account. Budget ~30-45 minutes for first-time setup (most of it is waiting for Bedrock model access approval).

### 1. CockroachDB Cloud

1. Go to [cockroachlabs.cloud/signup](https://cockroachlabs.cloud/signup) and sign up (free, no credit card; new orgs start with $400 in free credit on top of the always-free Serverless tier).
2. **Install the ccloud CLI** ([docs](https://www.cockroachlabs.com/docs/cockroachcloud/ccloud-get-started)), then run `ccloud auth login` (opens a browser to approve).

   Note: the publicly downloadable CLI build (v0.6.12 at the time of writing) has a smaller command set than the [official reference docs](https://www.cockroachlabs.com/docs/cockroachcloud/ccloud-reference) describe — notably no `service-account` or `backup` subcommands. `ops/ccloud/*.sh` are written against the commands this build actually has (verified directly with `ccloud --help`); if you're on a newer CLI version with those commands, feel free to use them instead. For a service-account API key (only needed for headless/automated MCP or API access — interactive use doesn't need one), create it via the Cloud Console's Service Accounts page.
3. Run `ccloud quickstart` for the fastest path to a running cluster + SQL user + connection string in one interactive command — or use `ops/ccloud/provision_cluster.sh` for the scripted equivalent. Both `ops/ccloud/health_check.sh` and `backup_status.sh` take the cluster's **name** (not its UUID) as their one argument, e.g. `bash ops/ccloud/health_check.sh lost-spirit` — get it with `ccloud cluster list --output json`.
4. In the Cloud Console, go to your cluster → **Connect**, copy the connection string, and add `?sslmode=verify-full` if it isn't already there.
5. Apply the schema:
   ```bash
   psql "$DATABASE_URL" -f db/schema.sql
   ```
   The schema file's header comment includes `SET CLUSTER SETTING feature.vector_index.enabled = true;` — run that first if `CREATE VECTOR INDEX` errors out on your cluster's version. If vector indexing is unavailable entirely, the `VECTOR` column and `<=>` operator still work as a full-scan fallback — just drop that one `CREATE VECTOR INDEX` statement.
6. **Enable the Managed MCP Server:** in the Cloud Console, go to your cluster → **Connect** → the MCP integration option. It generates a ready-to-use config pointing at `https://cockroachlabs.cloud/mcp` with just your cluster ID — no API key needed, since it authenticates via an interactive OAuth 2.1 approval in your browser on first connect. This repo's `.mcp.json` already has this wired up for Claude Code; copy `ops/mcp/mcp_config_example.json`'s pattern for Cursor/VS Code. (A service-account API key is only needed for headless/automated access — see the `_headless_automation_variant` in that file.)
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
