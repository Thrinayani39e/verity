\demo ls

CREATE DATABASE verity_regional;
ALTER DATABASE verity_regional PRIMARY REGION "us-west";
ALTER DATABASE verity_regional ADD REGION "us-east";
ALTER DATABASE verity_regional ADD REGION "eu-west";
ALTER DATABASE verity_regional SURVIVE REGION FAILURE;

USE verity_regional;

CREATE TABLE claims_demo (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claimant_name STRING NOT NULL,
    description STRING NOT NULL,
    amount_cents INT8 NOT NULL,
    crdb_region crdb_internal_region NOT NULL DEFAULT gateway_region()::crdb_internal_region
) LOCALITY REGIONAL BY ROW AS crdb_region;

INSERT INTO claims_demo (claimant_name, description, amount_cents, crdb_region) VALUES
  ('East Claimant A', 'Claim homed in us-east', 100000, 'us-east'),
  ('West Claimant A', 'Claim homed in us-west - the PRIMARY region, about to be killed', 200000, 'us-west'),
  ('West Claimant B', 'Second claim homed in us-west', 250000, 'us-west'),
  ('EU Claimant A', 'Claim homed in eu-west', 300000, 'eu-west');

SELECT '=== BEFORE: all regions healthy ===' AS marker;
SELECT crdb_region, claimant_name, amount_cents FROM claims_demo ORDER BY crdb_region, claimant_name;

SELECT '=== Killing all 3 nodes in us-west (the PRIMARY region) ===' AS marker;
\demo shutdown 4
\demo shutdown 5
\demo shutdown 6

SELECT '=== AFTER: reading data homed in the now-dead primary region ===' AS marker;
SELECT crdb_region, claimant_name, amount_cents FROM claims_demo WHERE crdb_region = 'us-west';

SELECT '=== AFTER: writing NEW data homed in the now-dead primary region ===' AS marker;
INSERT INTO claims_demo (claimant_name, description, amount_cents, crdb_region) VALUES
  ('West Claimant C', 'Written AFTER us-west nodes were killed - proves writes to the dead region still commit', 400000, 'us-west');

SELECT '=== Full table, zero data loss, zero rows missing ===' AS marker;
SELECT crdb_region, claimant_name, amount_cents FROM claims_demo ORDER BY crdb_region, claimant_name;

\q
