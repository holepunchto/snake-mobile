const test = require('brittle')
const createClock = require('./helpers/clock')
require('./helpers/typescript')

const { SnakeGame } = require('../src/game/engine.ts')
const { TILES } = require('../src/game/constants.ts')

function createGame(t) {
  const events = { messages: [], gameOvers: 0 }
  const game = new SnakeGame({
    send: (data) => events.messages.push(JSON.parse(data)),
    onOver: () => events.gameOvers++,
    onChange() {}
  })
  t.teardown(() => game.destroy(), { force: true })
  game.start('aaaaaa', Uint8Array.of(20, 20))
  game.destroy()
  game.player.snake = [{ x: 5, y: 5 }]
  game.player.direction = { x: 1, y: 0 }
  events.messages.length = 0
  return { game, events }
}

function fixRandom(t) {
  const random = Math.random
  Math.random = () => 0.5
  t.teardown(
    () => {
      Math.random = random
    },
    { force: true }
  )
}

test('moving advances the head and removes the tail', (t) => {
  const { game } = createGame(t)
  game.player.snake.push({ x: 4, y: 5 })

  game.tick()

  t.alike(game.player.snake, [
    { x: 6, y: 5 },
    { x: 5, y: 5 }
  ])
})

for (const [edge, head, direction, expected] of [
  ['right', { x: TILES - 1, y: 5 }, { x: 1, y: 0 }, { x: 0, y: 5 }],
  ['left', { x: 0, y: 5 }, { x: -1, y: 0 }, { x: TILES - 1, y: 5 }],
  ['bottom', { x: 5, y: TILES - 1 }, { x: 0, y: 1 }, { x: 5, y: 0 }],
  ['top', { x: 5, y: 0 }, { x: 0, y: -1 }, { x: 5, y: TILES - 1 }]
]) {
  test(`crossing the ${edge} edge wraps to the opposite side`, (t) => {
    const { game } = createGame(t)
    game.player.snake = [head]
    game.player.direction = direction

    game.tick()

    t.alike(game.player.snake, [expected])
  })
}

test('eating a pear grows the snake and awards 100 points', (t) => {
  const { game } = createGame(t)
  game.food = { x: 6, y: 5 }
  fixRandom(t)

  game.tick()

  t.alike(game.player.snake, [
    { x: 6, y: 5 },
    { x: 5, y: 5 }
  ])
  t.is(game.myScore(), 100)
  t.alike(game.food, { x: 15, y: 15 })
})

test('a snake cannot reverse direction', (t) => {
  const { game } = createGame(t)
  game.player.snake.push({ x: 4, y: 5 })

  game.setDirection('left')
  game.tick()

  t.alike(game.player.snake[0], { x: 6, y: 5 })
  t.is(game.drop, false)
})

test('repeated and reverse inputs do not consume queued turns', (t) => {
  const { game } = createGame(t)

  game.setDirection('right')
  game.setDirection('up')
  game.setDirection('up')
  game.setDirection('down')
  game.setDirection('left')
  game.tick()
  game.tick()

  t.alike(game.player.snake[0], { x: 4, y: 4 })
})

test('only two turns are queued and each takes a separate tick', (t) => {
  const { game } = createGame(t)
  game.player.snake.push({ x: 4, y: 5 })

  game.setDirection('up')
  game.setDirection('left')
  game.setDirection('down')
  game.tick()
  t.alike(game.player.snake[0], { x: 5, y: 4 })
  game.tick()
  t.alike(game.player.snake[0], { x: 4, y: 4 })
  game.tick()
  t.alike(game.player.snake[0], { x: 3, y: 4 })
  t.is(game.drop, false)
})

test('hitting your own body ends the game once', (t) => {
  const { game, events } = createGame(t)
  game.player.snake = [
    { x: 5, y: 5 },
    { x: 5, y: 6 },
    { x: 6, y: 6 },
    { x: 6, y: 5 },
    { x: 7, y: 5 }
  ]

  game.tick()

  t.is(game.drop, true)
  t.is(game.players.has('aaaaaa'), false)
  t.is(events.gameOvers, 1)

  game.over()
  t.is(events.gameOvers, 1)
})

test('hitting another snake ends your game', (t) => {
  const { game, events } = createGame(t)
  game.addPeer('bbbbbb')
  game.players.get('bbbbbb').snake = [
    { x: 7, y: 5 },
    { x: 6, y: 5 }
  ]

  game.tick()

  t.is(game.drop, true)
  t.is(events.gameOvers, 1)
  t.is(game.players.has('bbbbbb'), true)
})

test('a peer hitting your body loses without ending your game', (t) => {
  const { game, events } = createGame(t)
  game.player.snake.push({ x: 4, y: 5 })
  game.addPeer('bbbbbb')
  game.players.get('bbbbbb').snake = [{ x: 5, y: 5 }]

  game.tick()

  t.is(game.players.has('bbbbbb'), false)
  t.is(game.connected.has('bbbbbb'), true)
  t.is(game.drop, false)
  t.is(events.gameOvers, 0)
})

