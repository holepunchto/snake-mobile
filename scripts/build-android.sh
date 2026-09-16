#!/usr/bin/env bash
set -euo pipefail

signing_dir="$(mktemp -d "$RUNNER_TEMP/android-signing.XXXXXX")"
trap 'rm -rf "$signing_dir"' EXIT
export ANDROID_KEYSTORE_PATH="$signing_dir/upload.keystore"

printf '%s' "$ANDROID_KEYSTORE_BASE64" | base64 --decode > "$ANDROID_KEYSTORE_PATH"
chmod 600 "$ANDROID_KEYSTORE_PATH"
printf '\napply from: rootProject.file("../scripts/android-signing.gradle")\n' >> android/app/build.gradle

tasks=(:app:assembleRelease)
if [ "$BUILD_PROFILE" = production ]; then
  tasks+=(:app:bundleRelease)
fi

mkdir -p dist/android
(
  cd android
  ./gradlew "${tasks[@]}" -PreactNativeArchitectures=arm64-v8a --no-daemon --max-workers=2
) 2>&1 | tee dist/android/build.log

cp android/app/build/outputs/apk/release/app-release.apk dist/android/Snake.apk
if [ "$BUILD_PROFILE" = production ]; then
  cp android/app/build/outputs/bundle/release/app-release.aab dist/android/Snake.aab
fi
