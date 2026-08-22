# Releasing

Store releases build on [EAS](https://expo.dev/eas) and go to TestFlight / Google Play internal testing via GitHub Actions.

## Flow

- **Release (manual only):** Actions → **Build Mobile Store Releases** → Run workflow → pick the ref (the `mobile` branch or a `mobile-v*` tag) and the profile/platforms. It builds on EAS and, when **publish** is left on, submits those exact builds to TestFlight / Play internal testing after the build finishes. Untick **publish** for a build-only run. Preview builds are never submitted (internal-distribution artifacts aren't store-accepted).
- **Tags:** the repo's tag namespace is shared with the desktop app — plain `v*` tags belong to `main`; mobile releases use `mobile-v<version>` (`git tag mobile-v1.0.0 && git push origin mobile-v1.0.0`). Nothing triggers on tags push.
- **(Re)submit an existing build:** Actions → **Publish Mobile Store Releases** → same ref rules — pass explicit EAS build IDs, or it takes the latest finished build for the profile.
- The copies of the two workflows on `main` only exist because GitHub reads the default branch for the Run-workflow button; a guard aborts runs on refs without the mobile release files.
- Store version comes from package.json (via app.config.js); build numbers are EAS-managed (`autoIncrement`).

## Secrets

| Secret                             | Value                                                                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `EXPO_TOKEN`                       | expo.dev → Account settings → Access tokens                                                                      |
| `EAS_PROJECT_ID`                   | expo.dev → project → Project ID (UUID)                                                                           |
| `APPLE_ID`                         | Apple developer account email                                                                                    |
| `APPLE_TEAM_ID`                    | developer.apple.com → Membership → Team ID (10 chars)                                                            |
| `APPLE_ASC_APP_ID`                 | App Store Connect → app → App Information → Apple ID (numeric)                                                   |
| `EXPO_APPLE_APP_SPECIFIC_PASSWORD` | account.apple.com → Sign-In and Security → App-Specific Passwords                                                |
| `GOOGLE_SERVICE_ACCOUNT_JSON`      | full JSON key of a GCP (google cloud console) service account invited in Play Console (with release permissions) |

## Variables (optional)

CI injects these into app.json before building. Used to override the committed identifiers without touching the repo (e.g. building under a different account):

| Variable          | Value                                           |
| ----------------- | ----------------------------------------------- |
| `IOS_BUNDLE_ID`   | iOS bundle identifier registered with Apple     |
| `ANDROID_PACKAGE` | Android application ID used in the Play Console |

## One-time setup

- Bundle identifiers must be real — production builds refuse `com.anonymous.*`. Either commit them in app.json or set the variables above.
- Once the app exists in App Store Connect, set `expo.extra.iosAppStoreId` in app.json to its numeric Apple ID (App Store Connect → app → App Information → Apple ID — the same number as the `APPLE_ASC_APP_ID` secret). The update banner opens that listing when an OTA payload requires a newer native build than the one installed (`pear.json` `updates.minver`); while it is empty, iOS shows the banner text with no button. Android needs nothing — its Play Store link is built from `expo.android.package`, including the CI `ANDROID_PACKAGE` override.
- locally: `npx eas-cli login` -> `npx eas-cli project:init —id <EAS_PROJECT_ID>`
- iOS signing: run `npx eas-cli credentials --platform ios` locally (logged into the Expo account, real bundle ID in app.json) so EAS stores the distribution cert + provisioning profile. The Android keystore is auto-generated on the first build.
- The service account's GCP (google cloud console) project needs the **Google Play Android Developer API** enabled.
- add service account's GCP email to users and permissions in google play console home -> give it release permission
