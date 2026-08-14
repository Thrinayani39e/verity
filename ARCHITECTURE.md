# Architecture

```mermaid
flowchart TB
    subgraph Client
        WEB[Web dashboard<br/>web/index.html]
        MCP_CLIENT[Claude Code / Cursor<br/>connected via MCP]
    end

    subgraph AWS
        APIGW[API Gateway]
        LAMBDA_API[Lambda: api_handler<br/>FastAPI via Mangum]
        LAMBDA_WORKER[Lambda: worker_handler<br/>claims agent worker]
        EVENTBRIDGE[EventBridge Scheduler<br/>invokes workers on interval]
        LAMBDA_INGEST[Lambda: ingestion_handler]
        S3[(S3<br/>claim documents)]
        BEDROCK_LLM[Bedrock: Claude<br/>decision reasoning]
        BEDROCK_EMBED[Bedrock: Titan Embed v2<br/>vectorization]
    end

    subgraph CockroachDB Cloud
        CRDB[(CockroachDB cluster)]
        VEC[Distributed vector index<br/>claim_embeddings]
        AUDIT[Append-only claim_events<br/>+ AS OF SYSTEM TIME replay]
        MCP_SERVER[Managed MCP Server<br/>read-only]
        FRAUD[Fraud ring detection<br/>relational clustering across claims]
    end

    WEB -->|HTTPS| APIGW --> LAMBDA_API
    LAMBDA_API -->|SQL, serializable txns| CRDB
    LAMBDA_API --> BEDROCK_EMBED
    LAMBDA_API --> BEDROCK_LLM

    EVENTBRIDGE -->|invoke, concurrency > 1| LAMBDA_WORKER
    LAMBDA_WORKER -->|claim_next_pending<br/>serializable, retried on 40001| CRDB
    LAMBDA_WORKER --> BEDROCK_EMBED
    LAMBDA_WORKER --> BEDROCK_LLM
    LAMBDA_WORKER -->|ccloud CLI preflight| CCLOUD[ccloud CLI]
    CCLOUD -->|cluster show / backup list| CRDB

    S3 -->|ObjectCreated event| LAMBDA_INGEST
    LAMBDA_INGEST --> BEDROCK_EMBED
    LAMBDA_INGEST -->|store chunks + embeddings| CRDB

    CRDB --- VEC
    CRDB --- AUDIT
    CRDB --- MCP_SERVER
    CRDB --- FRAUD
    LAMBDA_API -->|GET /fraud-rings| FRAUD
    MCP_CLIENT -->|read-only query| MCP_SERVER
```

## Why each piece exists

- **API (Lambda + API Gateway, FastAPI/Mangum)** — same code runs locally
  (`uvicorn`) and in Lambda; no fork between dev and prod.
- **Worker Lambda + EventBridge Scheduler** — deliberately invoked with
  concurrency, so multiple independent "agents" race for the same pool of
  pending claims. This is the setup that makes CockroachDB's serializable
  isolation load-bearing rather than decorative — see
  `src/verity/claims_engine.py::claim_next_pending` and the retry loop in
  `src/verity/db.py::run_in_transaction`.
- **Distributed vector index** (`claim_embeddings`, `CREATE VECTOR INDEX`) —
  semantic recall over claim descriptions and ingested documents, used for
  fraud-pattern / precedent matching, living in the same transactionally
  consistent store as the relational claim data (no separate vector DB to
  keep in sync).
- **Append-only `claim_events` + `AS OF SYSTEM TIME`** — every decision
  stores the exact HLC read timestamp it used
  (`decisions.context_hlc_time`). `src/verity/audit.py::replay_decision`
  re-runs the original queries `AS OF SYSTEM TIME` that value to reconstruct
  precisely what the agent knew, even after the underlying data has since
  changed. This is the compliance/audit story.
- **Managed MCP Server** — lets a human (compliance reviewer, or you, live
  in the demo video) connect Claude Code/Cursor directly to the cluster in
  read-only mode and query the agent's actual memory, independent of the
  application — proof the memory layer isn't a black box.
- **ccloud CLI** — used both for cluster provisioning (`ops/ccloud/provision_cluster.sh`)
  and as a narrow, read-only preflight check
  (`src/verity/cluster_ops.py::preflight_health_check`) the ingestion
  pipeline calls before a bulk document batch, so the pipeline fails fast
  and clearly instead of hammering a degraded cluster.
- **S3** — durable store for raw claim attachments; the ingestion Lambda
  parses and embeds them into the same memory store the claims agent reads
  from.
