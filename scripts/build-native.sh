#!/usr/bin/env bash
set -euo pipefail

platform="${1:?Expected ios or android}"
case "$platform" in ios|android) ;; *) echo 'Expected ios or android' >&2; exit 1 ;; esac
script_dir="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "dist/$platform"

case "$platform" in
  ios)
    workspaces=(ios/*.xcworkspace)
    [[ ${#workspaces[@]} == 1 && -d "${workspaces[0]}" ]] || { echo 'Expected one iOS workspace'; exit 1; }
    workspace="${workspaces[0]}"
    scheme="$(basename "$workspace" .xcworkspace)"
    archive="$PWD/dist/ios/Snake.xcarchive"
    xcodebuild -workspace "$workspace" -scheme "$scheme" \
      -archivePath "$archive" -configuration Release -sdk iphoneos \
      -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO \
      CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY= \
      archive 2>&1 | tee dist/ios/build.log
    ditto -c -k --keepParent "$archive" dist/ios/unsigned.zip
    ;;
  android)
    gradle -p android --init-script "$script_dir/unsigned-android.gradle" \
      :app:assembleRelease :app:bundleRelease -PreactNativeArchitectures=arm64-v8a \
      --no-daemon --max-workers=2 2>&1 | tee dist/android/build.log
    cp android/app/build/outputs/apk/release/app-release-unsigned.apk dist/android/Snake.apk
    cp android/app/build/outputs/bundle/release/app-release.aab dist/android/Snake.aab
    ;;
esac
