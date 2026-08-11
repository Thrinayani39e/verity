#!/usr/bin/env bash
# One-time post-deploy step: wires the documents bucket's ObjectCreated
# events to the ingestion Lambda.
#
# Why this isn't in the SAM template: a bucket and a same-template Lambda
# function it triggers form an unavoidable circular dependency in
# CloudFormation (the bucket's NotificationConfiguration needs the
# function's invoke permission, which needs the function, which - if
# anything in its own definition references the bucket - needs the bucket).
# The template grants the S3 invoke permission declaratively
# (IngestionFunctionS3Permission, via a computed ARN so it doesn't
# introduce that cycle); this script does the one remaining piece -
# telling the bucket to actually call the function - outside
# CloudFormation's dependency graph entirely.
#
# Safe to re-run: put-bucket-notification-configuration is a full replace,
# not additive, so re-running with the same inputs is idempotent.
#
# Usage: bash ops/aws/configure_s3_notification.sh <stack-name>
set -euo pipefail

STACK_NAME="${1:?Usage: configure_s3_notification.sh <stack-name>}"

BUCKET_NAME=$(aws cloudformation describe-stacks --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='DocumentsBucketName'].OutputValue" --output text)
FUNCTION_ARN=$(aws cloudformation describe-stacks --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='IngestionFunctionArn'].OutputValue" --output text)

echo "==> Wiring S3 notifications: bucket=${BUCKET_NAME} -> function=${FUNCTION_ARN}"

aws s3api put-bucket-notification-configuration \
    --bucket "${BUCKET_NAME}" \
    --notification-configuration "{
        \"LambdaFunctionConfigurations\": [
            {
                \"LambdaFunctionArn\": \"${FUNCTION_ARN}\",
                \"Events\": [\"s3:ObjectCreated:*\"],
                \"Filter\": {
                    \"Key\": {
                        \"FilterRules\": [
                            {\"Name\": \"prefix\", \"Value\": \"claims/\"}
                        ]
                    }
                }
            }
        ]
    }"

echo "Done. Uploads under s3://${BUCKET_NAME}/claims/<claim_id>/... now trigger ingestion."
