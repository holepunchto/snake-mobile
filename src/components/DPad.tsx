import { memo, useMemo, useRef, useState } from 'react'
import { GestureResponderEvent, PanResponder, StyleSheet, View } from 'react-native'
import { Direction } from '../game/constants'
import { theme } from '../theme'

type Props = {
  onDirection: (dir: Direction) => void
  disabled?: boolean
}

// Retro donut D-pad: one ring split into four quadrant segments (up/right/down/
// left) divided by diagonal borders. Built from a 2x2 of quarter-circles rotated
// 45deg so the seams fall on the diagonals; the outer ring, hollow center, and
// arrows are non-rotated overlays on top.
const RING = 180 // outer diameter
const R = RING / 2 // quarter-circle size
const HOLE = 74 // hollow center diameter
const ARROW = 13 // half-base of the triangle arrows

// Which wedge a touch is over. The seams are the diagonals, so the larger offset
// from the center picks the axis.
function directionAt(x: number, y: number): Direction | null {
  const dx = x - R
  const dy = y - R
  if (dx * dx + dy * dy < (HOLE / 2) ** 2) return null // hollow center
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left'
  return dy > 0 ? 'down' : 'up'
}

// On-screen arrow pad — the touch equivalent of the desktop arrow keys. Swiping
// the board works too (see GameScreen).
//
// One responder for the whole pad rather than a button per wedge: a held finger
// can slide from wedge to wedge and every wedge it enters fires, which is how you
// steer through a tight turn without lifting off. Per-wedge Pressables only fired
// on release and cancelled as soon as the touch moved off them.
function DPadComponent({ onDirection, disabled }: Props) {
  const [active, setActive] = useState<Direction | null>(null)
  const latest = useRef({ onDirection, disabled, active })
  latest.current.onDirection = onDirection
  latest.current.disabled = disabled

  const pan = useMemo(() => {
    const track = (e: GestureResponderEvent) => {
      const state = latest.current
      if (state.disabled) return
      const dir = directionAt(e.nativeEvent.locationX, e.nativeEvent.locationY)
      // Sliding through the hollow center keeps the last wedge rather than
      // cancelling, so a finger crossing the pad does not drop the input.
      if (dir === null || dir === state.active) return
      state.active = dir
      setActive(dir)
      state.onDirection(dir)
    }
    const release = () => {
      latest.current.active = null
      setActive(null)
    }
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: track,
      onPanResponderMove: track,
      onPanResponderRelease: release,
      onPanResponderTerminate: release
    })
  }, [])

  return (
    <View style={[styles.pad, disabled && styles.padDisabled]} {...pan.panHandlers}>
      {/* pointerEvents none throughout: every touch lands on the pad itself, so
          locationX/Y stay relative to it even when the finger leaves the ring. */}
      <View style={styles.wheel} pointerEvents='none'>
        <View style={[styles.quarter, styles.qTL, active === 'up' && styles.quarterActive]} />
        <View style={[styles.quarter, styles.qTR, active === 'right' && styles.quarterActive]} />
        <View style={[styles.quarter, styles.qBR, active === 'down' && styles.quarterActive]} />
        <View style={[styles.quarter, styles.qBL, active === 'left' && styles.quarterActive]} />
      </View>

      <View style={styles.ringOutline} pointerEvents='none' />
      <View style={styles.hole} pointerEvents='none' />
      <View style={styles.arrows} pointerEvents='none'>
        <View style={[styles.arrow, styles.arrowUp]} />
        <View style={[styles.arrow, styles.arrowDown]} />
        <View style={[styles.arrow, styles.arrowLeft]} />
        <View style={[styles.arrow, styles.arrowRight]} />
      </View>
    </View>
  )
}

export const DPad = memo(DPadComponent)

const styles = StyleSheet.create({
  pad: {
    width: RING,
    height: RING,
    alignSelf: 'center',
    position: 'relative'
  },
  padDisabled: {
    opacity: 0.35
  },
  wheel: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: RING,
    height: RING,
    borderRadius: R,
    overflow: 'hidden',
    transform: [{ rotate: '45deg' }]
  },
  quarter: {
    position: 'absolute',
    width: R,
    height: R,
    backgroundColor: theme.panel,
    borderColor: theme.accent
  },
  quarterActive: {
    backgroundColor: 'rgba(176, 217, 68, 0.30)'
  },
  qTL: { top: 0, left: 0, borderTopLeftRadius: R, borderRightWidth: 1, borderBottomWidth: 1 },
  qTR: { top: 0, right: 0, borderTopRightRadius: R, borderLeftWidth: 1, borderBottomWidth: 1 },
  qBL: { bottom: 0, left: 0, borderBottomLeftRadius: R, borderRightWidth: 1, borderTopWidth: 1 },
  qBR: { bottom: 0, right: 0, borderBottomRightRadius: R, borderLeftWidth: 1, borderTopWidth: 1 },
  ringOutline: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: RING,
    height: RING,
    borderRadius: R,
    borderWidth: 2,
    borderColor: theme.accent
  },
  hole: {
    position: 'absolute',
    top: (RING - HOLE) / 2,
    left: (RING - HOLE) / 2,
    width: HOLE,
    height: HOLE,
    borderRadius: HOLE / 2,
    borderWidth: 2,
    borderColor: theme.accent,
    backgroundColor: theme.background
  },
  arrows: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0
  },
  arrow: {
    position: 'absolute',
    width: 0,
    height: 0,
    borderColor: 'transparent'
  },
  arrowUp: {
    top: 20,
    left: R - ARROW,
    borderLeftWidth: ARROW,
    borderRightWidth: ARROW,
    borderBottomWidth: ARROW * 1.5,
    borderBottomColor: theme.accent
  },
  arrowDown: {
    bottom: 20,
    left: R - ARROW,
    borderLeftWidth: ARROW,
    borderRightWidth: ARROW,
    borderTopWidth: ARROW * 1.5,
    borderTopColor: theme.accent
  },
  arrowLeft: {
    left: 20,
    top: R - ARROW,
    borderTopWidth: ARROW,
    borderBottomWidth: ARROW,
    borderRightWidth: ARROW * 1.5,
    borderRightColor: theme.accent
  },
  arrowRight: {
    right: 20,
    top: R - ARROW,
    borderTopWidth: ARROW,
    borderBottomWidth: ARROW,
    borderLeftWidth: ARROW * 1.5,
    borderLeftColor: theme.accent
  }
})
