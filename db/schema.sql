-- Verity schema — agentic memory layer for concurrent claims/underwriting agents.
--
-- Design notes:
--   * claim_events is an append-only log and is the source of truth for
--     "what did the agent's memory look like at time T" reconstructions via
--     AS OF SYSTEM TIME (see src/verity/audit.py). Never UPDATE or DELETE rows here.
--   * claims.status transitions are driven through serializable transactions
--     (see src/verity/claims_engine.py::claim_next_pending) so that concurrent
--     workers can never claim the same case twice.
--   * claim_embeddings holds the distributed vector index used for
--     fraud-pattern / precedent similarity search.
--   * decisions snapshots the exact context (relational + vector) an agent
--     used, plus the read timestamp, so any decision can be replayed later
--     with AS OF SYSTEM TIME for compliance audits.
--
-- Vector indexing is a newer CockroachDB feature and may be gated behind a
-- cluster setting depending on your cluster's version. Run this first (it
-- requires admin privilege; on some Serverless clusters it may already be
-- enabled by default, in which case this is a harmless no-op):
--   SET CLUSTER SETTING feature.vector_index.enabled = true;

CREATE TABLE IF NOT EXISTS organizations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        STRING NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agents (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES organizations(id),
    name        STRING NOT NULL,
    kind        STRING NOT NULL DEFAULT 'claims_worker',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS claims (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES organizations(id),
    claimant_name STRING NOT NULL,
    policy_number STRING NOT NULL,
    description   STRING NOT NULL,
    amount_cents  INT8 NOT NULL,
    -- Optional identifying attributes. Never used by the agent's own decision
    -- (that would be a real bias risk) - they exist solely so fraud_ring.py
    -- can find claims that share one across otherwise-unrelated claimants,
    -- the pattern a single-claim-at-a-time view structurally cannot see.
    bank_account_last4 STRING,
    claimant_address    STRING,
    status        STRING NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','claimed','approved','denied','flagged')),
    claimed_by    UUID REFERENCES agents(id),
    claimed_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    INDEX idx_claims_status_created (status, created_at)
);

-- Idempotent against an already-existing cluster (CREATE TABLE IF NOT EXISTS
-- above is a no-op there, so these ADD COLUMNs are what actually apply):
ALTER TABLE claims ADD COLUMN IF NOT EXISTS bank_account_last4 STRING;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS claimant_address STRING;

-- Append-only audit log. Source of truth for time-travel reconstruction.
CREATE TABLE IF NOT EXISTS claim_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id    UUID NOT NULL REFERENCES claims(id),
    agent_id    UUID REFERENCES agents(id),
    event_type  STRING NOT NULL, -- submitted | claimed | context_gathered | decided | flagged
    payload     JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    INDEX idx_claim_events_claim (claim_id, created_at)
);

-- Documents attached to a claim (raw files live in S3; this is the pointer + parsed text).
CREATE TABLE IF NOT EXISTS documents (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id    UUID NOT NULL REFERENCES claims(id),
    s3_bucket   STRING NOT NULL,
    s3_key      STRING NOT NULL,
    doc_type    STRING NOT NULL DEFAULT 'attachment',
    extracted_text STRING,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Distributed vector memory: embeddings of claim descriptions / document chunks
-- used for fraud-pattern and precedent similarity search.
CREATE TABLE IF NOT EXISTS claim_embeddings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id    UUID NOT NULL REFERENCES claims(id),
    document_id UUID REFERENCES documents(id),
    chunk_text  STRING NOT NULL,
    embedding   VECTOR(1024) NOT NULL, -- amazon.titan-embed-text-v2:0, 1024 dims
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CockroachDB distributed vector index (C-SPANN), added in v25.2+. Titan
-- embeddings are requested with normalize=true (see bedrock_client.py), so
-- cosine and L2 orderings are equivalent here; vector_cosine_ops is used so
-- the index accelerates the exact operator find_similar_claims queries with
-- (`<=>`). If CREATE VECTOR INDEX is unavailable on your cluster's version,
-- the VECTOR column and `<=>` operator still work as a full-scan fallback —
-- just drop this one statement.
CREATE VECTOR INDEX idx_claim_embeddings_vec
    ON claim_embeddings (embedding vector_cosine_ops);

-- Every agent decision, snapshotted with the exact read timestamp used to
-- gather its context. This is what makes a decision replayable:
--   SELECT ... AS OF SYSTEM TIME decisions.context_query_time
CREATE TABLE IF NOT EXISTS decisions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id            UUID NOT NULL REFERENCES claims(id),
    agent_id            UUID NOT NULL REFERENCES agents(id),
    decision            STRING NOT NULL CHECK (decision IN ('approve','deny','flag')),
    rationale           STRING NOT NULL,
    context_snapshot    JSONB NOT NULL, -- similar claims, retrieved docs, claimant history used
    context_query_time  TIMESTAMPTZ NOT NULL, -- human-readable wall time context was read
    context_hlc_time    STRING NOT NULL, -- cluster_logical_timestamp() decimal; use in
                                          -- `AS OF SYSTEM TIME '<value>'` to replay the exact
                                          -- read the agent used (see src/verity/audit.py)
    model_id            STRING NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    INDEX idx_decisions_claim (claim_id)
);

