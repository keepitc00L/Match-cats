import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, BookOpen, Cat, ChevronRight, CircleHelp, Heart, Home,
  Loader, Menu, RotateCcw, Sparkles, Volume2, VolumeX, Zap,
} from 'lucide-react'
import { connectSocket, disconnectSocket, getSocket } from './socket'

type CatKind =
  | 'lazy'
  | 'warrior'
  | 'wizard'
  | 'royal'
  | 'mouse'
  | 'fish'
  | 'yarn'
  | 'bell'

type GameCard = {
  id: number
  kind: CatKind
  name: string
  points?: number
  emoji: string
  rarity: string
  color: string
}

type ItemCounts = {
  fish: number
  yarn: number
  bell: number
}

type PlayerInfo = {
  id: string
  name: string
  score: number
  streak: number
  items: ItemCounts
}

type RoomData = {
  roomId: string
  players: PlayerInfo[]
  round: number
  turnIndex: number
  status: 'waiting' | 'playing' | 'finished'
  cardsLeft: number
  lastDraw: { playerCard?: GameCard; opponentCard?: GameCard } | null
}

const CARD_INFO: Record<CatKind, Omit<GameCard, 'id'>> = {
  lazy: {
    kind: 'lazy',
    name: 'Lazy Cat',
    points: 2,
    emoji: '😼',
    rarity: 'COMMON',
    color: 'peach',
  },
  warrior: {
    kind: 'warrior',
    name: 'Warrior Cat',
    points: 4,
    emoji: '🐱',
    rarity: 'UNCOMMON',
    color: 'mint',
  },
  wizard: {
    kind: 'wizard',
    name: 'Wizard Cat',
    points: 3,
    emoji: '🐈‍⬛',
    rarity: 'RARE',
    color: 'lilac',
  },
  royal: {
    kind: 'royal',
    name: 'Royal Cat',
    points: 7,
    emoji: '😺',
    rarity: 'LEGENDARY',
    color: 'gold',
  },
  mouse: {
    kind: 'mouse',
    name: 'Sneaky Mouse',
    emoji: '🐭',
    rarity: 'TROUBLE',
    color: 'mouse',
  },
  fish: {
    kind: 'fish',
    name: 'Lucky Fish',
    emoji: '🐟',
    rarity: 'ITEM',
    color: 'blue',
  },
  yarn: {
    kind: 'yarn',
    name: 'Ball of Yarn',
    emoji: '🧶',
    rarity: 'ITEM',
    color: 'pink',
  },
  bell: {
    kind: 'bell',
    name: 'Lucky Bell',
    emoji: '🔔',
    rarity: 'ITEM',
    color: 'gold',
  },
}

// ────────────────────────────────────────────
// COMPONENTS
// ────────────────────────────────────────────

function PixelCat({
  mood = 'happy',
  size = 'large',
}: {
  mood?: string
  size?: 'small' | 'large'
}) {
  return (
    <div
      className={`pixel-cat ${size === 'small' ? 'pixel-cat-small' : ''}`}
      aria-label="pixel cat mascot"
      role="img"
    >
      <div className="cat-ear cat-ear-left" />
      <div className="cat-ear cat-ear-right" />

      <div className="cat-face">
        <span className="cat-eye cat-eye-left">
          {mood === 'sleepy' ? '―' : '•'}
        </span>
        <span className="cat-eye cat-eye-right">
          {mood === 'sleepy' ? '―' : '•'}
        </span>
        <span className="cat-nose">◆</span>
        <span className="cat-mouth">ω</span>
        <span className="cat-blush cat-blush-left" />
        <span className="cat-blush cat-blush-right" />
      </div>

      <span className="cat-paw cat-paw-left" />
      <span className="cat-paw cat-paw-right" />
    </div>
  )
}

function PixelCard({
  card,
  faceDown = false,
  compact = false,
  onClick,
}: {
  card?: GameCard
  faceDown?: boolean
  compact?: boolean
  onClick?: () => void
}) {
  if (faceDown || !card) {
    return (
      <button
        className={`game-card card-back ${compact ? 'card-compact' : ''}`}
        onClick={onClick}
        aria-label="Face down card"
      >
        <div className="card-back-inner">
          <span className="card-star">✦</span>
          <span className="card-back-cat">🐾</span>
          <span className="card-star">✦</span>
        </div>
      </button>
    )
  }

  return (
    <button
      className={`game-card card-${card.color} ${compact ? 'card-compact' : ''}`}
      onClick={onClick}
    >
      <span className="card-rarity">{card.rarity}</span>

      <span className="card-art">
        {card.kind === 'lazy' ? (
          <PixelCat mood="sleepy" />
        ) : (
          <span className="card-emoji">{card.emoji}</span>
        )}
      </span>

      <span className="card-name">{card.name}</span>

      <span className="card-bottom">
        <span className="card-type">
          {card.kind === 'mouse'
            ? 'MISCHIEF'
            : ['fish', 'yarn', 'bell'].includes(card.kind)
              ? 'ITEM'
              : 'CAT CLASS'}
        </span>

        {card.points && (
          <span className="card-points">
            +{card.points} <span>PAW</span>
          </span>
        )}
      </span>
    </button>
  )
}

