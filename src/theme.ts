// Colors lifted from the desktop build (../snake/renderer/index.html) so the
// mobile app wears the same green-on-black Pear terminal look.
import { Platform } from 'react-native'

export const theme = {
  accent: '#b0d944',
  background: '#001601',
  panel: '#000000',
  board: '#000000',
  boardOver: '#151815',
  text: '#ffffff',
  // 'monospace' resolves on Android but has no iOS equivalent (glyphs, incl.
  // emoji, fall back to a "missing glyph" box); use a real iOS monospace face.
  mono: Platform.select({ ios: 'Menlo', default: 'monospace' })
}