-- Demo helper view: claims that were claimed by more than one agent would
-- indicate a concurrency bug. Should always return zero rows.
CREATE VIEW IF NOT EXISTS double_claims_check AS
    SELECT claim_id, count(DISTINCT agent_id) AS distinct_claimants
    FROM claim_events
    WHERE event_type = 'claimed'
    GROUP BY claim_id
    HAVING count(DISTINCT agent_id) > 1;

-- Insurance policies. Joined to claims by policy_number (not a foreign key on
-- claims - a claim can reference a policy_number before/without a formal
-- policy record existing, matching how intake often works in practice) so
-- the agent can reason about real coverage limits, deductibles, and expiry
-- when one exists. See claims_engine.py::_gather_context.
CREATE TABLE IF NOT EXISTS policies (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID NOT NULL REFERENCES organizations(id),
    policy_number       STRING NOT NULL UNIQUE,
    policyholder_name   STRING NOT NULL,
    coverage_type       STRING NOT NULL DEFAULT 'auto'
                        CHECK (coverage_type IN ('auto','home','health','life','property')),
    coverage_limit_cents INT8 NOT NULL,
    deductible_cents    INT8 NOT NULL DEFAULT 0,
    effective_date      DATE NOT NULL,
    expiration_date     DATE NOT NULL,
    status              STRING NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','expired','cancelled')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Payouts. claim_id is UNIQUE, so CockroachDB itself guarantees a claim can
-- never be paid out twice, no matter how many times process_claim or a
-- retried transaction runs - the exact same "no duplicates" guarantee the
-- concurrency story makes for claim ownership, now extended to money
-- actually moving. See claims_engine.py::_create_payout.
CREATE TABLE IF NOT EXISTS payouts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id      UUID NOT NULL UNIQUE REFERENCES claims(id),
    decision_id   UUID NOT NULL REFERENCES decisions(id),
    amount_cents  INT8 NOT NULL,
    status        STRING NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','sent','failed')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Human review of a flagged decision - the NAIC/EU-AI-Act-aligned
-- human-in-the-loop step for cases the agent didn't resolve on its own.
CREATE TABLE IF NOT EXISTS reviews (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id       UUID NOT NULL REFERENCES claims(id),
    decision_id    UUID NOT NULL REFERENCES decisions(id),
    reviewer_name  STRING NOT NULL,
    outcome        STRING NOT NULL CHECK (outcome IN ('approve','deny')),
    notes          STRING NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Demo helper view: a claim ever paid out more than once would indicate a
-- serious correctness bug. Should always return zero rows (in fact this
-- table structurally cannot - claim_id is UNIQUE - but this view exists so
-- the UI can show the same kind of explicit proof it shows for claims).
CREATE VIEW IF NOT EXISTS double_payouts_check AS
    SELECT claim_id, count(*) AS payout_count
    FROM payouts
    GROUP BY claim_id
    HAVING count(*) > 1;
