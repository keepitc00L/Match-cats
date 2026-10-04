// ============================================================
// Match Cats — Game Logic Module
// Server-authoritative deck, rooms, scoring
// ============================================================

/**
 * @typedef {'lazy'|'warrior'|'wizard'|'royal'|'mouse'|'fish'|'yarn'|'bell'} CatKind
 *
 * @typedef {{
 *   id: number,
 *   kind: CatKind,
 *   name: string,
 *   points?: number,
 *   emoji: string,
 *   rarity: string,
 *   color: string
 * }} GameCard
 *
 * @typedef {{
 *   roomId: string,
 *   players: { id: string, name: string, score: number, streak: number, items: {fish:number,yarn:number,bell:number}, pendingFish: boolean, pendingYarn: boolean, bellPeek: GameCard|null }[],
 *   deck: GameCard[],
 *   round: number,
 *   turnIndex: number,
 *   status: 'waiting'|'playing'|'finished',
 *   lastDraw: { playerCard?: GameCard, opponentCard?: GameCard } | null,
 *   pendingDraw: boolean
 * }} GameRoom
 */

// ────────────────────────────────────────────
// Card definitions (mirrored from frontend)
// ────────────────────────────────────────────

const CARD_INFO = {
  lazy:    { kind: 'lazy',    name: 'Lazy Cat',     points: 2, emoji: '😼',    rarity: 'COMMON',    color: 'peach'  },
  warrior: { kind: 'warrior', name: 'Warrior Cat',  points: 4, emoji: '🐱',    rarity: 'UNCOMMON',  color: 'mint'   },
  wizard:  { kind: 'wizard',  name: 'Wizard Cat',   points: 3, emoji: '🐈‍⬛', rarity: 'RARE',      color: 'lilac'  },
  royal:   { kind: 'royal',   name: 'Royal Cat',    points: 7, emoji: '😺',    rarity: 'LEGENDARY', color: 'gold'   },
  mouse:   { kind: 'mouse',   name: 'Sneaky Mouse',            emoji: '🐭',    rarity: 'TROUBLE',   color: 'mouse'  },
  fish:    { kind: 'fish',    name: 'Lucky Fish',              emoji: '🐟',    rarity: 'ITEM',      color: 'blue'   },
  yarn:    { kind: 'yarn',    name: 'Ball of Yarn',            emoji: '🧶',    rarity: 'ITEM',      color: 'pink'   },
  bell:    { kind: 'bell',    name: 'Lucky Bell',              emoji: '🔔',    rarity: 'ITEM',      color: 'gold'   },
}

/** Score required to immediately win the game */
const WIN_SCORE = 30

// ────────────────────────────────────────────
// Deck builder  (Fisher-Yates shuffle)
// ────────────────────────────────────────────

function makeDeck() {
  /** @type {CatKind[]} */
  const kinds = [
    'lazy','lazy','lazy','lazy','lazy',
    'warrior','warrior','warrior',
    'wizard','wizard',
    'royal',
    'mouse','mouse','mouse',
    'fish','fish',
    'yarn','yarn',
    'bell','bell',
  ]

  const cards = kinds.map((kind, i) => ({
    id: i + 1,
    ...CARD_INFO[kind],
  }))

  // Fisher-Yates shuffle
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]]
  }

  return cards
}

// ────────────────────────────────────────────
// Game Room Manager
// ────────────────────────────────────────────

/** @type {Map<string, GameRoom>} */
const rooms = new Map()

/** @type {string[]}  socket ids waiting for a match */
const waitingQueue = []

/** Maps a socket id → the room id they belong to */
const playerRoom = new Map()

/** Maps a socket id → their player name */
const playerNames = new Map()

let roomCounter = 0

/**
 * Create a fresh player object.
 */
function makePlayer(socketId, name) {
  return {
    id: socketId,
    name,
    score: 0,
    streak: 0,
    items: { fish: 0, yarn: 0, bell: 0 },
    pendingFish: false,   // fish consumed → next cat match +2
    pendingYarn: false,   // yarn consumed → next mouse is blocked
    bellPeek: null,       // privately held peeked card (not sent to client in room)
  }
}

/**
 * Create a new game room with two players.
 */
function createRoom(player1Id, player2Id) {
  roomCounter++
  const roomId = `room-${roomCounter}`

  const name1 = playerNames.get(player1Id) || 'KITTY_' + player1Id.slice(0, 4).toUpperCase()
  const name2 = playerNames.get(player2Id) || 'KITTY_' + player2Id.slice(0, 4).toUpperCase()

  /** @type {GameRoom} */
  const room = {
    roomId,
    players: [
      makePlayer(player1Id, name1),
      makePlayer(player2Id, name2),
    ],
    deck: makeDeck(),
    round: 1,
    turnIndex: 0,        // index into players[] — whose turn it is
    status: 'playing',
    lastDraw: null,
    pendingDraw: false,  // guard against duplicate draw_card in same turn
  }

  rooms.set(roomId, room)
  playerRoom.set(player1Id, roomId)
  playerRoom.set(player2Id, roomId)

  return room
}

