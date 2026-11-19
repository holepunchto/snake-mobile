#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

mkdir -p dist/android
(
  cd android
  gradle --init-script ../scripts/unsigned-android.gradle \
    :app:assembleRelease :app:bundleRelease -PreactNativeArchitectures=arm64-v8a \
    --no-daemon --max-workers=2
) 2>&1 | tee dist/android/build.log

cp android/app/build/outputs/apk/release/app-release-unsigned.apk dist/android/Snake.apk
cp android/app/build/outputs/bundle/release/app-release.aab dist/android/Snake.aab
