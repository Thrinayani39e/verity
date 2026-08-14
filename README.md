# Verity

**Concurrent claims-processing agents with provable, time-traveled memory — built on CockroachDB, deployed on AWS.**

Verity is a fleet of autonomous claims-processing agents that pull work from a shared queue, decide on cases using semantic recall over historical precedent, and record every decision with enough fidelity that a compliance reviewer can later reconstruct *exactly* what the agent knew at the moment it decided — even after the underlying data has changed.

It exists to demonstrate two things most "agent with memory" demos don't:

1. **Agentic memory has a concurrency problem, not just a persistence problem.** Real claims platforms (e.g. Guidewire ClaimCenter, the industry-standard system) avoid this problem today by routing every claim through a centralized dispatcher — round-robin or rules-based assignment to a single human adjuster — specifically so two workers never have to race for the same case. That works when "workers" are humans: slow, limited in number, easy to serialize through one dispatcher. It stops working once "workers" are AI agents that can act in parallel, across regions, far faster than any human queue can dispatch — the centralized assignment service becomes both a bottleneck and a single point of failure. Verity removes the central dispatcher entirely: any number of agents can call `claim_next_pending()` concurrently, and CockroachDB's serializable isolation — not application-level locking — guarantees none of them ever double-claim a case. `scripts/simulate_concurrent_claims.py` proves this under load.
2. **Agent memory should be auditable, not just persistent.** Verity stores the exact cluster read-timestamp behind every decision and can replay it later with `AS OF SYSTEM TIME`, reconstructing the agent's actual memory state at decision time — a capability that's native to CockroachDB and not something an ordinary snapshot table can guarantee.
3. **Memory should see patterns no single claim reveals — including patterns two hops away.** A fraud ring rarely looks suspicious one claim at a time, and rarely shares just one attribute cleanly across every member: claim A and B might share a bank account while B and C share only an address. `src/verity/fraud_ring.py` treats claims as a graph and computes real connected components (Union-Find) over shared attributes, so A and C end up in the same ring even though they share nothing directly — a case a single `GROUP BY`, let alone a stateless one-claim-at-a-time agent, cannot find. Surfaced live at `/fraud-rings` and rendered as an interactive graph in the "Fraud Rings" dashboard page, with edges styled by which attribute connected each pair.

## Why this matters (the real-world problem)

This isn't a speculative use case — AI-driven claims automation is already live and valuable in production: Lemonade approves and pays some claims via AI in about two seconds with ~30-40% of claims now touchless, Tractable's computer-vision damage assessment runs at ~95% accuracy, and Shift Technology catches over $5B/year in claims fraud using AI. The stakes are real too: insurance fraud costs the US an estimated **$308.6B/year** (Coalition Against Insurance Fraud), with 10-20% of all claims estimated fraudulent.

Regulators are responding directly to systems like this. The **NAIC Model Bulletin on the Use of AI by Insurers** (adopted Dec 2023, now in force in ~24+ US states) requires insurers to maintain a documented AI governance program whose outputs "can be interpreted and communicated to consumers and regulators in plain terms" — not just to the data scientists who built it. Verity's `AS OF SYSTEM TIME` decision replay is a concrete technical mechanism for meeting exactly that requirement: reconstructing precisely what an agent knew, on demand, rather than trusting a static log that could be incomplete or stale. (Note: the EU AI Act's Annex III high-risk classification specifically covers life/health insurance *underwriting* — risk assessment and pricing — not claims adjudication; it's relevant context for where insurance-AI regulation is heading generally, not a direct citation for this specific use case.)

## Why CockroachDB (and not Postgres, DynamoDB, or a bolted-on vector store)

These are the three specific properties this system needs, and why the usual alternatives don't provide them without extra work Verity would otherwise have to do itself:

- **Serializable isolation is the default, not an opt-in.** Postgres defaults new transactions to READ COMMITTED; getting the same double-claim guarantee `claim_next_pending` relies on would mean a future engineer remembering to set `SERIALIZABLE` explicitly on that one code path, forever. In CockroachDB every transaction is serializable by default — the safety property is structural, not a setting someone can quietly forget.
- **One consistent store for relational + vector + audit data.** The standard "agent with memory" architecture pairs a relational/NoSQL database with a separate vector store (Pinecone, OpenSearch, a Bedrock Knowledge Base). That means the claim and its embedding are written in two separate operations against two separate systems — if the second write fails or lags, you get a claim marked "approved" whose memory was never actually stored, invisible until an audit needs it. In CockroachDB, `submit_claim`'s claim INSERT and its embedding INSERT happen in the same ACID transaction (`claims_engine.py`); that inconsistency is structurally impossible, not just unlikely. DynamoDB has the same problem plus no native vector search or ad hoc relational joins at all.
- **`AS OF SYSTEM TIME` has no equivalent in eventually-consistent distributed stores.** Cassandra, MongoDB's default read preference, and DynamoDB global tables all trade strong consistency for global distribution — meaning an agent could read a stale "pending" status on a claim another agent already claimed a moment earlier. That's precisely the race the concurrency guarantee above depends on not happening. CockroachDB gives up neither: global distribution *and* serializability, which is also what makes point-in-time replay (`audit.py::replay_decision`) a real, consistent reconstruction instead of a best-effort guess.