/**
 * Fully reset a room for a rematch — same players, fresh deck + scores.
 */
function resetRoom(roomId) {
  const room = rooms.get(roomId)
  if (!room) return null

  room.deck = makeDeck()
  room.round = 1
  room.turnIndex = 0
  room.status = 'playing'
  room.lastDraw = null
  room.pendingDraw = false

  room.players.forEach(p => {
    p.score = 0
    p.streak = 0
    p.items = { fish: 0, yarn: 0, bell: 0 }
    p.pendingFish = false
    p.pendingYarn = false
    p.bellPeek = null
  })

  return room
}

/**
 * Streak bonus rules:
 *   1st match  (streak was 0 before) → +0
 *   2nd match  (streak was 1 before) → +1
 *   3rd match  (streak was 2 before) → +2
 *   4th+ match (streak was 3+ before) → +3
 */
function streakBonus(streakBeforeMatch) {
  if (streakBeforeMatch === 0) return 0
  if (streakBeforeMatch === 1) return 1
  if (streakBeforeMatch === 2) return 2
  return 3
}

/**
 * Use a Bell item: privately reveals the top-of-deck card to `socketId`.
 * Returns { card } or null if invalid.
 */
function processBellUse(roomId, socketId) {
  const room = rooms.get(roomId)
  if (!room || room.status !== 'playing') return null

  const player = room.players.find(p => p.id === socketId)
  if (!player || player.items.bell < 1) return null

  // deck[0] = drawer's card, deck[1] = opponent's card
  // The bell reveals the OPPONENT's next card (index 1)
  const nextCard = room.deck.length > 1 ? room.deck[1] : null

  if (!nextCard) return null

  // Consume one bell
  player.items.bell--
  player.bellPeek = nextCard

  return nextCard
}

/**
 * Process a "draw card" action.
 * Returns a result object describing what happened, or null if invalid.
 */