// ────────────────────────────────────────────
// MAIN APP
// ────────────────────────────────────────────

function App() {
  // ── SCREEN / UI STATE ──
  const [screen, setScreen] = useState<
    'home' | 'waiting' | 'game' | 'rules' | 'collection' | 'gameover'
  >('home')
  const [sound, setSound] = useState(true)
  const [showMenu, setShowMenu] = useState(false)

  // ── MULTIPLAYER STATE ──
  const [connected, setConnected] = useState(false)
  const [playerName, setPlayerName] = useState('')
  const [nameInput, setNameInput] = useState('')
  const [myIndex, setMyIndex] = useState(0) // 0 or 1 in the room players array
  const [roomId, setRoomId] = useState('')
  const [roomData, setRoomData] = useState<RoomData | null>(null)

  // ── GAME DISPLAY STATE (driven by server events) ──
  const [revealed, setRevealed] = useState<GameCard | undefined>(undefined)
  const [opponentRevealed, setOpponentRevealed] = useState<GameCard | undefined>(undefined)
  const [notice, setNotice] = useState('READY, KITTY?')
  const [noticeSub, setNoticeSub] = useState('Draw a card to start your turn.')
  const [isMyTurn, setIsMyTurn] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [gameOverData, setGameOverData] = useState<{
    winner: { id: string; name: string; score: number } | null
    tie: boolean
    finalScores: { name: string; score: number }[]
  } | null>(null)
  // Bell peek: privately revealed card
  const [bellPeekCard, setBellPeekCard] = useState<GameCard | null>(null)
  // Pending active item effects for MY player
  const [myPendingFish, setMyPendingFish] = useState(false)
  const [myPendingYarn, setMyPendingYarn] = useState(false)
  // Rematch request tracking
  const [rematchSent, setRematchSent] = useState(false)
  const [rematchReceivedFrom, setRematchReceivedFrom] = useState<string | null>(null)

  const socketRef = useRef(getSocket())

  const catCollection = useMemo(
    () =>
      Object.entries(CARD_INFO).filter(([key]) =>
        ['lazy', 'warrior', 'wizard', 'royal'].includes(key)
      ),
    []
  )

  // Helper: get my player data from room
  const me = roomData?.players[myIndex]
  const opponent = roomData?.players[1 - myIndex]
  const myScore = me?.score ?? 0
  const oppScore = opponent?.score ?? 0
  const myStreak = me?.streak ?? 0
  const myItems = me?.items ?? { fish: 0, yarn: 0, bell: 0 }
  const cardsLeft = roomData?.cardsLeft ?? 0
  const round = roomData?.round ?? 1

  // ── CONNECT TO SERVER ON MOUNT ──
  useEffect(() => {
    const socket = connectSocket()
    socketRef.current = socket

    socket.on('connect', () => {
      console.log('🐱 Connected to server:', socket.id)
      setConnected(true)
    })

    socket.on('disconnect', () => {
      console.log('👋 Disconnected from server')
      setConnected(false)
    })

    socket.on('name_set', (data: { name: string }) => {
      setPlayerName(data.name)
    })

    socket.on('queue_status', (_data: { position: number }) => {
      setWaiting(true)
    })

    socket.on('queue_left', () => {
      setWaiting(false)
    })

    // ── GAME START ──
    socket.on('game_start', (data: {
      roomId: string
      playerIndex: number
      room: RoomData
    }) => {
      console.log('🎮 Game started!', data)
      setRoomId(data.roomId)
      setMyIndex(data.playerIndex)
      setRoomData(data.room)
      setRevealed(undefined)
      setOpponentRevealed(undefined)
      setNotice('READY, KITTY?')
      setNoticeSub('Draw a card to start your turn.')
      setIsMyTurn(data.room.turnIndex === data.playerIndex)
      setWaiting(false)
      setGameOverData(null)
      setBellPeekCard(null)
      setMyPendingFish(false)
      setMyPendingYarn(false)
      setRematchSent(false)
      setRematchReceivedFrom(null)
      setScreen('game')
    })

    // ── DRAW RESULT ──
    socket.on('draw_result', (data: {
      playerCard: GameCard
      opponentCard: GameCard
      notice: string
      noticeSub: string
      round: number
      scores: number[]
      streaks: number[]
      items: ItemCounts[]
      pendingEffects?: { fish: boolean; yarn: boolean }[]
      turnIndex: number
      cardsLeft: number
      drawerId: string
      drawerIndex: number
    }) => {
      // Update the cards — perspective depends on who drew
      const iDrew = data.drawerId === socket.id
      setRevealed(iDrew ? data.playerCard : data.opponentCard)
      setOpponentRevealed(iDrew ? data.opponentCard : data.playerCard)
      setNotice(data.notice)
      setNoticeSub(data.noticeSub)

      // Update room data
      setRoomData(prev => {
        if (!prev) return prev
        return {
          ...prev,
          round: data.round,
          turnIndex: data.turnIndex,
          cardsLeft: data.cardsLeft,
          players: prev.players.map((p, i) => ({
            ...p,
            score: data.scores[i],
            streak: data.streaks[i],
            items: data.items[i],
          })),
        }
      })

      // Update my pending effects from server
      setMyIndex(prev => {
        if (data.pendingEffects) {
          setMyPendingFish(data.pendingEffects[prev]?.fish ?? false)
          setMyPendingYarn(data.pendingEffects[prev]?.yarn ?? false)
        }
        return prev
      })

      // Update turn after a brief delay
      setIsMyTurn(false)
      setTimeout(() => {
        setMyIndex(prev => {
          setIsMyTurn(data.turnIndex === prev)
          return prev
        })
      }, 950)
    })

    // ── GAME OVER (from draw) ──
    socket.on('game_over', (data: {
      playerCard: GameCard | null
      opponentCard: GameCard | null
      notice: string
      noticeSub: string
      round: number
      scores: number[]
      streaks: number[]
      items: ItemCounts[]
      pendingEffects?: { fish: boolean; yarn: boolean }[]
      turnIndex: number
      cardsLeft: number
      drawerId: string
      drawerIndex: number
    }) => {
      // Only update revealed cards if they exist (deck-empty game_over sends null)
      if (data.playerCard && data.opponentCard) {
        const iDrew = data.drawerId === socket.id
        setRevealed(iDrew ? data.playerCard : data.opponentCard)
        setOpponentRevealed(iDrew ? data.opponentCard : data.playerCard)
      }
      setNotice(data.notice)
      setNoticeSub(data.noticeSub)
      setIsMyTurn(false)

      setRoomData(prev => {
        if (!prev) return prev
        return {
          ...prev,
          round: data.round,
          turnIndex: data.turnIndex,
          cardsLeft: data.cardsLeft,
          status: 'finished',
          players: prev.players.map((p, i) => ({
            ...p,
            score: data.scores[i],
            streak: data.streaks[i],
            items: data.items[i],
          })),
        }
      })
    })

    // ── BELL PEEK (private, only sent to the requesting player) ──
    socket.on('bell_peek', (data: { card: GameCard; message: string }) => {
      setBellPeekCard(data.card)
      setNotice('👁 SECRET PEEK!')
      setNoticeSub(data.message)
    })

    // ── ITEMS UPDATED (after bell use) ──
    socket.on('items_updated', (data: { items: ItemCounts[] }) => {
      setRoomData(prev => {
        if (!prev) return prev
        return {
          ...prev,
          players: prev.players.map((p, i) => ({ ...p, items: data.items[i] })),
        }
      })
    })

    // ── GAME SUMMARY ──
    socket.on('game_summary', (data: {
      winner: { id: string; name: string; score: number } | null
      tie: boolean
      finalScores: { name: string; score: number }[]
      reason?: string
    }) => {
      setGameOverData(data)
      const byLimit = data.reason === 'score_limit'
      setNotice(data.tie ? 'IT\'S A TIE!' : data.winner?.id === socket.id ? 'YOU WIN! 🏆' : 'YOU LOST…')
      setNoticeSub(
        data.tie
          ? 'Both cats finished equal! A true standoff.'
          : data.winner?.id === socket.id
            ? `You reached ${data.winner.score} paws!${byLimit ? ' 30-point knockout! 🎉' : ''}`
            : `${data.winner?.name} wins with ${data.winner?.score} paws.${byLimit ? ' They hit 30! 😿' : ''}`
      )
      setScreen('gameover')
    })

    // ── OPPONENT LEFT ──
    socket.on('opponent_left', (_data: { message: string }) => {
      setNotice('OPPONENT LEFT')
      setNoticeSub('Your opponent disconnected. You win by default!')
      setIsMyTurn(false)
      setScreen('gameover')
      setGameOverData({
        winner: { id: socket.id!, name: playerName || 'YOU', score: myScore },
        tie: false,
        finalScores: [],
      })
    })

    socket.on('error_msg', (data: { message: string }) => {
      console.warn('Server error:', data.message)
    })

    socket.on('rematch_requested', (data: { from: string }) => {
      setRematchReceivedFrom(data.from)
      setNotice('REMATCH REQUEST')
      setNoticeSub(`${data.from} wants a rematch! Click Rematch to accept.`)
    })

    return () => {
      socket.removeAllListeners()
      disconnectSocket()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── ACTIONS ──

  const setName = useCallback(() => {
    const name = nameInput.trim() || 'KITTY_' + Math.random().toString(36).slice(2, 6).toUpperCase()
    socketRef.current.emit('set_name', name)
    setNameInput('')
  }, [nameInput])

  const findMatch = useCallback(() => {
    if (!playerName) {
      // Auto-set a guest name first
      const guestName = 'KITTY_' + Math.random().toString(36).slice(2, 6).toUpperCase()
      socketRef.current.emit('set_name', guestName)
    }
    socketRef.current.emit('find_match')
    setScreen('waiting')
  }, [playerName])

  const leaveQueue = useCallback(() => {
    socketRef.current.emit('leave_queue')
    setWaiting(false)
    setScreen('home')
  }, [])

  const drawCard = useCallback(() => {
    if (!isMyTurn) return
    socketRef.current.emit('draw_card')
    setIsMyTurn(false) // optimistic disable
  }, [isMyTurn])

  const useBell = useCallback(() => {
    socketRef.current.emit('use_bell')
  }, [])

  const requestRematch = useCallback(() => {
    socketRef.current.emit('request_rematch')
    setRematchSent(true)
    if (rematchReceivedFrom) {
      // Both have now requested — server will handle restart
      setNotice('STARTING REMATCH…')
      setNoticeSub('New game loading!')
    } else {
      setNotice('REMATCH REQUESTED')
      setNoticeSub('Waiting for opponent to accept…')
    }
  }, [rematchReceivedFrom])

  function resetToHome() {
    setScreen('home')
    setShowMenu(false)
    setRoomId('')
    setRoomData(null)
    setRevealed(undefined)
    setOpponentRevealed(undefined)
    setGameOverData(null)
    setBellPeekCard(null)
    setMyPendingFish(false)
    setMyPendingYarn(false)
    setRematchSent(false)
    setRematchReceivedFrom(null)
  }

  // ────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────

  return (
    <div className="app-shell min-h-screen bg-ink text-cream font-body">

      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      {/* ======================================
          HEADER
      ====================================== */}

      <header className="topbar">

        <button
          className="brand-lockup"
          onClick={resetToHome}
          aria-label="Match Cats home"
        >
          <span className="brand-mark">
            <Cat size={21} strokeWidth={2.5} />
          </span>

          <span className="brand-wordmark">
            MATCH <b>CATS</b>
            <i>™</i>
          </span>
        </button>

        <div className="topbar-right">

          <div className="online-pill">
            <span className={`online-dot${connected ? '' : ' dot-offline'}`} />
            <span>{connected ? (playerName || 'CONNECTING…') : 'OFFLINE'}</span>
          </div>

          <button
            className="icon-button"
            aria-label={sound ? 'Mute sound' : 'Enable sound'}
            onClick={() => setSound(!sound)}
          >
            {sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>

          <button
            className="icon-button mobile-menu"
            aria-label="Menu"
            onClick={() => setShowMenu(!showMenu)}
          >
            <Menu size={18} />
          </button>

        </div>
      </header>

      {/* ======================================
          MOBILE MENU
      ====================================== */}

      {showMenu && (
        <div className="mobile-nav">
          <button onClick={resetToHome}>
            <Home size={15} /> Home
          </button>
          <button onClick={() => { setScreen('rules'); setShowMenu(false) }}>
            <BookOpen size={15} /> How to play
          </button>
          <button onClick={() => { setScreen('collection'); setShowMenu(false) }}>
            <Cat size={15} /> Collection
          </button>
        </div>
      )}

      {/* ======================================
          HOME
      ====================================== */}

      {screen === 'home' && (
        <main className="home-screen">

          <div className="home-left">

            <div className="eyebrow">
              <span className="eyebrow-star">✦</span>
              A TINY GAME WITH BIG MEOW ENERGY
            </div>

            <h1>
              GOOD<br />
              <span>THINGS</span><br />
              COME IN <em>CATS.</em>
            </h1>

            <p className="hero-copy">
              Draw a card. Find your match.
              Protect your paws.<br />
              A cozy little duel of luck,
              strategy, and cats.
            </p>

            {/* ── NAME INPUT ── */}
            {!playerName && connected && (
              <div className="name-input-row" style={{
                display: 'flex', gap: '8px', alignItems: 'center',
                marginBottom: '18px',
              }}>
                <input
                  type="text"
                  maxLength={16}
                  placeholder="ENTER YOUR NAME…"
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value.toUpperCase())}
                  onKeyDown={e => e.key === 'Enter' && setName()}
                  style={{
                    flex: 1,
                    minHeight: '45px',
                    padding: '0 14px',
                    background: '#26243f',
                    border: '1px solid #484465',
                    borderRadius: '4px',
                    color: '#fff4d9',
                    fontFamily: "'Press Start 2P', monospace",
                    fontSize: '9px',
                    letterSpacing: '0.5px',
                    outline: 'none',
                  }}
                />
                <button
                  className="secondary-button"
                  onClick={setName}
                  style={{ minHeight: '45px', whiteSpace: 'nowrap' }}
                >
                  SET NAME
                </button>
              </div>
            )}

            {playerName && (
              <div style={{
                marginBottom: '18px',
                color: '#a9e7c6',
                fontFamily: "'Press Start 2P', monospace",
                fontSize: '8px',
              }}>
                PLAYING AS: <b style={{ color: '#fff4d9' }}>{playerName}</b>
              </div>
            )}

            <div className="home-actions">

              <button
                className="primary-button"
                onClick={findMatch}
                disabled={!connected}
              >
                <span>{connected ? 'FIND A MATCH' : 'CONNECTING…'}</span>
                <ChevronRight size={20} />
              </button>

              <button
                className="secondary-button"
                onClick={() => setScreen('rules')}
              >
                <CircleHelp size={17} />
                HOW TO PLAY
              </button>

            </div>

            <div className="hero-footnote">
              <span className="footnote-icon">✿</span>
              <span>
                FREE TO PLAY <b>·</b> 1V1 PvP{' '}
                <b>·</b> REAL-TIME MATCHES
              </span>
            </div>

          </div>

          <div className="home-art">

            <div className="sun-disc" />

            <span className="float-spark spark-a">✦</span>
            <span className="float-spark spark-b">✧</span>
            <span className="float-spark spark-c">✦</span>

            <div className="hero-card hero-card-back">
              <span>✦</span><span>🐾</span><span>✦</span>
            </div>

            <div className="hero-card hero-card-left">
              <span className="mini-rarity">RARE</span>
              <span className="hero-card-emoji">🐈‍⬛</span>
              <span className="mini-name">WIZARD CAT</span>
              <span className="mini-points">+3 PAW</span>
            </div>

            <div className="hero-card hero-card-right">
              <span className="mini-rarity">COMMON</span>
              <span className="hero-card-emoji">😼</span>
              <span className="mini-name">LAZY CAT</span>
              <span className="mini-points">+2 PAW</span>
            </div>

            <div className="hero-card hero-card-main">
              <span className="mini-rarity">UNCOMMON</span>
              <PixelCat />
              <span className="mini-name">WARRIOR CAT</span>
              <span className="mini-points">+4 PAW</span>
              <span className="card-shine" />
            </div>

            <div className="match-stamp">
              <Sparkles size={14} />
              <span>PURRFECT<br />MATCH!</span>
            </div>

            <div className="art-caption">
              <span className="caption-dot" />
              YOUR NEXT OBSESSION, PROBABLY
            </div>

          </div>

          <div className="home-bottom">

            <div className="bottom-stat">
              <span className="stat-icon peach-icon"><Cat size={18} /></span>
              <span><b>8 CAT TYPES</b><small>Collect them all</small></span>
            </div>

            <div className="bottom-stat">
              <span className="stat-icon lilac-icon"><Zap size={18} /></span>
              <span><b>LIVE PvP</b><small>Real opponents</small></span>
            </div>

            <div className="bottom-stat">
              <span className="stat-icon mint-icon"><Heart size={18} /></span>
              <span><b>MADE WITH MEOW</b><small>100% cat-approved</small></span>
            </div>

            <button
              className="collection-link"
              onClick={() => setScreen('collection')}
            >
              VIEW COLLECTION <ChevronRight size={16} />
            </button>

          </div>

        </main>
      )}

      {/* ======================================
          WAITING FOR MATCH
      ====================================== */}

      {screen === 'waiting' && (
        <main className="subpage" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 128px)' }}>

          <div style={{ textAlign: 'center' }}>

            <div style={{ fontSize: '60px', marginBottom: '24px', animation: 'floaty 2s ease-in-out infinite' }}>
              🐾
            </div>

            <h2 style={{
              fontFamily: "'Press Start 2P', monospace",
              fontSize: 'clamp(16px, 3vw, 24px)',
              color: '#fff4d9',
              marginBottom: '16px',
              letterSpacing: '-1px',
            }}>
              FINDING YOUR <em style={{ color: '#ff9788', fontStyle: 'normal' }}>OPPONENT</em>…
            </h2>

            <p style={{
              color: '#9a96b4',
              fontSize: '14px',
              fontWeight: 700,
              lineHeight: 1.8,
              marginBottom: '28px',
            }}>
              Waiting for another player to join the queue.<br />
              This won't take long — cats are always curious.
            </p>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              color: '#a9e7c6',
              fontFamily: "'Press Start 2P', monospace",
              fontSize: '8px',
              marginBottom: '32px',
            }}>
              <Loader size={14} style={{ animation: 'spin 1.5s linear infinite' }} />
              SEARCHING FOR CATS…
            </div>

            <button
              className="secondary-button"
              onClick={leaveQueue}
            >
              <ArrowLeft size={15} />
              CANCEL
            </button>

          </div>

        </main>
      )}

      {/* ======================================
          GAME
      ====================================== */}

      {(screen === 'game' || screen === 'gameover') && (
        <main className="game-screen">

          <div className="game-heading">

            <button className="back-link" onClick={resetToHome}>
              <ArrowLeft size={16} />
              LEAVE MATCH
            </button>

            <div className="match-status">
              <span className="online-dot" />
              <span>LIVE PvP MATCH</span>
              <span className="status-divider">/</span>
              <span>ROUND {round}</span>
            </div>

            <div className="deck-count">
              <span>🃏</span>
              {cardsLeft} CARDS LEFT
            </div>

          </div>

          {/* SCOREBOARD */}

          <div className="scoreboard">

            <div className="player-card player-you">
              <div className="player-avatar">
                <PixelCat size="small" />
              </div>

              <div className="player-info">
                <span className="player-label">
                  {me?.name || 'YOU'}{' '}
                  <span className="you-tag">YOU</span>
                </span>

                <b>
                  {myScore}{' '}
                  <small>PAWS</small>
                </b>

                <span className="player-level">
                  {isMyTurn ? '✦ YOUR TURN' : '· WAITING'}
                </span>
              </div>

              <div className="player-streak">
                {myStreak > 0 && (
                  <>
                    <span>🔥</span>
                    <b>{myStreak}</b>
                    <small>STREAK</small>
                  </>
                )}
              </div>
            </div>

            <div className="versus">
              <span>VS</span>
              <i>✦</i>
            </div>

            <div className="player-card player-opponent">
              <div className="player-info">
                <span className="player-label">
                  {opponent?.name || 'OPPONENT'}
                </span>

                <b>
                  {oppScore}{' '}
                  <small>PAWS</small>
                </b>

                <span className="player-level">
                  {!isMyTurn && screen === 'game' ? '✦ THEIR TURN' : '· WAITING'}
                </span>
              </div>

              <div className="player-avatar opponent-avatar">
                🐈‍⬛
              </div>
            </div>

          </div>

          {/* TABLE */}

          <div className="table-area">

            <div className="table-decor decor-left">✦<br />·<br />✦</div>
            <div className="table-decor decor-right">✧<br />·<br />✧</div>

            <div className="table-topline">
              <span>✿ THE COZY CORNER ✿</span>
              <span>BEST OF LUCK, LITTLE PAWS</span>
            </div>

            <div className="play-zone">

              {/* OPPONENT */}
              <div className="opponent-zone">
                <div className="zone-label">
                  <span className="zone-dot opponent-dot" />
                  OPPONENT'S CARD
                </div>
                <PixelCard
                  card={opponentRevealed}
                  faceDown={!opponentRevealed}
                  compact
                />
              </div>

              {/* NOTICE */}
              <div className="center-notice" aria-live="polite">
                <div
                  className={`notice-icon ${notice.includes('MOUSE')
                    ? 'notice-bad'
                    : notice.includes('MATCH') || notice.includes('WIN')
                      ? 'notice-good'
                      : ''
                    }`}
                >
                  {notice.includes('MOUSE')
                    ? '🐭'
                    : notice.includes('MATCH') || notice.includes('WIN')
                      ? '✨'
                      : notice.includes('LOST') || notice.includes('TIE')
                        ? '😿'
                        : '🐾'}
                </div>

                <div className="notice-title">{notice}</div>
                <div className="notice-sub">{noticeSub}</div>

                <div className="notice-line">
                  <span /><i>✦</i><span />
                </div>
              </div>

              {/* YOUR CARD */}
              <div className="your-zone">
                <div className="zone-label">
                  <span className="zone-dot your-dot" />
                  YOUR DRAW
                </div>
                <PixelCard
                  card={revealed}
                  faceDown={!revealed}
                  compact
                />
              </div>

            </div>

            <div className="table-bottomline">
              <span>✦ TAKE YOUR CHANCE ✦</span>
              <span>ROUND {round} / 10</span>
            </div>

          </div>

          {/* GAME CONTROLS */}

          <div className="game-controls">

            <div className="deck-widget">
              <div className="deck-stack">
                <span>🐾</span>
              </div>
              <div>
                <b>YOUR DECK</b>
                <small>{cardsLeft} cards remaining</small>
              </div>
            </div>

            <button
              className="draw-button"
              onClick={drawCard}
              disabled={!isMyTurn || cardsLeft === 0 || screen === 'gameover'}
            >
              <span className="draw-icon">✦</span>
              <span>
                {screen === 'gameover'
                  ? 'GAME OVER'
                  : cardsLeft === 0
                    ? 'DECK EMPTY'
                    : isMyTurn
                      ? 'DRAW A CARD'
                      : 'OPPONENT TURN…'}
                <small>
                  {screen === 'gameover'
                    ? 'The match has ended'
                    : isMyTurn
                      ? 'Fate favours the curious'
                      : 'Just a tiny moment'}
                </small>
              </span>
              <ChevronRight size={19} />
            </button>

            {/* ITEM TALLY */}
            <div className="item-slots">
              <span className="items-label">ITEMS</span>

              {/* Fish — shows pending indicator */}
              <button
                className={`item-slot${myPendingFish ? ' item-slot-active' : ''}`}
                title="Lucky Fish — next cat match +2 paws"
                onClick={() => {
                  setNotice('LUCKY FISH 🐟')
                  setNoticeSub(myPendingFish ? 'Active! Next cat match earns +2 bonus paws.' : 'Draw a Fish card to activate the bonus.')
                }}
              >
                <span>🐟</span>
                <i>{myItems.fish}</i>
                {myPendingFish && <span className="item-badge">!</span>}
              </button>

              {/* Yarn — shows pending indicator */}
              <button
                className={`item-slot${myPendingYarn ? ' item-slot-active' : ''}`}
                title="Ball of Yarn — next mouse penalty blocked"
                onClick={() => {
                  setNotice('BALL OF YARN 🧶')
                  setNoticeSub(myPendingYarn ? 'Active! The next mouse penalty is blocked.' : 'Draw a Yarn card to activate the shield.')
                }}
              >
                <span>🧶</span>
                <i>{myItems.yarn}</i>
                {myPendingYarn && <span className="item-badge">🛡</span>}
              </button>

              {/* Bell — active use button */}
              <button
                className={`item-slot${myItems.bell > 0 && isMyTurn ? ' item-slot-usable' : ''}`}
                title="Lucky Bell — use to privately peek opponent's next card"
                onClick={() => {
                  if (myItems.bell > 0 && isMyTurn) {
                    useBell()
                  } else {
                    setNotice('LUCKY BELL 🔔')
                    setNoticeSub(myItems.bell > 0 ? "Use on your turn to peek at the opponent's next card!" : 'Draw a Bell card to get this ability.')
                  }
                }}
              >
                <span>🔔</span>
                <i>{myItems.bell}</i>
                {myItems.bell > 0 && isMyTurn && <span className="item-badge">USE</span>}
              </button>
            </div>

            {/* Bell peek overlay */}
            {bellPeekCard && (
              <div className="bell-peek-toast" role="alert">
                <span>👁 PEEKED:</span>
                <span>{bellPeekCard.emoji} {bellPeekCard.name}</span>
                <button onClick={() => setBellPeekCard(null)}>✕</button>
              </div>
            )}

          </div>

          {/* GAME FOOTER */}

          <div className="game-footer">
            <span>
              <span className={`online-dot${connected ? '' : ' dot-offline'}`} />
              {connected ? 'LIVE CONNECTION' : 'RECONNECTING…'}
            </span>

            {screen === 'gameover' ? (
              <>
                <button onClick={resetToHome}>
                  <Home size={13} /> BACK TO LOBBY
                </button>
                <button
                  onClick={requestRematch}
                  disabled={rematchSent}
                  style={{ marginLeft: '8px' }}
                >
                  <RotateCcw size={13} />{' '}
                  {rematchSent
                    ? 'WAITING…'
                    : rematchReceivedFrom
                      ? `ACCEPT ${rematchReceivedFrom}'s REMATCH`
                      : 'REMATCH'}
                </button>
              </>
            ) : (
              <button onClick={resetToHome}>
                <RotateCcw size={13} /> LEAVE MATCH
              </button>
            )}

            <span>
              ROOM: <b style={{ color: '#a9e7c6' }}>{roomId.toUpperCase()}</b>
            </span>
          </div>

        </main>
      )}

      {/* ======================================
          RULES
      ====================================== */}

      {screen === 'rules' && (
        <main className="subpage">

          <button className="back-link" onClick={resetToHome}>
            <ArrowLeft size={16} /> BACK HOME
          </button>

          <div className="subpage-title">
            <span className="eyebrow">THE FIELD GUIDE</span>
            <h2>HOW TO <em>PLAY</em></h2>
            <p>Small rules. Big cat energy.</p>
          </div>

          <div className="rules-grid">

            <article className="rule-card">
              <span className="rule-number">01</span>
              <div className="rule-emoji">🃏</div>
              <h3>DRAW A CARD</h3>
              <p>Players alternate drawing two cards (one each). Whoever's turn it is draws — they get the first card, opponent gets the second.</p>
            </article>

            <article className="rule-card">
              <span className="rule-number">02</span>
              <div className="rule-emoji">🐱</div>
              <h3>FIND YOUR MATCH</h3>
              <p>If both cards share the same cat type, <b>only you</b> score the paw points. Build streaks for bonus paws: +0 / +1 / +2 / +3.</p>
            </article>

            <article className="rule-card">
              <span className="rule-number">03</span>
              <div className="rule-emoji">🐭</div>
              <h3>WATCH FOR MICE</h3>
              <p>Mice steal 3 paws and break your streak. A <b>Yarn</b> ball blocks the next mouse. Use it wisely!</p>
            </article>

            <article className="rule-card">
              <span className="rule-number">04</span>
              <div className="rule-emoji">🏆</div>
              <h3>WIN THE MATCH</h3>
              <p><b>First to 30 paws wins instantly.</b> If the deck runs out first, the highest score wins. Equal scores = draw!</p>
            </article>

            <article className="rule-card">
              <span className="rule-number">05</span>
              <div className="rule-emoji">🐟</div>
              <h3>LUCKY FISH</h3>
              <p>Drawing a Fish activates a bonus: your <b>next cat match</b> earns +2 extra paws, then the fish is consumed.</p>
            </article>

            <article className="rule-card">
              <span className="rule-number">06</span>
              <div className="rule-emoji">🔔</div>
              <h3>LUCKY BELL</h3>
              <p>Press the Bell item button on your turn to secretly peek at the opponent's next card. Consumed after use.</p>
            </article>

          </div>

          <div className="rules-bottom">
            <div>
              <Sparkles size={19} />
              <span>
                <b>TIP FROM THE CAT CAFE</b>
                <small>Streak bonuses stack fast. One mouse resets everything. Use Yarn to protect a hot streak!</small>
              </span>
            </div>
            <button className="primary-button" onClick={findMatch} disabled={!connected}>
              GOT IT, LET'S PLAY <ChevronRight size={18} />
            </button>
          </div>

        </main>
      )}

      {/* ======================================
          COLLECTION
      ====================================== */}

      {screen === 'collection' && (
        <main className="subpage collection-page">

          <button className="back-link" onClick={resetToHome}>
            <ArrowLeft size={16} /> BACK HOME
          </button>

          <div className="subpage-title">
            <span className="eyebrow">YOUR LITTLE CAT ALBUM</span>
            <h2>CAT <em>COLLECTION</em></h2>
            <p>Meet the residents of the Match Cats universe.</p>
          </div>

          <div className="collection-grid">

            {catCollection.map(([key, info]) => {
              const card = { id: Number(key), ...info } as GameCard
              return (
                <div className="collection-card" key={key}>
                  <PixelCard card={card} />
                  <div className="collection-meta">
                    <span>{info.rarity}</span>
                    <b>{info.name}</b>
                    <small>{info.points} PAW POINTS</small>
                  </div>
                </div>
              )
            })}

            {(['mouse', 'fish', 'yarn', 'bell'] as CatKind[]).map(key => (
              <div className="collection-card" key={key}>
                <PixelCard card={{ id: key.length, ...CARD_INFO[key] }} />
                <div className="collection-meta">
                  <span>{CARD_INFO[key].rarity}</span>
                  <b>{CARD_INFO[key].name}</b>
                  <small>{key === 'mouse' ? 'WATCH OUT' : 'SPECIAL ITEM'}</small>
                </div>
              </div>
            ))}

          </div>

        </main>
      )}

      {/* ======================================
          SITE FOOTER
      ====================================== */}

      <footer className="site-footer">
        <span>© 2026 MATCH CATS CLUB</span>
        <span className="footer-center">A LITTLE LUCK. A LOT OF CATS.</span>
        <span>PIXELS WITH PURPOSE <span className="footer-heart">♥</span></span>
      </footer>

    </div>
  )
}

export default App