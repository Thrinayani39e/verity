# Devpost submission text

Source of truth for the Devpost "text description" field. Paste each section
into its matching form field. No em dashes, per project style.

---

## Project name

Verity

## Tagline

Concurrent claims-processing agents with provable, time-traveled memory, built on CockroachDB, deployed on AWS.

---

## Inspiration

AI claims automation is not speculative. Lemonade approves and pays some claims via AI in about two seconds, with roughly 30 to 40 percent of claims now touchless. Tractable's computer-vision damage assessment runs at about 95 percent accuracy. Shift Technology catches over five billion dollars a year in claims fraud using AI. Insurance fraud costs the United States an estimated 308.6 billion dollars a year (Coalition Against Insurance Fraud), with 10 to 20 percent of all claims estimated fraudulent. Regulators are responding directly: the NAIC Model Bulletin on the Use of AI by Insurers, now in force in more than 24 states, requires insurers to maintain a documented AI governance program whose outputs can be explained in plain terms, not just to the engineers who built the system.

Most "agent with memory" demos treat memory as retrieval: embed something, look up similar things, hand it to a model. That solves one problem and ignores two others that actually break in production. First, once you have more than one agent, they race for the same work, and a stateless retrieval layer has no way to guarantee two agents never grab the same case. Second, a regulator or an auditor will eventually ask what the system knew at the exact moment it made a specific decision, and a system that only stores "the current state" cannot answer that honestly once the data has changed.

Verity exists to demonstrate that a persistent memory layer can solve both problems, using properties that are specific to CockroachDB, not incidental to it.

## What it does

Verity is a fleet of autonomous claims-processing agents for an insurance domain. Concretely:

- Claims are submitted with a policy number, description, and amount, and immediately embedded into a distributed vector index.
- Any number of agent workers can call into a shared pending-claims queue at once. Exactly one of them claims any given case, proven under real concurrent load, not assumed.
- Before deciding, an agent gathers grounded context: the policy's actual coverage and deductible, the claimant's own history, and semantically similar historical claims, then calls Amazon Bedrock to approve, deny, or flag the claim.
- Approved claims generate a payout that the database itself guarantees can never happen twice for the same claim.
- Flagged claims go to a human reviewer. Nothing pays out on a flagged case without an explicit human decision.
- Any past decision can be replayed: Verity reconstructs the exact historical database state the agent read at decision time, using CockroachDB's native point-in-time query capability, and shows it side by side with the current state.
- A separate capability, Fraud Ring Buster, finds claims that look unremarkable one at a time but are connected through shared identity attributes (a bank account, an address) across different claimant names, including cases where the connection is indirect, through a bridging claim.
- The whole system is deployed and publicly reachable, not a local demo.

## How I built it

Backend: Python, FastAPI running identically locally and on AWS Lambda via Mangum, psycopg3 against CockroachDB Serverless, Amazon Bedrock for both generation (Claude) and embeddings (Titan Text Embed v2).

Frontend: React 19, TypeScript, Vite, Tailwind CSS v4, a custom-designed dashboard (not a template), deployed as a static site behind CloudFront.

Infrastructure: AWS SAM and CloudFormation for the backend, GitHub Actions for CI on every push and a manually-triggered CD pipeline for deployment, an OIDC-federated IAM role so no long-lived AWS credentials live in CI.

### CockroachDB tools used, and how

- **Distributed vector indexing.** `claim_embeddings` is a table with a `VECTOR(1024)` column and a distributed vector index, queried by cosine distance in `vector_memory.py` for precedent and fraud-pattern similarity search. It lives in the same transactionally consistent store as the relational claim data, so a claim and its embedding are written in a single ACID transaction. There is no separate vector database to keep in sync and no window where the two can drift apart.
- **CockroachDB Cloud Managed MCP Server.** Configured via `.mcp.json` against the live cluster with OAuth, no static API key. Used throughout development to connect Claude Code directly to the cluster in read-only mode and inspect the agent's actual stored memory independently of the application code, real proof the memory layer is not a black box.
- **ccloud CLI.** `ops/ccloud/` provisions the cluster and checks its health from the terminal. `cluster_ops.py`'s preflight health check shells out to the same health-check script as a safety gate the ingestion pipeline runs before a bulk document write, so the pipeline fails fast against a degraded cluster instead of hammering it.
- **CockroachDB Agent Skills Repo.** Installed via `npx skills add cockroachlabs/cockroachdb-skills` and committed to the repository (`.claude/skills/`, `.agents/skills/`, `skills-lock.json`). Used while building for the serializable-transaction retry pattern, schema design, cluster health review, production provisioning guidance, and privilege hardening, and again live during this build to validate the multi-region design (see below).

Beyond the two required tools, Verity also uses CockroachDB's relational engine as a graph database: fraud ring detection is a Union-Find (disjoint-set) computation over shared-attribute edges between claims, run as ordinary SQL against the same store, not a separate graph database. And it validates a real multi-region `REGIONAL BY ROW` and `SURVIVE REGION FAILURE` design by running it against a free local multi-node CockroachDB cluster, killing every node in one region live, and proving that reads and even new writes to that region's data keep working from surviving replicas. That drill and its real, unedited output are committed at `ops/multiregion/`.

### AWS services used, and how

