import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'dist'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.wasm')) {
      res.set('Content-Type', 'application/wasm');
    }
  }
}));

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    onlineUsers: connectedUsers.size,
    activeGames: activeGames.size,
    openChallenges: openChallenges.size
  });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// --- MULTIPLAYER IN-MEMORY STATE ---
const connectedUsers = new Map(); // ws -> userData
const openChallenges = new Map(); // challengeId -> challengeData
const quickQueues = new Map();    // `${tcKey}_${rated}` -> Array<{ ws, user, tcKey, rated }>
const activeGames = new Map();    // gameId -> gameData

function getEloCategory(minutes, incSeconds) {
  const estSeconds = (minutes * 60) + (40 * incSeconds);
  if (estSeconds < 180) return 'bullet';      // < 3 dk
  if (estSeconds < 480) return 'blitz';       // < 8 dk
  if (estSeconds < 1500) return 'rapid';      // < 25 dk
  return 'classical';                         // 25+ dk
}

function calculateEloChanges(ratingW, ratingB, result) {
  // result: 1 (White win), 0 (Black win), 0.5 (Draw)
  const K = 32;
  const expW = 1 / (1 + Math.pow(10, (ratingB - ratingW) / 400));
  const expB = 1 - expW;

  const scoreW = result;
  const scoreB = 1 - result;

  const deltaW = Math.round(K * (scoreW - expW));
  const deltaB = Math.round(K * (scoreB - expB));

  return {
    white: {
      old: ratingW,
      new: Math.max(100, ratingW + deltaW),
      delta: deltaW
    },
    black: {
      old: ratingB,
      new: Math.max(100, ratingB + deltaB),
      delta: deltaB
    }
  };
}

function sendJson(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(obj));
    } catch (err) {
      console.error('WebSocket send error:', err);
    }
  }
}

function broadcastLobbyState() {
  const openList = Array.from(openChallenges.values()).map(c => ({
    id: c.id,
    code: c.code,
    creatorName: c.creator.username,
    creatorRating: c.creator.ratings[c.category] || 1500,
    category: c.category,
    timeMinutes: c.timeMinutes,
    incSeconds: c.incSeconds,
    rated: c.rated,
    color: c.color,
    createdAt: c.createdAt
  }));

  const payload = {
    type: 'LOBBY_STATE',
    onlineCount: connectedUsers.size,
    openChallenges: openList,
    activeGameCount: activeGames.size
  };

  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      sendJson(client, payload);
    }
  }
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function createGame({ playerW, playerB, timeMinutes, incSeconds, rated, challengeId = null }) {
  const gameId = 'game_' + Math.random().toString(36).substring(2, 10);
  const code = generateRoomCode();
  const category = getEloCategory(timeMinutes, incSeconds);
  const timeMs = timeMinutes * 60 * 1000;

  const ratingW = playerW.user.ratings?.[category] || 1500;
  const ratingB = playerB.user.ratings?.[category] || 1500;

  const game = {
    id: gameId,
    code,
    category,
    timeMinutes,
    incSeconds,
    rated: !!rated,
    white: {
      ws: playerW.ws,
      user: playerW.user,
      rating: ratingW,
      timeMs: timeMs
    },
    black: {
      ws: playerB.ws,
      user: playerB.user,
      rating: ratingB,
      timeMs: timeMs
    },
    turn: 'w',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    moves: [],
    lastMoveAt: Date.now(),
    status: 'active',
    drawOfferFrom: null,
    createdAt: Date.now()
  };

  activeGames.set(gameId, game);

  // Oyuncuları eşleştir ve maçı başlat
  sendJson(playerW.ws, {
    type: 'GAME_START',
    gameId,
    code,
    myColor: 'w',
    opponent: {
      id: playerB.user.id,
      username: playerB.user.username,
      rating: ratingB
    },
    timeMinutes,
    incSeconds,
    rated: !!rated,
    category,
    timeWhiteMs: timeMs,
    timeBlackMs: timeMs,
    turn: 'w'
  });

  sendJson(playerB.ws, {
    type: 'GAME_START',
    gameId,
    code,
    myColor: 'b',
    opponent: {
      id: playerW.user.id,
      username: playerW.user.username,
      rating: ratingW
    },
    timeMinutes,
    incSeconds,
    rated: !!rated,
    category,
    timeWhiteMs: timeMs,
    timeBlackMs: timeMs,
    turn: 'w'
  });

  if (challengeId) {
    openChallenges.delete(challengeId);
  }
  broadcastLobbyState();
  return game;
}

