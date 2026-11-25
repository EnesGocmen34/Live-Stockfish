import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// --- KALICI KULLANICI & MAÇ VERİTABANI (DATA/USERS.JSON & DATA/GAMES.JSON) ---
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const GAMES_FILE = path.join(DATA_DIR, 'games.json');

function loadUsersFromDisk() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(USERS_FILE)) {
      const raw = fs.readFileSync(USERS_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('Failed to load users from disk:', err);
  }
  return {};
}

const usersStore = loadUsersFromDisk();

function saveUsersToDisk() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(USERS_FILE, JSON.stringify(usersStore, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save users to disk:', err);
  }
}

function loadGamesFromDisk() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(GAMES_FILE)) {
      const raw = fs.readFileSync(GAMES_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('Failed to load games from disk:', err);
  }
  return {};
}

const gamesStore = loadGamesFromDisk();

function saveGamesToDisk() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    // Render Free Tier RAM/Disk optimizasyonu: En son 1000 maçı sakla
    const keys = Object.keys(gamesStore);
    if (keys.length > 1000) {
      const overflow = keys.length - 1000;
      for (let i = 0; i < overflow; i++) {
        delete gamesStore[keys[i]];
      }
    }
    fs.writeFileSync(GAMES_FILE, JSON.stringify(gamesStore, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save games to disk:', err);
  }
}

function generateGameId() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

const sessions = new Map(); // token -> userId

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + '_salt_live_sf_2026').digest('hex');
}

function toPublicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    ratings: u.ratings || { bullet: 1500, blitz: 1500, rapid: 1500, classical: 1500 },
    stats: u.stats || { wins: 0, losses: 0, draws: 0, total: 0 },
    createdAt: u.createdAt || Date.now(),
  };
}

function formatUsername(name) {
  let cleaned = (name || '').trim();
  if (!cleaned.startsWith('@')) {
    cleaned = '@' + cleaned;
  }
  return cleaned;
}

// --- REST API ENDPOINTS ---
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
    registeredUsersCount: Object.keys(usersStore).length,
    activeGames: activeGames.size,
    openChallenges: openChallenges.size
  });
});

// Kayıt Ol (Register)
app.post('/api/auth/register', (req, res) => {
  const { username, email, password } = req.body || {};
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Kullanıcı adı, e-posta ve şifre zorunludur.' });
  }

  const formattedUsername = formatUsername(username);
  if (formattedUsername.length < 4) {
    return res.status(400).json({ error: 'Kullanıcı adı en az 3 karakter olmalıdır.' });
  }
  if (!email.includes('@') || !email.includes('.')) {
    return res.status(400).json({ error: 'Geçerli bir e-posta adresi giriniz.' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Şifre en az 4 karakter olmalıdır.' });
  }

  const existingUsers = Object.values(usersStore);
  const usernameTaken = existingUsers.some(
    u => u.username.toLowerCase() === formattedUsername.toLowerCase()
  );
  if (usernameTaken) {
    return res.status(400).json({ error: 'Bu kullanıcı adı zaten alınmış!' });
  }

  const emailTaken = existingUsers.some(
    u => (u.email || '').toLowerCase() === email.trim().toLowerCase()
  );
  if (emailTaken) {
    return res.status(400).json({ error: 'Bu e-posta adresiyle kayıtlı bir hesap zaten var!' });
  }

  const userId = 'usr_' + crypto.randomBytes(6).toString('hex');
  const newUser = {
    id: userId,
    username: formattedUsername,
    email: email.trim().toLowerCase(),
    passwordHash: hashPassword(password),
    ratings: { bullet: 1500, blitz: 1500, rapid: 1500, classical: 1500 },
    stats: { wins: 0, losses: 0, draws: 0, total: 0 },
    createdAt: Date.now()
  };

  usersStore[userId] = newUser;
  saveUsersToDisk();

  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, userId);

  return res.json({
    ok: true,
    user: toPublicUser(newUser),
    token
  });
});

// Giriş Yap (Login)
app.post('/api/auth/login', (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) {
    return res.status(400).json({ error: 'Kullanıcı adı/e-posta ve şifre zorunludur.' });
  }

  const search = login.trim().toLowerCase();
  const searchFormatted = search.startsWith('@') ? search : '@' + search;
  const hash = hashPassword(password);

  const user = Object.values(usersStore).find(
    u => (u.username.toLowerCase() === search || u.username.toLowerCase() === searchFormatted || u.email.toLowerCase() === search) && u.passwordHash === hash
  );

  if (!user) {
    return res.status(401).json({ error: 'Kullanıcı adı, e-posta veya şifre hatalı!' });
  }

  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, user.id);

  return res.json({
    ok: true,
    user: toPublicUser(user),
    token
  });
});

// Mevcut Giriş Oturumunu Doğrula (Me)
app.get('/api/auth/me', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: 'Oturum bulunamadı veya süresi dolmuş.' });
  }

  const userId = sessions.get(token);
  const user = usersStore[userId];
  if (!user) {
    return res.status(401).json({ error: 'Kullanıcı bulunamadı.' });
  }

  return res.json({
    ok: true,
    user: toPublicUser(user)
  });
});

// Çıkış Yap (Logout)
app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (token) {
    sessions.delete(token);
  }
  return res.json({ ok: true });
});

