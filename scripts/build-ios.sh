#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

ARTIFACT_DIR="$PWD/dist/ios"
mkdir -p "$ARTIFACT_DIR"

WORKSPACES=(ios/*.xcworkspace)
[[ ${#WORKSPACES[@]} == 1 && -d "${WORKSPACES[0]}" ]] || { echo 'Expected one iOS workspace'; exit 1; }
WORKSPACE_PATH="${WORKSPACES[0]}"
BUILD_SCHEME="$(basename "$WORKSPACE_PATH" .xcworkspace)"

xcodebuild -workspace "$WORKSPACE_PATH" \
  -scheme "$BUILD_SCHEME" \
  -archivePath "$ARTIFACT_DIR/Snake.xcarchive" \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY= \
  archive 2>&1 | tee "$ARTIFACT_DIR/build.log"

ditto -c -k --keepParent "$ARTIFACT_DIR/Snake.xcarchive" "$ARTIFACT_DIR/unsigned.zip"