function processDrawCard(roomId, socketId) {
  const room = rooms.get(roomId)
  if (!room || room.status !== 'playing') return null

  // Verify it's this player's turn
  const playerIndex = room.players.findIndex(p => p.id === socketId)
  if (playerIndex === -1) return null
  if (room.turnIndex !== playerIndex) return null

  // Reject duplicate draw_card requests in the same turn
  if (room.pendingDraw) return null
  room.pendingDraw = true

  // Need at least 2 cards (one for each player)
  if (room.deck.length < 2) {
    room.status = 'finished'
    room.pendingDraw = false
    return {
      type: 'game_over',
      playerCard: null,
      opponentCard: null,
      notice: 'DECK EMPTY!',
      noticeSub: 'No more cards — the match is over!',
      round: room.round,
      scores: room.players.map(p => p.score),
      streaks: room.players.map(p => p.streak),
      items: room.players.map(p => ({ fish: p.items.fish, yarn: p.items.yarn, bell: p.items.bell })),
      pendingEffects: room.players.map(p => ({ fish: p.pendingFish, yarn: p.pendingYarn })),
      turnIndex: room.turnIndex,
      cardsLeft: room.deck.length,
      drawerId: socketId,
      drawerIndex: playerIndex,
    }
  }

  const playerCard = room.deck.shift()
  const opponentCard = room.deck.shift()

  const player = room.players[playerIndex]
  const opponent = room.players[1 - playerIndex]

  // Clear any private bell peek since the turn has resolved
  player.bellPeek = null

  let notice = ''
  let noticeSub = ''
  let eventType = 'draw_result'

  // ── MOUSE ──
  if (playerCard.kind === 'mouse') {
    if (player.pendingYarn) {
      // Yarn blocks the penalty — consume it
      player.pendingYarn = false
      player.items.yarn = Math.max(0, player.items.yarn - 1)
      notice = 'YARN SAVES THE DAY!'
      noticeSub = `${player.name}'s yarn ball tangled up the mouse! No penalty this time.`
    } else {
      player.score = Math.max(0, player.score - 3)
      notice = 'OH NO… MOUSE!'
      noticeSub = `A sneaky mouse stole 3 of ${player.name}'s paws.`
    }
    player.streak = 0
  }
  // ── ITEM cards ──
  else if (['fish', 'yarn', 'bell'].includes(playerCard.kind)) {
    player.items[playerCard.kind]++
    if (playerCard.kind === 'fish') {
      player.pendingFish = true
      notice = 'LUCKY FISH!'
      noticeSub = `${player.name} caught a Lucky Fish! The next cat match earns +2 extra paws.`
    } else if (playerCard.kind === 'yarn') {
      player.pendingYarn = true
      notice = 'BALL OF YARN!'
      noticeSub = `${player.name} found a Ball of Yarn! The next mouse penalty is blocked.`
    } else {
      notice = 'LUCKY BELL!'
      noticeSub = `${player.name} found a Lucky Bell! Use it (bell button) to privately peek at the opponent's next card.`
    }
  }
  // ── MATCH ──
  else if (opponentCard.kind === playerCard.kind) {
    const points = playerCard.points ?? 0
    const bonus = streakBonus(player.streak)   // streak BEFORE incrementing
    let fishBonus = 0

    if (player.pendingFish) {
      fishBonus = 2
      player.pendingFish = false
      player.items.fish = Math.max(0, player.items.fish - 1)
    }

    // ONLY the drawing player scores — opponent does NOT score
    player.score += points + bonus + fishBonus
    player.streak++

    const totalGained = points + bonus + fishBonus
    notice = 'PURRFECT MATCH!'
    noticeSub = `${player.name} matched ${playerCard.name}. +${totalGained} paws!`
    if (fishBonus) noticeSub += ' 🐟 Fish bonus!'
    if (bonus) noticeSub += ` 🔥 Streak bonus +${bonus}!`
  }
  // ── NO MATCH ──
  else {
    player.streak = 0
    notice = 'NO MATCH… YET'
    noticeSub = 'Different cats this time. Try again!'
  }

  room.lastDraw = { playerCard, opponentCard }
  room.round++

  // Swap turn to the other player
  room.turnIndex = 1 - room.turnIndex

  // Allow next draw
  room.pendingDraw = false

  // ── WIN CONDITIONS ──
  // 1) First player to reach 30 paws wins immediately
  if (player.score >= WIN_SCORE || opponent.score >= WIN_SCORE) {
    room.status = 'finished'
    eventType = 'game_over'
  }
  // 2) Deck exhausted — highest score wins; tie if equal
  else if (room.deck.length < 2) {
    room.status = 'finished'
    eventType = 'game_over'
  }

  return {
    type: eventType,
    playerCard,
    opponentCard,
    notice,
    noticeSub,
    round: room.round,
    scores: room.players.map(p => p.score),
    streaks: room.players.map(p => p.streak),
    items: room.players.map(p => ({ fish: p.items.fish, yarn: p.items.yarn, bell: p.items.bell })),
    pendingEffects: room.players.map(p => ({ fish: p.pendingFish, yarn: p.pendingYarn })),
    turnIndex: room.turnIndex,
    cardsLeft: room.deck.length,
    drawerId: socketId,
    drawerIndex: playerIndex,
  }
}

/**
 * Return a sanitized view of the room (no deck contents, no private bellPeek leaked).
 */
function sanitizeRoom(room, _forSocketId) {
  return {
    roomId: room.roomId,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      score: p.score,
      streak: p.streak,
      items: { fish: p.items.fish, yarn: p.items.yarn, bell: p.items.bell },
      // pendingFish / pendingYarn are sent as part of draw_result pendingEffects, not here
    })),
    round: room.round,
    turnIndex: room.turnIndex,
    status: room.status,
    cardsLeft: room.deck.length,
    lastDraw: room.lastDraw,
  }
}

/**
 * Remove a player from the queue and their room.
 * Returns the room they were in (if any).
 */
function removePlayer(socketId) {
  // Remove from waiting queue
  const qIdx = waitingQueue.indexOf(socketId)
  if (qIdx !== -1) waitingQueue.splice(qIdx, 1)

  // Remove from room
  const roomId = playerRoom.get(socketId)
  playerRoom.delete(socketId)
  playerNames.delete(socketId)

  if (roomId) {
    const room = rooms.get(roomId)
    if (room) {
      room.status = 'finished'
      return room
    }
  }
  return null
}

/**
 * Clean up a room entirely.
 */
function destroyRoom(roomId) {
  const room = rooms.get(roomId)
  if (room) {
    room.players.forEach(p => playerRoom.delete(p.id))
    rooms.delete(roomId)
  }
}

export {
  CARD_INFO,
  WIN_SCORE,
  makeDeck,
  rooms,
  waitingQueue,
  playerRoom,
  playerNames,
  createRoom,
  resetRoom,
  processDrawCard,
  processBellUse,
  sanitizeRoom,
  removePlayer,
  destroyRoom,
}
