/* global __DEV__ */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import {
  Dimensions,
  Platform,
  SafeAreaView,
  StatusBar as NativeStatusBar,
  StyleSheet,
  Text,
  View
} from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { reloadAppAsync, requireOptionalNativeModule } from 'expo-modules-core'
import * as SplashScreen from 'expo-splash-screen'
import PearRuntime from 'pear-mobile'
import type { Worklet } from 'react-native-bare-kit'
import FramedStream from 'framed-stream'
import b4a from 'b4a'

import bundle from './worker.bundle.js'
import { version, upgrade, name, productName } from '../package.json'
import { SnakeGame } from './game/engine'
import { TILES, Direction } from './game/constants'
import { SetupScreen } from './screens/SetupScreen'
import { GameScreen, AnnouncementStatus } from './screens/GameScreen'
import { UpdateBanner, UpdateStatus } from './components/UpdateBanner'
import { AnimatedSplash } from './components/AnimatedSplash'
import { theme } from './theme'
import { restartAfterUpdate } from './restart'

const appName = productName ?? name
const nativeUpdates = requireOptionalNativeModule<{ canReload: boolean }>('SnakeUpdates')
const canReloadUpdate =
  typeof globalThis.expo?.reloadAppAsync === 'function' &&
  (Platform.OS === 'ios' || (Platform.OS === 'android' && nativeUpdates?.canReload === true))

// Hold the native splash until the AnimatedSplash overlay has painted its
// first frame — otherwise there is a flash of bare root view in between.
SplashScreen.preventAutoHideAsync().catch(() => {})

// Board edge rounded down to a whole number of tiles so every cell is crisp.
const win = Dimensions.get('window')
const maxBoard = Math.min(win.width - 24, win.height * 0.55, 420)
const BOARD_SIZE = Math.max(TILES, Math.floor(maxBoard / TILES) * TILES)

type ScreenName = 'setup' | 'loading' | 'game'

export default function App() {
  const [screen, setScreen] = useState<ScreenName>('setup')
  const [joinCode, setJoinCode] = useState<{ topic: string; status: AnnouncementStatus }>({
    topic: '',
    status: 'announcing'
  })
  const [peers, setPeers] = useState(0)
  const [over, setOver] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('')
  const [minver, setMinver] = useState('')
  const [error, setError] = useState('')
  const [splashDone, setSplashDone] = useState(false)
  const [renderCount, forceRender] = useReducer((n: number) => n + 1, 0)

  const pipeRef = useRef<FramedStream | null>(null)
  const shouldReload = useRef(false)
  const cancelRestart = useRef<(() => void) | null>(null)

  // The worker sends JSON messages; App writes JSON commands back.
  function sendToWorker(msg: unknown) {
    pipeRef.current?.write(JSON.stringify(msg))
  }

  // One engine for the app's lifetime — reset on leave rather than recreated,
  // so the message handler's closure always targets the live instance.
  const gameRef = useRef<SnakeGame | null>(null)
  if (gameRef.current === null) {
    gameRef.current = new SnakeGame({
      onChange: forceRender,
      send: (data) => sendToWorker({ type: 'send', data }),
      onOver: () => setOver(true)
    })
  }
  const game = gameRef.current

  useEffect(() => {
    const IPC = PearRuntime.run('/worker.bundle', bundle, [
      (!__DEV__).toString(),
      version,
      upgrade,
      appName
    ]) as Worklet['IPC']
    const pipe = new FramedStream(IPC)
    pipeRef.current = pipe

    pipe.on('data', (data) => {
      let msg: any = null
      try {
        msg = JSON.parse(b4a.toString(data))
      } catch {
        return
      }
      handleMessage(msg)
    })
    pipe.on('error', (err) => console.error(err))

    return () => {
      cancelRestart.current?.()
      game.destroy()
      pipe.destroy()
      IPC.worklet.terminate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleMessage(msg: any) {
    switch (msg.type) {
      case 'updating':
        setUpdateStatus('updating')
        break
      case 'updated':
        setUpdateStatus('updated')
        break
      case 'updateApplied':
        if (shouldReload.current) {
          shouldReload.current = false
          setUpdateStatus('restarting')
          cancelRestart.current?.()
          cancelRestart.current = restartAfterUpdate(
            canReloadUpdate ? () => reloadAppAsync('Pear update applied') : null,
            () => setUpdateStatus('restart-required')
          )
        }
        break
      case 'minverRequired':
        setMinver(msg.minver)
        break
      case 'updateFailed':
        shouldReload.current = false
        setError(msg.error || '')
        setUpdateStatus('failed')
        break
      case 'ready':
        setJoinCode({ topic: msg.topic, status: 'announcing' })
        game.start(msg.id, b4a.from(msg.topic, 'hex'))
        setOver(false)
        setScreen('game')
        break
      case 'flushed':
        setJoinCode((current) =>
          msg.topic === current.topic ? { ...current, status: 'online' } : current
        )
        break
      case 'connected':
        game.addPeer(msg.id)
        forceRender()
        break
      case 'disconnected':
        game.removePeer(msg.id)
        forceRender()
        break
      case 'data': {
        let state: any = null
        try {
          state = JSON.parse(msg.payload)
        } catch {
          return
        }
        game.applyPeerState(state)
        forceRender()
        break
      }
      case 'update':
        setPeers(msg.connections)
        break
    }
  }

  function createGame() {
    setJoinCode({ topic: '', status: 'announcing' })
    setScreen('loading')
    sendToWorker({ type: 'join', topic: null })
  }

  function joinGame(topicHex: string) {
    setJoinCode({ topic: '', status: 'announcing' })
    setScreen('loading')
    sendToWorker({ type: 'join', topic: topicHex })
  }

  function leaveGame() {
    // Tell the worker to actually leave the swarm topic, not just drop the local
    // board — otherwise the old game's peers stay connected and keep streaming.
    sendToWorker({ type: 'leave' })
    game.leave()
    setOver(false)
    setPeers(0)
    setJoinCode({ topic: '', status: 'announcing' })
    setScreen('setup')
  }

  function applyUpdate() {
    if (shouldReload.current) return
    shouldReload.current = true
    setError('')
    setUpdateStatus('applying')
    sendToWorker({ type: 'applyUpdate' })
  }

  // Stable across ticks so the memoized DPad does not remount its buttons.
  const handleDirection = useCallback((dir: Direction) => {
    gameRef.current?.setDirection(dir)
  }, [])

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style='light' />
      <UpdateBanner status={updateStatus} minver={minver} error={error} onApply={applyUpdate} />

      {screen === 'setup' && <SetupScreen onCreate={createGame} onJoin={joinGame} />}

      {screen === 'loading' && (
        <View style={styles.centered}>
          <Text style={styles.loading}>Loading ...</Text>
        </View>
      )}

      {screen === 'game' && (
        <GameScreen
          game={game}
          size={BOARD_SIZE}
          topic={joinCode.topic}
          announcement={joinCode.status}
          peers={peers}
          over={over}
          version={renderCount}
          onDirection={handleDirection}
          onLeave={leaveGame}
          onPlayAgain={() => {
            setOver(false)
            game.reset()
          }}
        />
      )}

      {!splashDone && <AnimatedSplash onDone={() => setSplashDone(true)} />}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
    // RN's SafeAreaView only insets on iOS; on Android pad below the status bar
    paddingTop: Platform.OS === 'android' ? (NativeStatusBar.currentHeight ?? 0) : 0
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  loading: {
    color: theme.accent,
    fontFamily: theme.mono,
    fontSize: 18
  }
})
