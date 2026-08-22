import { Image, StyleSheet, View } from 'react-native'
import { TILES } from './constants'
import { SnakeGame } from './engine'
import { theme } from '../theme'

type Props = {
  game: SnakeGame
  size: number // board edge length in px (a multiple of TILES)
  over: boolean
  // Bumped every tick so the board re-renders from the engine's mutable state.
  version: number
}

// Canvas-free equivalent of the desktop draw(): only occupied cells are
// rendered — one absolutely positioned View per snake segment plus the pear
// glyph for the food — rather than a 30x30 grid of cells.
export function Board({ game, size, over }: Props) {
  const tile = size / TILES
  const players = Array.from(game.players.values())

  return (
    <View
      style={[
        styles.board,
        { width: size, height: size, backgroundColor: over ? theme.boardOver : theme.board }
      ]}
    >
      {game.food && (
        <Image
          source={require('../../assets/pear.png')}
          resizeMode='contain'
          style={[
            styles.food,
            {
              left: game.food.x * tile,
              top: game.food.y * tile,
              width: tile,
              height: tile
            }
          ]}
        />
      )}
      {players.map((player) =>
        player.snake.map((seg, i) => (
          <View
            key={`${player.id}:${i}`}
            style={{
              position: 'absolute',
              left: seg.x * tile,
              top: seg.y * tile,
              width: tile,
              height: tile,
              backgroundColor: player.color
            }}
          />
        ))
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  board: {
    position: 'relative',
    overflow: 'hidden',
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: theme.accent
  },
  food: {
    position: 'absolute'
  }
})