function endGame(gameId, winner, reason) {
  const game = activeGames.get(gameId);
  if (!game || game.status !== 'active') return;

  game.status = 'finished';

  let resultScore = 0.5;
  if (winner === 'w') resultScore = 1;
  else if (winner === 'b') resultScore = 0;

  let eloChanges = null;
  if (game.rated) {
    eloChanges = calculateEloChanges(game.white.rating, game.black.rating, resultScore);
    // Oyuncuların yerel nesnelerini güncelle
    if (game.white.user.ratings) {
      game.white.user.ratings[game.category] = eloChanges.white.new;
    }
    if (game.black.user.ratings) {
      game.black.user.ratings[game.category] = eloChanges.black.new;
    }
  }

  const payload = {
    type: 'GAME_OVER',
    gameId,
    winner, // 'w', 'b', 'draw'
    reason, // 'checkmate', 'timeout', 'resignation', 'draw_agreement', 'abandoned'
    ratingChanges: eloChanges,
    category: game.category
  };

  sendJson(game.white.ws, payload);
  sendJson(game.black.ws, payload);

  setTimeout(() => {
    activeGames.delete(gameId);
    broadcastLobbyState();
  }, 10000);
}

// Periyodik saat sayacı (Bayrak düşmesi / Timeout kontrolü)
setInterval(() => {
  const now = Date.now();
  for (const [gameId, game] of activeGames.entries()) {
    if (game.status !== 'active') continue;
    if (game.moves.length === 0) continue; // İlk hamle yapılana kadar süre akmaz

    const elapsed = now - game.lastMoveAt;
    if (game.turn === 'w') {
      const remaining = game.white.timeMs - elapsed;
      if (remaining <= 0) {
        game.white.timeMs = 0;
        endGame(gameId, 'b', 'timeout');
      }
    } else {
      const remaining = game.black.timeMs - elapsed;
      if (remaining <= 0) {
        game.black.timeMs = 0;
        endGame(gameId, 'w', 'timeout');
      }
    }
  }
}, 250);

// WebSocket Bağlantı Yönetimi
wss.on('connection', (ws) => {
  let currentUser = {
    id: 'user_' + Math.random().toString(36).substring(2, 9),
    username: 'Misafir_' + Math.floor(1000 + Math.random() * 9000),
    ratings: { bullet: 1500, blitz: 1500, rapid: 1500, classical: 1500 }
  };
  connectedUsers.set(ws, currentUser);

  sendJson(ws, { type: 'AUTH_OK', user: currentUser });
  broadcastLobbyState();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      handleClientMessage(ws, data);
    } catch (err) {
      console.error('Invalid WS message:', err);
    }
  });

  ws.on('close', () => {
    const user = connectedUsers.get(ws);
    connectedUsers.delete(ws);

    // Açık meydan okumalarını kaldır
    for (const [id, c] of openChallenges.entries()) {
      if (c.ws === ws) {
        openChallenges.delete(id);
      }
    }

    // Hızlı eşleşme kuyruklarından çıkar
    for (const [qKey, queue] of quickQueues.entries()) {
      quickQueues.set(qKey, queue.filter(item => item.ws !== ws));
    }

    // Devam eden maçta terk say
    for (const [gameId, game] of activeGames.entries()) {
      if (game.status === 'active') {
        if (game.white.ws === ws) {
          endGame(gameId, 'b', 'abandoned');
        } else if (game.black.ws === ws) {
          endGame(gameId, 'w', 'abandoned');
        }
      }
    }

    broadcastLobbyState();
  });
});

