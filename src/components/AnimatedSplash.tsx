import { useEffect, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  Animated,
  Dimensions,
  Easing,
  StyleSheet,
  Text,
  View
} from 'react-native'
import * as SplashScreen from 'expo-splash-screen'
import { theme } from '../theme'
import { version } from '../../package.json'
import { SPLASH_RECTS, SPLASH_VIEWBOX } from './splash-rects'

// Boot animation: the snake glyph draws itself in bar by bar from tail to
// head, flicks its tongue, and 'PEAR SNAKE' types out under a blinking block
// cursor, the running version fades in beneath it, and the whole overlay then
// fades into the app.
//
// The native splash under this overlay is deliberately just the background
// color (see the expo-splash-screen plugin config in app.json): Android 12+
// always clips its splash icon into a ~192dp circle at a fixed size, so a
// static logo there can never line up with this full-screen layout. An empty
// background is frame 0 of this animation, which makes the handoff invisible.

const TITLE = 'PEAR SNAKE'
const DRAW_MS = 1250
const TYPE_START_MS = 900
const TYPE_CHAR_MS = 55
const TYPE_END_MS = TYPE_START_MS + TITLE.length * TYPE_CHAR_MS
const HOLD_MS = 550
const FADE_MS = 320

const win = Dimensions.get('window')
const ICON = Math.min(Math.round(win.width * 0.62), 300)
const SCALE = ICON / SPLASH_VIEWBOX

type Props = { onDone: () => void }

export function AnimatedSplash({ onDone }: Props) {
  const progress = useRef(new Animated.Value(0)).current
  const tongue = useRef(new Animated.Value(0)).current
  const cursor = useRef(new Animated.Value(1)).current
  const stamp = useRef(new Animated.Value(0)).current
  const fade = useRef(new Animated.Value(1)).current
  const [chars, setChars] = useState(0)

  useEffect(() => {
    let alive = true
    const timers: ReturnType<typeof setTimeout>[] = []
    const later = (fn: () => void, ms: number) => timers.push(setTimeout(fn, ms))

    const cursorLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(cursor, { toValue: 0, duration: 60, delay: 360, useNativeDriver: true }),
        Animated.timing(cursor, { toValue: 1, duration: 60, delay: 360, useNativeDriver: true })
      ])
    )
    const finish = (delay: number) => {
      later(() => {
        Animated.timing(fade, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start(
          () => {
            if (alive) onDone()
          }
        )
      }, delay)
    }

    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (!alive) return
      if (reduced) {
        progress.setValue(1)
        tongue.setValue(1)
        stamp.setValue(1)
        setChars(TITLE.length)
        finish(700)
        return
      }
      cursorLoop.start()
      Animated.timing(progress, {
        toValue: 1,
        duration: DRAW_MS,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true
      }).start()
      // tongue flick, twice, once the head has landed
      later(() => {
        Animated.sequence([
          Animated.timing(tongue, { toValue: 1, duration: 90, useNativeDriver: true }),
          Animated.timing(tongue, { toValue: 0.2, duration: 90, useNativeDriver: true }),
          Animated.timing(tongue, { toValue: 1, duration: 110, useNativeDriver: true })
        ]).start()
      }, DRAW_MS + 60)
      // typewriter
      for (let i = 1; i <= TITLE.length; i++) {
        later(() => setChars(i), TYPE_START_MS + i * TYPE_CHAR_MS)
      }
      // version fades in once the title has finished typing
      later(() => {
        Animated.timing(stamp, { toValue: 1, duration: 260, useNativeDriver: true }).start()
      }, TYPE_END_MS + 120)
      finish(Math.max(DRAW_MS + 420, TYPE_END_MS + 380) + HOLD_MS)
    })

    return () => {
      alive = false
      timers.forEach(clearTimeout)
      cursorLoop.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const boxOf = (r: (typeof SPLASH_RECTS)[number]) => ({
    position: 'absolute' as const,
    left: r.x * SCALE,
    top: r.y * SCALE,
    width: r.w * SCALE,
    height: r.h * SCALE
  })

  return (
    <Animated.View
      style={[styles.overlay, { opacity: fade }]}
      onLayout={() => {
        // first frame is up — release the native splash underneath
        SplashScreen.hideAsync().catch(() => {})
      }}
    >
      <View>
        <View style={{ width: ICON, height: ICON }}>
          {SPLASH_RECTS.map((r, i) => {
            const box = boxOf(r)
            if (r.k === 'eye') {
              return (
                <View key={i} style={[box, { backgroundColor: theme.background, zIndex: 1 }]} />
              )
            }
            const opacity =
              r.k === 'tongue'
                ? tongue
                : progress.interpolate({
                    inputRange: [Math.max(0, (r.o ?? 0) * 0.88 - 0.07), (r.o ?? 0) * 0.88 + 0.001],
                    outputRange: [0, 1],
                    extrapolate: 'clamp'
                  })
            return (
              <Animated.View key={i} style={[box, { backgroundColor: theme.accent, opacity }]} />
            )
          })}
          <View style={styles.titleRow}>
            <Text style={styles.title}>{TITLE.slice(0, chars)}</Text>
            <Animated.Text style={[styles.title, { opacity: cursor }]}>█</Animated.Text>
          </View>
          <Animated.Text
            style={[
              styles.version,
              { opacity: stamp.interpolate({ inputRange: [0, 1], outputRange: [0, 0.6] }) }
            ]}
          >
            v{version}
          </Animated.Text>
        </View>
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.background,
    alignItems: 'center',
    justifyContent: 'center'
  },
  titleRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: ICON + 26,
    flexDirection: 'row',
    justifyContent: 'center'
  },
  title: {
    color: theme.accent,
    fontFamily: theme.mono,
    fontSize: 20,
    letterSpacing: 3
  },
  version: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: ICON + 56,
    textAlign: 'center',
    color: theme.accent,
    fontFamily: theme.mono,
    fontSize: 11,
    letterSpacing: 2
  }
})
