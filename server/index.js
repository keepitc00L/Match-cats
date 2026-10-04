// ============================================================
// Match Cats — PvP Server
// Express + Socket.IO real-time game server
// ============================================================

import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import {
  waitingQueue,
  playerNames,
  playerRoom,
  createRoom,
  resetRoom,
  processDrawCard,
  processBellUse,
  sanitizeRoom,
  removePlayer,
  destroyRoom,
  rooms,
  WIN_SCORE,
} from './game.js'

// ────────────────────────────────────────────
// Server setup
// ────────────────────────────────────────────

const PORT = process.env.PORT || 3001

const app = express()
app.use(cors())
app.use(express.json())

const httpServer = createServer(app)

const io = new Server(httpServer, {
  cors: {
    origin: '*',           // tighten this in production
    methods: ['GET', 'POST'],
  },
})

// Track rematch votes: roomId → Set of socketIds that accepted rematch
const rematchVotes = new Map()

// ────────────────────────────────────────────
// Health check endpoint
// ────────────────────────────────────────────

app.get('/', (_req, res) => {
  res.json({
    game: 'Match Cats PvP',
    status: 'online',
    activeRooms: rooms.size,
    playersInQueue: waitingQueue.length,
  })
})

// ────────────────────────────────────────────
// Helper — determine + broadcast game summary
// ────────────────────────────────────────────

function broadcastGameSummary(roomId) {
  const room = rooms.get(roomId)
  if (!room) return

  const [p0, p1] = room.players

  let winner = null
  let tie = false

  if (p0.score > p1.score) winner = { id: p0.id, name: p0.name, score: p0.score }
  else if (p1.score > p0.score) winner = { id: p1.id, name: p1.name, score: p1.score }
  else tie = true

  io.to(roomId).emit('game_summary', {
    winner,
    tie,
    finalScores: room.players.map(p => ({ name: p.name, score: p.score })),
    reason: p0.score >= WIN_SCORE || p1.score >= WIN_SCORE ? 'score_limit' : 'deck_empty',
  })
}