## CockroachDB tools used

| Tool | How it's used |
|---|---|
| **Distributed Vector Indexing** | `claim_embeddings` table (`db/schema.sql`) with a `VECTOR(1024)` column and a distributed vector index, used for fraud-pattern / precedent similarity search in `src/verity/vector_memory.py`. Lives in the same transactionally consistent store as the relational claim data — no separate vector DB, no sync lag. `fraud_ring.py` pairs this with exact-match relational clustering (shared bank account/address) for a second, independent fraud signal over the same store. |
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

## Design highlights

Memory here is relational, vector, and an append-only audit log in one consistently-committed system, exercised under real concurrent load rather than a single toy query — with CockroachDB's documented client-side retry pattern for serialization failures (`src/verity/db.py`), a distributed vector index doing real similarity work, and a narrow, safe (non-shell-injectable) ccloud CLI integration.

The concurrency angle is the part most "agent with memory" projects won't build: real claims platforms avoid double-processing today with a centralized human dispatcher, an approach that works because humans are slow. AI-agent throughput breaks that assumption — Verity removes the dispatcher entirely and relies on CockroachDB's serializable isolation instead, which is only safe because of what CockroachDB specifically guarantees. Time-travel decision replay via `AS OF SYSTEM TIME` is a second angle in the same spirit.

**Fraud Ring Buster** (`/fraud-rings`, `src/verity/fraud_ring.py`) is a third: claims that share a bank account or address across different claimant names look completely unremarkable evaluated one at a time — nothing in any single claim would trip a review threshold. Real rings rarely share one attribute cleanly across every member, so this isn't a single `GROUP BY`: it treats claims as a graph and computes connected components (Union-Find) over shared-attribute edges, so a claim bridged in through a second attribute correctly joins a ring it shares nothing directly with. Rendered as a force-directed graph on the dashboard, edges styled by which attribute connected each pair, so a reviewer sees not just that a ring exists but how each claim was pulled into it.

On the operational side: least-privilege IAM (`infra/template.yaml`), an append-only audit trail, a concurrency-safety self-check endpoint (`/audit/double-claims-check`), and a preflight cluster-health gate before bulk writes. And the use case itself isn't hypothetical — AI claims automation is already live in production at scale (Lemonade, Tractable, Shift Technology), insurance fraud costs the US $308.6B/year (Coalition Against Insurance Fraud), and the NAIC Model Bulletin on AI (live in 24+ states) already requires the kind of explainability this design provides.

This deployment runs on CockroachDB's free Serverless/Basic tier, which is single-region by design. [ARCHITECTURE.md](ARCHITECTURE.md#multi-region-design-validated-locally-not-deployed-to-production) documents the real `REGIONAL BY ROW` migration path this schema is shaped for — partitioned by organization, denormalized so a claim's full decision-context stays co-located with its leaseholder, with `SURVIVE REGION FAILURE` for the actual "no data loss even if a region goes dark" guarantee. Not run against the production Serverless tier (it requires upgrading off the free tier), but validated for real: [`ops/multiregion/`](ops/multiregion/) runs this exact pattern against a free local 9-node cluster and kills every node in the primary region live — reads and even new writes to that region's data keep working from surviving replicas, real output captured in `ops/multiregion/drill_output_2026-08-14.txt`.

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
ops/multiregion/          Local region-kill drill validating the REGIONAL BY ROW design
web/                       Minimal dashboard (claims queue, decisions, time-travel, concurrency proof)
scripts/                   Demo scripts: seed data, concurrency proof, time-travel demo
docs/demo_script.ts       Source of truth for the submission demo video script
tests/                     Unit + integration tests
.claude/skills/            CockroachDB Agent Skills Repo, installed via npx skills add (see skills-lock.json)
```

## Security notes

- The ccloud CLI integration only ever runs a fixed script with a fixed argument list (`src/verity/cluster_ops.py`) — never a user-supplied or agent-composed shell command.
- `DATABASE_URL` is passed as a CloudFormation parameter for hackathon simplicity; for anything beyond a demo, move it to AWS Secrets Manager and reference it with a dynamic reference in `infra/template.yaml`.
- Bedrock IAM permissions are scoped to `InvokeModel` on the two specific model ARNs Verity uses, not a managed full-access policy.
- **User authentication is deliberately out of scope for this submission.** The API and dashboard are unauthenticated so judges get frictionless access to every screen. This was a conscious trade-off, not an oversight: the schema is already multi-tenant (`organizations`, with every claim/policy/agent scoped to one), so the natural extension is per-org user accounts with JWT-based API auth and a `WHERE org_id = :current_org` filter added to every query — the query shapes already assume that structure, they just aren't gated behind it yet. Given a fixed deadline, that time went into the concurrency/audit/policy engine instead, since those are what the judging criteria actually weigh.
- The MCP Server connection should always use a **read-only** API key for the audit/inspection use case described here.

## License

MIT — see [LICENSE](LICENSE).