- **Fraud ring detection** (`src/verity/fraud_ring.py`) — connected
  components (Union-Find) over shared-attribute edges in the same store, so
  claims bridged together transitively (A-B share a bank account, B-C share
  an address) merge into one ring, not just direct single-attribute
  clusters. See
  [Fraud Ring Buster](#fraud-ring-buster-memory-across-claims-not-within-one)
  below for why this is a distinct kind of memory from everything above it.

## Data model

See [`db/schema.sql`](db/schema.sql) for the full DDL. Five tables carry the
memory:

| Table | Role |
|---|---|
| `claims` | current transactional state of each case |
| `claim_events` | append-only log; source of truth for time-travel replay |
| `claim_embeddings` | distributed vector index; semantic memory |
| `decisions` | every agent decision + the exact context/timestamp it used |
| `documents` | S3 pointers + extracted text for ingested attachments |

`claims.bank_account_last4` and `claims.claimant_address` are the two
optional columns `fraud_ring.py` clusters on (see below). Neither is ever
read by the agent's own decision logic (`claims_engine.py::_gather_context`)
- feeding identity attributes into the model's reasoning would be a real
bias risk. They exist solely as a second, independent memory surface a
human reviewer can query across every claim on file.

## Fraud Ring Buster: memory across claims, not within one

Every other feature in this system answers "what did the agent know about
*this* claim." Fraud Ring Buster (`src/verity/fraud_ring.py`, `GET
/fraud-rings`, `web-app/src/pages/FraudRing.tsx`) answers a different
question: what's true *across* claims that no single claim reveals.

Three claims filed under three different names, weeks apart, each for an
unremarkable amount, are individually invisible to any per-claim review -
automated or human. A single `GROUP BY` on one shared attribute finds the
easy case, but real rings are rarely that clean: claim A and B might share a
bank account while B and C share nothing but an address. A and C are still
part of one ring - connected through B - but no single-attribute query finds
that. `fraud_ring.py` treats claims as a graph instead: every shared
attribute is an edge, and Union-Find (`_UnionFind`, path-compressed
disjoint-set) computes the actual connected components, so a claim bridged
in through a second attribute correctly merges into the same ring as claims
it shares nothing directly with. `tests/test_fraud_ring.py` covers this
transitive case explicitly, along with the simpler cases and the
"unrelated claims must stay unrelated" property that matters just as much -
a ring-finder that over-merges is as useless as one that misses rings.

This is the same argument the concurrency and replay features make, applied
to a different axis: a stateless agent evaluating claims one at a time,
however good its reasoning, cannot see this pattern by construction - there
is no "this claim" whose context includes it, and no single claim's context
includes a claim two hops away in the graph either. Only a persistent store
that can be queried across every claim ever filed, and reasoned about as a
graph, can. The frontend renders each detected ring as a force-directed
graph (`d3-force`, plain SVG) with edges styled by the attribute that formed
them (solid for a shared bank account, dashed for a shared address), so a
reviewer can see not just that a ring exists but exactly how each claim was
pulled into it.

The relational clustering here is deliberately exact-match (no fuzzy
matching, no model call) - which is what makes it fast, deterministic, and
unit-testable without a live database - and is a second, independent signal
alongside the semantic similarity `vector_memory.find_similar_claims`
already provides. The two aren't merged into one combined query: exact
identity matches and semantic description similarity are different claims
about the data, and conflating them into one score would make both harder
to trust and calibrate correctly.

## Multi-region design (documented, not deployed)

The cluster this project actually runs on is CockroachDB **Serverless/Basic**
tier, single-region (`us-east-1`) — confirmed via `ccloud cluster info`.
Basic tier has no node/topology control (it auto-scales within one region;
see the `managing-cluster-capacity` skill), so `ADD REGION` and
`SURVIVE REGION FAILURE` are unavailable without upgrading to a **Standard**
or **Advanced** cluster, which is provisioned and billed continuously. That
upgrade wasn't made for this hackathon build — real recurring cost and
migration risk to a working deployment days before the deadline aren't worth
it just to demo a settings change. The design below is the real production
path, sized to this schema, not a generic multi-region tutorial.

**Why `organizations` is the right partition key.** Every claims-related
table (`claims`, `policies`, `documents`, `claim_embeddings`, `decisions`,
`reviews`, `payouts`) traces back to `org_id`. Each insurance carrier using
Verity operates out of one home region in practice — this is naturally
tenant-partitioned data, not data that needs a single row edited
simultaneously from two continents. That rules out `GLOBAL` tables (built for
reference data read everywhere, not tenant-owned operational state) and makes
manual geo-partitioning more operational overhead than the workload justifies.
`REGIONAL BY ROW` is the fit: CockroachDB keeps each carrier's data — and its
leaseholder — local to that carrier's region automatically.

**The migration, concretely:**

```sql
ALTER DATABASE verity PRIMARY REGION 'us-east-1';
ALTER DATABASE verity ADD REGION 'eu-west-1';
ALTER DATABASE verity ADD REGION 'ap-southeast-1';
ALTER DATABASE verity SURVIVE REGION FAILURE;

ALTER TABLE organizations ADD COLUMN home_region crdb_internal_region
    NOT NULL DEFAULT gateway_region()::crdb_internal_region;
```

`claims`, `policies`, `documents`, `claim_embeddings`, `decisions`, and
`reviews` each get a `region` column stamped from their owning org's
`home_region` at insert time (application-level, in `claims_engine.py`) and
become `LOCALITY REGIONAL BY ROW AS region`. Denormalizing the region onto
every table in a claim's chain — not just `claims` itself — matters here
specifically because `_gather_context()` (`claims_engine.py`) reads across
`claims`, `policies`, `claim_events`, and `claim_embeddings` in one pass
before the model call; if those leaseholders weren't co-located, the read
that grounds every decision would pay cross-region latency (50-150ms+ per
the `designing-multi-region-applications` skill) on the one path where speed
matters most.

**What this actually buys, honestly.** `REGIONAL BY ROW` does not make every
write fast from every region — a US carrier's claims are still homed in
`us-east-1`. What it buys is two things: each carrier gets local latency in
its own region (a EU carrier's claims would be just as fast in `eu-west-1`
as this demo is in `us-east-1` today), and `SURVIVE REGION FAILURE` means an
entire AWS region going dark loses zero committed claims data for anyone —
which is the actual guarantee this hackathon's "always-on, no data loss"
framing is about, not a marketing claim.

**The AWS half of this.** The Lambda functions would deploy per-region (one
SAM stack per region, matching the CockroachDB regions above) so each
region's API and worker talk to their local leaseholder instead of hopping
across the network for every query — Route 53 latency-based routing in front
of regional API Gateway endpoints gets a request to its nearest Lambda, which
gets a query to its nearest leaseholder, end to end.
