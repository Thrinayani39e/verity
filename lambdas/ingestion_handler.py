"""AWS Lambda triggered by S3 ObjectCreated events under `claims/<claim_id>/...`.

Configure an S3 event notification (prefix `claims/`) targeting this
function. The object key convention is `claims/<claim_id>/<filename>` so the
handler can recover which claim a newly uploaded document belongs to.
"""

import os
import sys
import urllib.parse

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from verity.ingestion import ingest_document


def handler(event, context):
    results = []
    for record in event.get("Records", []):
        bucket = record["s3"]["bucket"]["name"]
        key = urllib.parse.unquote_plus(record["s3"]["object"]["key"])

        parts = key.split("/")
        if len(parts) < 2 or parts[0] != "claims":
            results.append({"key": key, "skipped": "does not match claims/<claim_id>/... convention"})
            continue

        claim_id = parts[1]
        document_id = ingest_document(claim_id=claim_id, bucket=bucket, key=key)
        results.append({"key": key, "claim_id": claim_id, "document_id": document_id})

    return {"processed": results}