// --- MAÇ GEÇMİŞİ & LICHESS TARZI /game/:id API'LARI ---
app.get('/api/games/:id', (req, res) => {
  const { id } = req.params;
  const saved = gamesStore[id];
  if (saved) {
    return res.json({ ok: true, game: saved });
  }

  const active = activeGames.get(id);
  if (active) {
    return res.json({
      ok: true,
      game: {
        id: active.id,
        status: active.status,
        white: { username: active.white.user.username, rating: active.white.rating },
        black: { username: active.black.user.username, rating: active.black.rating },
        moves: active.moves,
        fen: active.fen,
        turn: active.turn,
        category: active.category,
        timeMinutes: active.timeMinutes,
        incSeconds: active.incSeconds,
        rated: active.rated,
      }
    });
  }

  return res.status(404).json({ ok: false, error: 'Maç bulunamadı.' });
});

// Herhangi bir maçı (Bot, Analiz veya Canlı) kalıcı URL almak için kaydet
app.post('/api/games/save', (req, res) => {
  try {
    const { white, black, winner, reason, moves, fen, pgn, category, timeControl } = req.body || {};
    const gameId = generateGameId();
    const newRecord = {
      id: gameId,
      date: new Date().toISOString(),
      white: white || { username: 'Beyaz', rating: '?' },
      black: black || { username: 'Siyah', rating: '?' },
      winner: winner || 'draw',
      reason: reason || 'Kayıt',
      moves: moves || [],
      finalFen: fen || '',
      pgn: pgn || '',
      category: category || 'standard',
      timeControl: timeControl || 'Standart',
    };
    gamesStore[gameId] = newRecord;
    saveGamesToDisk();
    return res.json({ ok: true, id: gameId, url: `/game/${gameId}` });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Lichess tarzı doğrudan /game/:id linkiyle tarayıcıdan girildiğinde index.html ver
app.get('/game/:id', (_req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
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
  const gameId = generateGameId();
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

    // Canlı oturumlardaki nesneleri güncelle
    if (game.white.user.ratings) {
      game.white.user.ratings[game.category] = eloChanges.white.new;
    }
    if (game.black.user.ratings) {
      game.black.user.ratings[game.category] = eloChanges.black.new;
    }

    // KALICI VERİTABANI GÜNCELLEMESİ (users.json)
    if (usersStore[game.white.user.id]) {
      const u = usersStore[game.white.user.id];
      if (!u.ratings) u.ratings = {};
      u.ratings[game.category] = eloChanges.white.new;
      if (!u.stats) u.stats = { wins: 0, losses: 0, draws: 0, total: 0 };
      if (winner === 'w') u.stats.wins++;
      else if (winner === 'draw') u.stats.draws++;
      else u.stats.losses++;
      u.stats.total++;
    }

    if (usersStore[game.black.user.id]) {
      const u = usersStore[game.black.user.id];
      if (!u.ratings) u.ratings = {};
      u.ratings[game.category] = eloChanges.black.new;
      if (!u.stats) u.stats = { wins: 0, losses: 0, draws: 0, total: 0 };
      if (winner === 'b') u.stats.wins++;
      else if (winner === 'draw') u.stats.draws++;
      else u.stats.losses++;
      u.stats.total++;
    }

    saveUsersToDisk();
  }

  // KALICI MAÇ GEÇMİŞİ KAYDI (Lichess tarzı /game/:id)
  try {
    const savedGame = {
      id: gameId,
      date: new Date().toISOString(),
      white: {
        id: game.white.user.id,
        username: game.white.user.username,
        rating: game.white.rating
      },
      black: {
        id: game.black.user.id,
        username: game.black.user.username,
        rating: game.black.rating
      },
      winner,
      reason,
      moves: game.moves || [],
      finalFen: game.fen,
      category: game.category,
      timeMinutes: game.timeMinutes,
      incSeconds: game.incSeconds,
      rated: game.rated,
      ratingChanges: eloChanges
    };
    gamesStore[gameId] = savedGame;
    saveGamesToDisk();
  } catch (err) {
    console.error('Failed to save game record:', err);
  }

  const payload = {
    type: 'GAME_OVER',
    gameId,
    gameUrl: `/game/${gameId}`,
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
    if (game.moves.length === 0) continue;

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
    id: 'guest_' + Math.random().toString(36).substring(2, 9),
    username: '@Misafir_' + Math.floor(1000 + Math.random() * 9000),
    ratings: { bullet: 1500, blitz: 1500, rapid: 1500, classical: 1500 },
    stats: { wins: 0, losses: 0, draws: 0, total: 0 }
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
  let user = connectedUsers.get(ws);
  if (!user) return;

  switch (data.type) {
    case 'AUTH': {
      if (data.token && sessions.has(data.token)) {
        const uid = sessions.get(data.token);
        if (usersStore[uid]) {
          user = toPublicUser(usersStore[uid]);
          connectedUsers.set(ws, user);
        }
      } else if (data.user) {
        user.id = data.user.id || user.id;
        user.username = formatUsername(data.user.username || user.username);
        user.ratings = data.user.ratings || user.ratings;
        connectedUsers.set(ws, user);
      }
      sendJson(ws, { type: 'AUTH_OK', user });
      broadcastLobbyState();
      break;
    }

    case 'QUICK_PAIR': {
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
      const color = data.color || 'random';
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

      if (moverWs !== ws) return;

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
  console.log(`Lichess Stockfish Arena (Auth + Multiplayer) listening on port ${PORT}`);
});