function handleClientMessage(ws, data) {
  const user = connectedUsers.get(ws);
  if (!user) return;

  switch (data.type) {
    case 'AUTH': {
      if (data.user) {
        user.id = data.user.id || user.id;
        user.username = data.user.username || user.username;
        user.ratings = data.user.ratings || user.ratings;
        connectedUsers.set(ws, user);
      }
      sendJson(ws, { type: 'AUTH_OK', user });
      broadcastLobbyState();
      break;
    }

    case 'QUICK_PAIR': {
      // tcKey: '1+0', '3+0', '3+2', '5+3', '10+0' vb.
      const tcKey = data.timeControl || '3+2';
      const rated = data.rated !== false;
      const parts = tcKey.split('+');
      const timeMinutes = parseFloat(parts[0]) || 3;
      const incSeconds = parseFloat(parts[1]) || 0;
      const queueKey = `${tcKey}_${rated ? 'rated' : 'casual'}`;

      if (!quickQueues.has(queueKey)) {
        quickQueues.set(queueKey, []);
      }
      const queue = quickQueues.get(queueKey).filter(item => item.ws.readyState === WebSocket.OPEN && item.ws !== ws);

      if (queue.length > 0) {
        const opponentItem = queue.shift();
        quickQueues.set(queueKey, queue);

        // Rastgele renk dağılımı
        const isWhite = Math.random() < 0.5;
        const playerW = isWhite ? { ws, user } : opponentItem;
        const playerB = isWhite ? opponentItem : { ws, user };

        createGame({
          playerW,
          playerB,
          timeMinutes,
          incSeconds,
          rated
        });
      } else {
        // Kuyrukta bekle
        quickQueues.get(queueKey).push({ ws, user, tcKey, rated, timeMinutes, incSeconds });
        sendJson(ws, { type: 'QUEUE_WAITING', tcKey, rated });
      }
      break;
    }

    case 'CANCEL_PAIR': {
      for (const [qKey, queue] of quickQueues.entries()) {
        quickQueues.set(qKey, queue.filter(item => item.ws !== ws));
      }
      sendJson(ws, { type: 'QUEUE_CANCELLED' });
      break;
    }

    case 'CREATE_CHALLENGE': {
      const timeMinutes = parseFloat(data.timeMinutes) || 3;
      const incSeconds = parseFloat(data.incSeconds) || 0;
      const rated = data.rated !== false;
      const color = data.color || 'random'; // 'w', 'b', 'random'
      const category = getEloCategory(timeMinutes, incSeconds);
      const challengeId = 'chal_' + Math.random().toString(36).substring(2, 9);
      const code = generateRoomCode();

      const challenge = {
        id: challengeId,
        code,
        ws,
        creator: user,
        timeMinutes,
        incSeconds,
        rated,
        color,
        category,
        createdAt: Date.now()
      };

      openChallenges.set(challengeId, challenge);
      sendJson(ws, { type: 'CHALLENGE_CREATED', challengeId, code });
      broadcastLobbyState();
      break;
    }

    case 'CANCEL_CHALLENGE': {
      if (data.challengeId && openChallenges.has(data.challengeId)) {
        openChallenges.delete(data.challengeId);
        broadcastLobbyState();
      }
      break;
    }

    case 'JOIN_CHALLENGE': {
      const challenge = openChallenges.get(data.challengeId);
      if (!challenge || challenge.ws === ws) return;

      let playerW, playerB;
      if (challenge.color === 'w') {
        playerW = { ws: challenge.ws, user: challenge.creator };
        playerB = { ws, user };
      } else if (challenge.color === 'b') {
        playerW = { ws, user };
        playerB = { ws: challenge.ws, user: challenge.creator };
      } else {
        const isCreatorWhite = Math.random() < 0.5;
        playerW = isCreatorWhite ? { ws: challenge.ws, user: challenge.creator } : { ws, user };
        playerB = isCreatorWhite ? { ws, user } : { ws: challenge.ws, user: challenge.creator };
      }

      createGame({
        playerW,
        playerB,
        timeMinutes: challenge.timeMinutes,
        incSeconds: challenge.incSeconds,
        rated: challenge.rated,
        challengeId: challenge.id
      });
      break;
    }

    case 'JOIN_BY_CODE': {
      const codeUpper = (data.code || '').trim().toUpperCase();
      let found = null;
      for (const c of openChallenges.values()) {
        if (c.code === codeUpper) {
          found = c;
          break;
        }
      }
      if (found && found.ws !== ws) {
        handleClientMessage(ws, { type: 'JOIN_CHALLENGE', challengeId: found.id });
      } else {
        sendJson(ws, { type: 'ERROR', message: 'Geçersiz veya süresi dolmuş oda kodu!' });
      }
      break;
    }

    case 'MOVE': {
      const game = activeGames.get(data.gameId);
      if (!game || game.status !== 'active') return;

      const isWhiteTurn = game.turn === 'w';
      const moverWs = isWhiteTurn ? game.white.ws : game.black.ws;
      const opponentWs = isWhiteTurn ? game.black.ws : game.white.ws;

      if (moverWs !== ws) return; // Yanlış oyuncu hamle yapmaya çalıştı

      const now = Date.now();
      if (game.moves.length > 0) {
        const elapsed = now - game.lastMoveAt;
        if (isWhiteTurn) {
          game.white.timeMs = Math.max(0, game.white.timeMs - elapsed) + (game.incSeconds * 1000);
        } else {
          game.black.timeMs = Math.max(0, game.black.timeMs - elapsed) + (game.incSeconds * 1000);
        }
      }
      game.lastMoveAt = now;
      game.turn = isWhiteTurn ? 'b' : 'w';
      game.fen = data.fen;
      game.moves.push({
        from: data.from,
        to: data.to,
        promotion: data.promotion,
        san: data.san
      });

      // Hamleyi rakibe ilet
      sendJson(opponentWs, {
        type: 'OPPONENT_MOVE',
        gameId: game.id,
        move: {
          from: data.from,
          to: data.to,
          promotion: data.promotion,
          san: data.san,
          fen: data.fen
        },
        timeWhiteMs: game.white.timeMs,
        timeBlackMs: game.black.timeMs,
        turn: game.turn
      });

      // Kontrol: Mat veya Beraberlik
      if (data.isCheckmate) {
        endGame(game.id, isWhiteTurn ? 'w' : 'b', 'checkmate');
      } else if (data.isDraw) {
        endGame(game.id, 'draw', 'draw_rule');
      }
      break;
    }

    case 'OFFER_DRAW': {
      const game = activeGames.get(data.gameId);
      if (!game || game.status !== 'active') return;
      const opponentWs = game.white.ws === ws ? game.black.ws : game.white.ws;
      game.drawOfferFrom = ws;
      sendJson(opponentWs, { type: 'DRAW_OFFERED', gameId: game.id });
      break;
    }

    case 'DRAW_RESPONSE': {
      const game = activeGames.get(data.gameId);
      if (!game || game.status !== 'active') return;
      if (data.accept) {
        endGame(game.id, 'draw', 'draw_agreement');
      } else {
        const opponentWs = game.white.ws === ws ? game.black.ws : game.white.ws;
        sendJson(opponentWs, { type: 'DRAW_DECLINED', gameId: game.id });
      }
      break;
    }

    case 'RESIGN': {
      const game = activeGames.get(data.gameId);
      if (!game || game.status !== 'active') return;
      const resignerColor = game.white.ws === ws ? 'w' : 'b';
      const winner = resignerColor === 'w' ? 'b' : 'w';
      endGame(game.id, winner, 'resignation');
      break;
    }

    case 'CHAT': {
      const game = activeGames.get(data.gameId);
      if (!game) return;
      const chatPayload = {
        type: 'CHAT_MSG',
        gameId: game.id,
        sender: user.username,
        text: (data.text || '').substring(0, 160),
        time: Date.now()
      };
      sendJson(game.white.ws, chatPayload);
      sendJson(game.black.ws, chatPayload);
      break;
    }

    case 'PING': {
      sendJson(ws, { type: 'PONG' });
      break;
    }

    default:
      break;
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Lichess Stockfish Arena (Multiplayer + Analysis) listening on port ${PORT}`);
});