test('a dead snake cannot move or eat pears', (t) => {
  const { game } = createGame(t)
  game.food = { x: 6, y: 5 }
  game.over()

  game.setDirection('up')
  game.tick()

  t.alike(game.player.snake, [{ x: 5, y: 5 }])
  t.alike(game.food, { x: 6, y: 5 })
  t.is(game.myScore(), 0)
})

test('respawning clears your score and turns while preserving the shared game', (t) => {
  const { game } = createGame(t)
  const topic = game.topicBuffer
  game.addPeer('bbbbbb')
  const peer = game.players.get('bbbbbb')
  game.player.snake.push({ x: 4, y: 5 })
  game.setDirection('up')
  game.over()
  fixRandom(t)

  game.reset()
  game.tick()

  t.is(game.player.id, 'aaaaaa')
  t.is(game.drop, false)
  t.is(game.myScore(), 0)
  t.alike(game.player.snake, [{ x: 15, y: 15 }])
  t.alike(game.food, { x: 20, y: 20 })
  t.is(game.topicBuffer, topic)
  t.is(game.players.get('bbbbbb'), peer)
  t.is(game.connected.has('bbbbbb'), true)
})

test('leaving stops the loop and clears the game for a new session', (t) => {
  const clock = createClock(t)
  const { game, events } = createGame(t)
  game.addPeer('bbbbbb')
  game.loop()
  game.setDirection('up')
  events.messages.length = 0

  game.leave()
  clock.tick(1000)
  game.applyPeerState({
    id: 'bbbbbb',
    snake: [{ x: 8, y: 7 }],
    food: { x: 9, y: 9 },
    drop: false
  })

  t.is(events.messages.length, 0)
  t.is(game.players.size, 0)
  t.is(game.connected.size, 0)
  t.is(game.player, null)
  t.is(game.food, null)
  t.is(game.topicBuffer, null)
  t.is(game.drop, false)

  game.start('cccccc', Uint8Array.of(10, 10))
  game.destroy()
  t.is(game.player.id, 'cccccc')
  t.alike(game.player.direction, { x: 0, y: 0 })
})

test('the leaderboard ranks scores and keeps your final score after death', (t) => {
  const { game } = createGame(t)
  game.player.snake.push({ x: 4, y: 5 })
  game.addPeer('cccccc')
  game.addPeer('bbbbbb')
  game.players.get('cccccc').snake = [{ x: 8, y: 8 }]
  game.players.get('bbbbbb').snake = [
    { x: 9, y: 9 },
    { x: 9, y: 10 }
  ]
  game.over()

  t.alike(game.leaderboard(), [
    { id: 'aaaaaa', color: '#aaaaaa', score: 100, me: true },
    { id: 'bbbbbb', color: '#bbbbbb', score: 100, me: false },
    { id: 'cccccc', color: '#cccccc', score: 0, me: false }
  ])
})

test('peer movement updates its snake without changing shared food', (t) => {
  const { game } = createGame(t)
  game.addPeer('bbbbbb')
  game.players.get('bbbbbb').snake = [{ x: 7, y: 7 }]
  const snake = [{ x: 8, y: 7 }]

  game.applyPeerState({ id: 'bbbbbb', snake, food: { x: 9, y: 9 }, drop: false })

  t.alike(game.players.get('bbbbbb').snake, snake)
  t.alike(game.food, { x: 20, y: 20 })
})

test('a peer eating a pear updates the shared food', (t) => {
  const { game } = createGame(t)
  game.addPeer('bbbbbb')
  game.players.get('bbbbbb').snake = [{ x: 7, y: 7 }]
  const snake = [
    { x: 8, y: 7 },
    { x: 7, y: 7 }
  ]

  game.applyPeerState({ id: 'bbbbbb', snake, food: { x: 9, y: 9 }, drop: false })

  t.alike(game.players.get('bbbbbb').snake, snake)
  t.alike(game.food, { x: 9, y: 9 })
})

test('a connected peer can respawn after dying', (t) => {
  const { game } = createGame(t)
  game.addPeer('bbbbbb')
  game.applyPeerState({ id: 'bbbbbb', drop: true })
  t.is(game.players.has('bbbbbb'), false)

  game.applyPeerState({
    id: 'bbbbbb',
    snake: [{ x: 8, y: 7 }],
    food: game.food,
    drop: false
  })

  t.alike(game.players.get('bbbbbb').snake, [{ x: 8, y: 7 }])
  t.is(game.connected.has('bbbbbb'), true)
})

test('a disconnected peer cannot reappear through late messages', (t) => {
  const { game } = createGame(t)
  game.addPeer('bbbbbb')
  game.removePeer('bbbbbb')

  game.applyPeerState({
    id: 'bbbbbb',
    snake: [{ x: 8, y: 7 }],
    food: { x: 9, y: 9 },
    drop: false
  })

  t.is(game.players.has('bbbbbb'), false)
  t.is(game.connected.has('bbbbbb'), false)
  t.alike(game.food, { x: 20, y: 20 })
})

test('state broadcasts include your snake, shared food and death status', (t) => {
  const { game, events } = createGame(t)
  game.over()

  game.sync()

  t.is(events.messages.length, 1)
  t.alike(events.messages[0], {
    id: 'aaaaaa',
    food: { x: 20, y: 20 },
    snake: [{ x: 5, y: 5 }],
    drop: true
  })
})
