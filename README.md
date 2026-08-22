# Snake (mobile)

> P2P multiplayer snake for iOS and Android — the mobile equivalent of [snake](../snake) (desktop), built on [pear-mobile](https://github.com/holepunchto/pear-mobile) with the [hello-pear-react-native](https://github.com/holepunchto/hello-pear-react-native) boilerplate.

Same game, same wire protocol, same board as the desktop build — a mobile peer and a desktop peer can play together on the same topic. Only the shell changes: an Expo / React Native app instead of Electron, touch controls instead of a keyboard, and [pear-mobile](https://github.com/holepunchto/pear-mobile) instead of [pear-runtime](https://github.com/holepunchto/pear-runtime).

## Architecture

The app runs as a standard Expo / React Native application. Peer-to-peer networking via [Hyperswarm](https://github.com/holepunchto/hyperswarm) runs inside an embedded [Bare](https://github.com/holepunchto/bare) worklet spawned by `pear-mobile` — keeping Node/Bare APIs out of the React Native JS thread. The view communicates with the worker over a framed JSON IPC stream.

```
React Native view (src/)
  └─ pear-mobile PearRuntime.run('/worker.bundle', …)
       └─ framed-stream IPC
            └─ bare worklet (workers/main.js)  ←→  Hyperswarm (P2P)
```

The game itself — snake movement, wrapping, collisions, food placement — lives entirely in the view layer (`src/game/engine.ts`), a port of the desktop renderer's logic with the browser bits (canvas, keydown, custom element) removed. The worker is only P2P transport plus OTA updates. The worker is kept **in-app** (`workers/main.js`) rather than sharing the `hello-pear-worker` package.

**IPC protocol** (identical to the desktop build)

| Direction     | Message                           | Meaning                                     |
| ------------- | --------------------------------- | ------------------------------------------- |
| view → worker | `{ type: 'join', topic }`         | Join or create a game (null topic = create) |
| view → worker | `{ type: 'send', data }`          | Broadcast game state to peers               |
| view → worker | `{ type: 'applyUpdate' }`         | Apply a downloaded OTA update               |
| worker → view | `{ type: 'ready', id, topic }`    | Swarm flushed, game can start               |
| worker → view | `{ type: 'connected', id }`       | Peer joined                                 |
| worker → view | `{ type: 'disconnected', id }`    | Peer dropped                                |
| worker → view | `{ type: 'data', id, payload }`   | Game state from a peer                      |
| worker → view | `{ type: 'update', connections }` | Peer count changed                          |
| worker → view | `{ type: 'updating' }`            | An OTA update is downloading                |
| worker → view | `{ type: 'updated' }`             | An OTA update is ready to apply             |
| worker → view | `{ type: 'updateApplied' }`       | Reply after an update was applied           |

## Controls

- **Swipe** anywhere on the board to steer, or use the on-screen **D-pad**. Both map to the desktop arrow keys — you cannot reverse directly onto your current axis.
- **Create** starts a new game and shows a topic to share. **Join** connects to a topic someone shared with you.

## Requirements

- `npm`
- `node --version` >= 20.19.4
- **iOS Simulator:** `xcodebuild -version` >= 26.2, iOS >= 15.1
- **Android Simulator:** Android >= 10 (react-native-bare-kit)

See [Expo SDK 55](https://docs.expo.dev/versions/latest) for the full support matrix.

## Development

```sh
npm install
```

Bundle the Bare worker into a worklet (required before the first run and after any change to `workers/main.js`):

```sh
npm run bundle:bare
```

Run on a simulator/device:

```sh
npm run ios
# or
npm run android
```

Use `npm start` to (re)start just the Metro bundler without rebuilding. The iOS app is pinned to Metro **port 8099** (via the `./plugins/with-metro-port` config plugin) so it never collides with another React Native project on the default 8081 — `npm run ios` and `npm start` both serve on 8099 to match, so start Metro with those rather than a bare `expo start`. A dev build loads its JS from Metro; a release build (`npm run production:ios`) embeds the bundle and ignores Metro.

In development (`npm run ios` / `npm run android`) the app passes `__DEV__` to the worker so OTA updates are disabled, mirroring the desktop `--no-updates` default.

## OTA updates & deploy

OTA behaves exactly as in [hello-pear-react-native](../hello-pear-react-native) — the worker replicates the seeded application drive behind the `upgrade` link, emits `updating` / `updated`, and applies the new bundle on request. Full flow:

```sh
npm run update   # bundle:bare + bundle:react-native + build → dist/
```

Then stage, seed, provision and (for production) multisign the `dist/` folder against the `upgrade` link in `package.json`. See the [hello-pear-react-native README](../hello-pear-react-native/README.md) for the complete staging, provisioning and multisig ceremony, and [OTA.md](../hello-pear-react-native/OTA.md) for the from-scratch OTA wiring.

Before a production build, set `package.json` `upgrade` to a real `pear://` link (`pear touch`) and bump `version`.

## License

Apache-2.0