// ────────────────────────────────────────────
// Socket.IO connection handler
// ────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`🐱 Connected: ${socket.id}`)

  // ── PLAYER SETS NAME ──
  socket.on('set_name', (name) => {
    const safeName = (typeof name === 'string' && name.trim())
      ? name.trim().slice(0, 16).toUpperCase()
      : 'KITTY_' + socket.id.slice(0, 4).toUpperCase()

    playerNames.set(socket.id, safeName)
    socket.emit('name_set', { name: safeName })
    console.log(`   → ${socket.id} is now "${safeName}"`)
  })

  // ── JOIN MATCHMAKING QUEUE ──
  socket.on('find_match', () => {
    // Don't double-queue
    if (waitingQueue.includes(socket.id)) {
      socket.emit('queue_status', { position: waitingQueue.indexOf(socket.id) + 1 })
      return
    }

    // Don't queue if already in a game
    if (playerRoom.has(socket.id)) {
      socket.emit('error_msg', { message: 'You are already in a game.' })
      return
    }

    waitingQueue.push(socket.id)
    console.log(`   → ${socket.id} joined queue (${waitingQueue.length} waiting)`)

    socket.emit('queue_status', { position: waitingQueue.length })

    // ── TRY TO MATCH TWO PLAYERS ──
    if (waitingQueue.length >= 2) {
      const p1 = waitingQueue.shift()
      const p2 = waitingQueue.shift()

      const room = createRoom(p1, p2)
      console.log(`🎮 Match created: ${room.roomId} — ${room.players[0].name} vs ${room.players[1].name}`)

      // Join Socket.IO room for broadcasting
      const s1 = io.sockets.sockets.get(p1)
      const s2 = io.sockets.sockets.get(p2)

      if (s1) s1.join(room.roomId)
      if (s2) s2.join(room.roomId)

      // Send game_start to each player with their perspective
      room.players.forEach((player, index) => {
        const sock = io.sockets.sockets.get(player.id)
        if (sock) {
          sock.emit('game_start', {
            roomId: room.roomId,
            playerIndex: index,
            room: sanitizeRoom(room, player.id),
          })
        }
      })
    }
  })

  // ── LEAVE QUEUE ──
  socket.on('leave_queue', () => {
    const idx = waitingQueue.indexOf(socket.id)
    if (idx !== -1) {
      waitingQueue.splice(idx, 1)
      console.log(`   → ${socket.id} left queue`)
    }
    socket.emit('queue_left')
  })

  // ── DRAW CARD ──
  socket.on('draw_card', () => {
    const roomId = playerRoom.get(socket.id)
    if (!roomId) {
      socket.emit('error_msg', { message: 'You are not in a game.' })
      return
    }

    const result = processDrawCard(roomId, socket.id)
    if (!result) {
      socket.emit('error_msg', { message: 'Not your turn or game is over.' })
      return
    }

    // Broadcast draw result to both players in the room
    io.to(roomId).emit(result.type, result)

    // If game is over, also send a summary
    if (result.type === 'game_over') {
      broadcastGameSummary(roomId)
    }
  })

  // ── USE BELL ITEM ──
  socket.on('use_bell', () => {
    const roomId = playerRoom.get(socket.id)
    if (!roomId) {
      socket.emit('error_msg', { message: 'You are not in a game.' })
      return
    }

    const peekedCard = processBellUse(roomId, socket.id)
    if (!peekedCard) {
      socket.emit('error_msg', { message: 'No bell to use, or game is not active.' })
      return
    }

    // Send the peeked card ONLY to the requesting player (private!)
    socket.emit('bell_peek', {
      card: peekedCard,
      message: `You secretly peeked! The opponent's next card will be: ${peekedCard.name}`,
    })

    // Update item counts for both players (bell count decreased)
    const room = rooms.get(roomId)
    if (room) {
      io.to(roomId).emit('items_updated', {
        items: room.players.map(p => ({ fish: p.items.fish, yarn: p.items.yarn, bell: p.items.bell })),
      })
    }
  })

  // ── REMATCH REQUEST ──
  socket.on('request_rematch', () => {
    const roomId = playerRoom.get(socket.id)
    if (!roomId) return

    const room = rooms.get(roomId)
    if (!room || room.status !== 'finished') return

    // Track rematch votes per room
    if (!rematchVotes.has(roomId)) {
      rematchVotes.set(roomId, new Set())
    }
    rematchVotes.get(roomId).add(socket.id)

    const votes = rematchVotes.get(roomId)
    const allPlayers = room.players.map(p => p.id)

    // Notify the other player that this player wants a rematch
    const other = room.players.find(p => p.id !== socket.id)
    if (other) {
      const otherSock = io.sockets.sockets.get(other.id)
      if (otherSock) {
        otherSock.emit('rematch_requested', {
          from: playerNames.get(socket.id) || socket.id,
        })
      }
    }

    // If both players voted for rematch, start a new game
    if (allPlayers.every(id => votes.has(id))) {
      rematchVotes.delete(roomId)
      const resetted = resetRoom(roomId)
      if (!resetted) return

      console.log(`🔄 Rematch started: ${roomId}`)

      // Re-join Socket.IO room (they should already be in it)
      resetted.players.forEach((player, index) => {
        const sock = io.sockets.sockets.get(player.id)
        if (sock) {
          sock.emit('game_start', {
            roomId: resetted.roomId,
            playerIndex: index,
            room: sanitizeRoom(resetted, player.id),
          })
        }
      })
    }
  })

  // ── DISCONNECT ──
  socket.on('disconnect', (reason) => {
    console.log(`👋 Disconnected: ${socket.id} (${reason})`)

    const room = removePlayer(socket.id)

    if (room) {
      // Notify remaining player that opponent left
      io.to(room.roomId).emit('opponent_left', {
        message: 'Your opponent disconnected.',
      })

      // Clean up room after a short delay
      setTimeout(() => destroyRoom(room.roomId), 5000)
    }
  })
})

// ────────────────────────────────────────────
// Start server
// ────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log('')
  console.log('  ╔══════════════════════════════════════╗')
  console.log('  ║   🐱 MATCH CATS PvP SERVER ONLINE   ║')
  console.log(`  ║   Port: ${PORT}                         ║`)
  console.log('  ║   Ready for cat battles!             ║')
  console.log('  ╚══════════════════════════════════════╝')
  console.log('')
})