- **Amazon Bedrock.** Claude reasons over the retrieved context to produce every claim decision. Titan Text Embed v2 generates the vectors stored in CockroachDB.
- **AWS Lambda.** Three functions: the API (FastAPI via Mangum), a worker invoked on an EventBridge schedule that pulls and processes pending claims, and a document-ingestion function triggered by S3 uploads.
- **Amazon S3.** Stores raw claim document uploads, which the ingestion Lambda chunks and embeds into the same CockroachDB memory store, and separately hosts the built frontend as a static site.
- **Amazon CloudFront and API Gateway.** CloudFront serves the public frontend with origin access control; an HTTP API on API Gateway fronts the Lambda backend.
- **Amazon EventBridge Scheduler.** Invokes the claims worker on an interval so agents are continuously pulling and deciding on new work, not just responding to requests.
- **IAM.** Least-privilege, per-function policies (each Lambda can only invoke the two Bedrock models it actually uses), plus an OIDC-federated role for GitHub Actions with zero long-lived credentials.

## What makes this different

"Multi-agent insurance claims with fraud detection, on AWS" is not a unique combination by itself. AWS publishes its own reference architecture for exactly that pairing (`aws-samples/sample-agentic-insurance-claims-processing-eks`), a LangGraph application on EKS with four persona portals and ML-scored fraud risk. It's worth naming directly rather than hoping a judge doesn't notice the domain overlap. That architecture runs on MongoDB: no serializable-by-default isolation, no equivalent of `AS OF SYSTEM TIME`, and fraud detection implemented as a per-claim ML score rather than a query that traces relationships across claims. None of Verity's actual guarantees transfer to that stack without an application rebuilding, in code, properties CockroachDB provides structurally.

The insurance domain is the vehicle here, not the point. The point is four things a generic database, SQL or NoSQL, does not give you for free: a proven concurrency guarantee for many agents racing over shared state, a schema-level uniqueness constraint that makes a duplicate payout structurally impossible rather than merely unlikely, point-in-time replay that reconstructs real historical state instead of a cached snapshot, and a fraud-detection capability that reasons across records as a graph rather than scoring one record at a time.

## Challenges I ran into

Nearly every subsystem here had a real bug that only surfaced by running it against live infrastructure, not by reading documentation:

- Claude Sonnet 5's Bedrock entitlement never activated despite an accepted marketplace agreement, a known rollout delay; switched to the Sonnet 4.6 inference profile.
- Mixing an `AS OF SYSTEM TIME` read with a plain current-time read inside one transaction raises `FeatureNotSupported`. Fixed by using `SET TRANSACTION AS OF SYSTEM TIME` as the transaction's leading statement instead.
- The real `ccloud` CLI (v0.6.12) has a narrower command surface than the public reference documentation describes; no `service-account` or `backup` subcommands exist in that build. All provisioning scripts were rewritten against the CLI's actual, verified behavior.
- A CloudFormation circular dependency between an S3 bucket and the Lambda function it triggers has no clean declarative solution; resolved with an explicit `AWS::Lambda::Permission` using a computed ARN, and a small post-deploy script that wires the actual S3 notification outside CloudFormation's dependency graph.
- A fresh AWS account's Lambda concurrency floor is 10, which makes any positive `ReservedConcurrentExecutions` value mathematically invalid on that account (AWS requires at least 10 unreserved at all times). Removed it: the actual concurrency-safety guarantee lives in CockroachDB's serializable isolation, not in a Lambda setting.
- `sslmode=verify-full` with no explicit root certificate defaults to a path that only exists on a machine where someone manually placed it, which breaks on CI runners and inside Lambda. Fixed by bundling the actual CA certificate in the repository and resolving its path relative to the config module itself, not the process's working directory, so it resolves correctly in local development, CI, and Lambda alike.

## Accomplishments that I'm proud of

Verity uses all four CockroachDB tools listed in the hackathon requirements (two are required) and six AWS services (one is required), and every one of them does real work rather than a token integration. The concurrency guarantee, the payout-uniqueness constraint, and the multi-region survivability drill are proven with real tests and real, captured output, not asserted in a README. Fraud Ring Buster's transitive graph detection is, as far as I could verify against the strongest competing entries I researched, a genuinely novel capability in this space.

## What I learned

That an agentic memory layer's hardest problems are not retrieval problems. They are concurrency problems (many agents, one queue, zero double-claims), correctness problems (a financial action that must never duplicate), and accountability problems (proving what a system knew after the fact). CockroachDB's distributed SQL guarantees, serializable isolation by default, a native point-in-time query primitive, and one consistent store for relational and vector data, map directly onto those three problems in a way that a document store or a bolted-together relational-plus-vector stack does not.

## What's next

Deploying the validated multi-region design to a provisioned CockroachDB Cloud tier for real production use, extending document ingestion to structured extraction from real claim attachments (photos, PDFs) rather than plain text, and combining the exact-match fraud-ring signal with the existing semantic-similarity signal into a single, carefully calibrated risk score once there is a larger, real claims corpus to tune it against.

---

## Optional: feedback on CockroachDB AI tools

Two pieces of real feedback from actually building on these tools rather than just reading about them:

- The `feature.vector_index.enabled` cluster setting behaves differently across tiers in ways that were not obvious from the documentation alone; on Basic/Serverless it is read-only and defaults to enabled, but the natural first instinct (set it explicitly) produces a confusing `disallowed statement type` error rather than a clear message pointing at the tier restriction and the default.
- `cockroach demo --demo-locality` is an excellent, underused tool for validating multi-region application design for free, entirely locally, including live node-kill drills. It deserves more visibility in onboarding material aimed at people building on Cloud Serverless who cannot otherwise exercise `SURVIVE REGION FAILURE` without upgrading tiers.

---

## Links to include on the submission form

- Public repository: https://github.com/Thrinayani39e/verity
- Live demo app: https://d2ea8hzslf8yqe.cloudfront.net
- Demo video: (add YouTube/Vimeo link after recording and uploading)
- Architecture diagram: see `ARCHITECTURE.md` in the repository (Mermaid diagram, renders on GitHub)
