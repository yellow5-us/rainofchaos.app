#!/bin/bash
# Deploys rainofchaos. The infrastructure is Terraform in a separate repo.
#   ./deploy.sh job [backfill]   package job/rates.py, update the Lambda, run it once
#                                (backfill: re-read the last 24h, e.g. after adding items)
#   ./deploy.sh site   test the calculation, upload html/ and version.json to the bucket's html/, invalidate CloudFront
set -euo pipefail

# Run by hand, name the AWS profile (AWS_PROFILE=<profile> ./deploy.sh ...); in GitHub Actions the workflow provides
# credentials (OIDC role).
if [ -z "${CI:-}" ] && [ -z "${AWS_PROFILE:-}" ]; then
  echo "Set AWS_PROFILE to the profile to deploy with: AWS_PROFILE=<profile> $0 ${*:-}" >&2
  exit 1
fi
export AWS_REGION=us-east-1

BUCKET=rainofchaos.app
FUNCTION=rainofchaos-rates
DOMAIN=rainofchaos.app

cd "$(dirname "$0")"

# The calculation tests: Node if it's installed (GitHub Actions), else macOS's built-in JavaScriptCore.
calc_tests() {
  if command -v node >/dev/null; then
    node tests/calc.test.js
  else
    /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m tests/calc.test.js
  fi
}

deploy_job() {
  python3 -m unittest discover -s job -q

  local zip
  zip=$(mktemp -d)/rates.zip
  (cd job && zip -q "$zip" rates.py)

  aws lambda update-function-code --function-name "$FUNCTION" --zip-file "fileb://$zip" --query LastModified --output text
  aws lambda wait function-updated --function-name "$FUNCTION"

  local out
  out=$(mktemp)
  local payload='{}'
  [ "${1:-}" = backfill ] && payload='{"backfill": true}'
  # A first PoE2 run catches up a whole day, so wait longer than the CLI's default 60s.
  aws lambda invoke --function-name "$FUNCTION" --cli-binary-format raw-in-base64-out --payload "$payload" --cli-read-timeout 320 \
    --log-type Tail --query LogResult --output text "$out" | base64 -d | grep -v '^\(START\|END\|REPORT\)'
  cat "$out"; echo
}

deploy_site() {
  calc_tests | tail -1 | grep -q "all passed" \
    || { echo "calc tests failed (open tests/index.html)" >&2; exit 1; }

  # The bucket's html/ is the site (CloudFront's origin path); html/ here is all of it but what's excluded below.
  # No build step and no hashed filenames, so every file revalidates (ETag) instead of caching for long.
  # --delete must never touch what the job writes (rates.json, poe2/rates.json), what this writes just after
  # (version.json, the game pages) or the pages uploaded by hand (debug-algorithm/).
  aws s3 sync html/ "s3://$BUCKET/html/" --delete --exclude rates.json --exclude "poe2/rates.json" \
    --exclude version.json --exclude poe1 --exclude poe2 --exclude "debug-algorithm/*" \
    --cache-control "no-cache"
  # The version ?debug's log and Download reads name: the release's (VERSION, from the workflow: 2026-10-11-1), or this
  # commit's for a deploy by hand.
  local commit
  commit=$(git rev-parse --short HEAD)
  printf '{"version": "%s", "commit": "%s"}\n' "${VERSION:-local-$commit}" "$commit" \
    | aws s3 cp - "s3://$BUCKET/html/version.json" --content-type "application/json" --cache-control "no-cache"
  # The same page is each game's address: /poe1 and /poe2 (no extension, so the type is set by hand).
  for game in poe1 poe2; do
    aws s3 cp html/index.html "s3://$BUCKET/html/$game" --content-type "text/html; charset=utf-8" --cache-control "no-cache"
  done

  local dist_id
  dist_id=$(aws cloudfront list-distributions \
    --query "DistributionList.Items[?contains(Aliases.Items, '$DOMAIN')].Id | [0]" --output text)
  aws cloudfront create-invalidation --distribution-id "$dist_id" --paths "/*" --query Invalidation.Id --output text
}

case "${1:-}" in
  job) deploy_job "${2:-}" ;;
  site) deploy_site ;;
  *) echo "Usage: $0 job [backfill] | site" >&2; exit 1 ;;
esac
