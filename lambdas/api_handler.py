"""AWS Lambda entry point for the Verity API, fronted by API Gateway (HTTP API).

Deploy: zip src/verity + this file's directory (with dependencies) and set
the Lambda handler to `api_handler.handler`. See README.md for the full
`sam build && sam deploy` / manual zip-upload steps.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from mangum import Mangum

from verity.api import app

handler = Mangum(app)
