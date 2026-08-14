# Regional survivability drill

Validates, for real, that the `REGIONAL BY ROW` + `SURVIVE REGION FAILURE`
design documented in [ARCHITECTURE.md](../../ARCHITECTURE.md#multi-region-design)
actually behaves as claimed: kill every node in a region and prove that
region's data stays readable and writable from surviving replicas elsewhere.

This runs against a free, local, ephemeral `cockroach demo` cluster - not the
production CockroachDB Cloud deployment, which stays single-region Serverless
(see [ARCHITECTURE.md](../../ARCHITECTURE.md) for why: real multi-region
requires an upgrade off the free tier, which wasn't made for this hackathon
build). `cockroach demo` is the same mechanism used for this kind of drill
industry-wide - managed Cloud doesn't expose per-node kill at any tier, so
this is genuinely the only way to demonstrate node/region failure locally.

## Running it

Requires the `cockroach` binary ([cockroachlabs.com/docs/stable/install-cockroachdb](https://www.cockroachlabs.com/docs/stable/install-cockroachdb.html)).

```bash
cockroach demo --no-example-database --nodes=9 \
  --demo-locality="region=us-east,az=1:region=us-east,az=2:region=us-east,az=3:region=us-west,az=1:region=us-west,az=2:region=us-west,az=3:region=eu-west,az=1:region=eu-west,az=2:region=eu-west,az=3" \
  --insecure < regional_survivability_drill.sql
```

Nodes 1-3 are `us-east`, 4-6 are `us-west`, 7-9 are `eu-west`. The script sets
`us-west` as the `PRIMARY REGION` and kills nodes 4-6 - deliberately not the
node the SQL client is connected to (node 1, `us-east`), so the drill's own
tooling can't be what fails; the actual claim under test is whether
`us-west`'s data survives losing every node that hosts it.

## What it proves, and what it doesn't

Proves: the schema pattern in `ARCHITECTURE.md` genuinely provides the
guarantee it's designed for - reads and even *new writes* to a region's data
keep working after every node hosting that region is killed, with zero
manual failover. `drill_output_2026-08-14.txt` is the real, unedited terminal
output from one such run.

Doesn't prove: that the production deployment survives a real regional
outage - it doesn't have this topology, on purpose (see the cost/risk
tradeoff in ARCHITECTURE.md). This is validation of the design, not a claim
about the live system.
