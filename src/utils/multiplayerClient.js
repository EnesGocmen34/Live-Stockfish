// Multiplayer WebSocket Client & User Profile Manager

export function loadUserProfile() {
  try {
    const saved = localStorage.getItem('chess_user_profile');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.id) return parsed;
    }
  } catch (err) {
    console.error('Failed to load user profile:', err);
  }

  const newProfile = {
    id: 'usr_' + Math.random().toString(36).substring(2, 10),
    username: 'Oyuncu' + Math.floor(1000 + Math.random() * 9000),
    ratings: {
      bullet: 1500,
      blitz: 1500,
      rapid: 1500,
      classical: 1500,
    },
    stats: {
      wins: 0,
      losses: 0,
      draws: 0,
      total: 0,
    },
  };
  saveUserProfile(newProfile);
  return newProfile;
}

export function saveUserProfile(profile) {
  try {
    localStorage.setItem('chess_user_profile', JSON.stringify(profile));
  } catch (err) {
    console.error('Failed to save user profile:', err);
  }
}

class MultiplayerClient {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.user = loadUserProfile();
    this.callbacks = new Map();
    this.reconnectTimer = null;
    this.pingInterval = null;
    this.currentLobbyState = {
      onlineCount: 0,
      openChallenges: [],
      activeGameCount: 0,
    };
  }

  connect(customUrl = null) {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    let url = customUrl;
    if (!url) {
      if (typeof window !== 'undefined') {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        url = `${protocol}//${window.location.host}`;
      } else {
        url = 'ws://localhost:3000';
      }
    }

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.emit('connection_change', true);
        // Kimlik bildir
        this.send({ type: 'AUTH', user: this.user });

        // Ping heartbeat
        if (this.pingInterval) clearInterval(this.pingInterval);
        this.pingInterval = setInterval(() => {
          this.send({ type: 'PING' });
        }, 20000);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (err) {
          console.error('Multiplayer msg parse error:', err);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.emit('connection_change', false);
        if (this.pingInterval) clearInterval(this.pingInterval);
        // Otomatik 4 saniye sonra yeniden bağlanmayı dene
        if (!this.reconnectTimer) {
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect(customUrl);
          }, 4000);
        }
      };

      this.ws.onerror = () => {
        this.isConnected = false;
        this.emit('connection_change', false);
      };
    } catch (err) {
      console.error('WebSocket connection failed:', err);
    }
  }

  handleMessage(data) {
    switch (data.type) {
      case 'AUTH_OK':
        if (data.user) {
          // Sunucuyla puanları eşitle
          this.user.ratings = { ...this.user.ratings, ...data.user.ratings };
          saveUserProfile(this.user);
          this.emit('profile_updated', this.user);
        }
        break;

      case 'LOBBY_STATE':
        this.currentLobbyState = {
          onlineCount: data.onlineCount,
          openChallenges: data.openChallenges || [],
          activeGameCount: data.activeGameCount || 0,
        };
        this.emit('lobby_state', this.currentLobbyState);
        break;

      case 'QUEUE_WAITING':
        this.emit('queue_waiting', data);
        break;

      case 'QUEUE_CANCELLED':
        this.emit('queue_cancelled');
        break;

      case 'CHALLENGE_CREATED':
        this.emit('challenge_created', data);
        break;

      case 'GAME_START':
        this.emit('game_start', data);
        break;

      case 'OPPONENT_MOVE':
        this.emit('opponent_move', data);
        break;

      case 'GAME_OVER':
        // Profil istatistiklerini ve Elo puanını yerel olarak güncelle
        if (data.ratingChanges) {
          const myDelta =
            data.myColor === 'w'
              ? data.ratingChanges.white
              : data.ratingChanges.black;
          if (myDelta && data.category) {
            this.user.ratings[data.category] = myDelta.new;
          }
        }
        if (data.winner === 'draw') {
          this.user.stats.draws++;
        } else if (
          (data.winner === 'w' && data.myColor === 'w') ||
          (data.winner === 'b' && data.myColor === 'b')
        ) {
          this.user.stats.wins++;
        } else {
          this.user.stats.losses++;
        }
        this.user.stats.total++;
        saveUserProfile(this.user);
        this.emit('profile_updated', this.user);
        this.emit('game_over', data);
        break;

      case 'DRAW_OFFERED':
        this.emit('draw_offered', data);
        break;

      case 'DRAW_DECLINED':
        this.emit('draw_declined', data);
        break;

      case 'CHAT_MSG':
        this.emit('chat_msg', data);
        break;

      case 'ERROR':
        this.emit('error_msg', data.message);
        break;

      default:
        break;
    }
  }

  send(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  updateUsername(newName) {
    if (!newName || !newName.trim()) return;
    this.user.username = newName.trim();
    saveUserProfile(this.user);
    this.send({ type: 'AUTH', user: this.user });
    this.emit('profile_updated', this.user);
  }

  quickPair(timeControl = '3+2', rated = true) {
    this.send({ type: 'QUICK_PAIR', timeControl, rated });
  }

  cancelPair() {
    this.send({ type: 'CANCEL_PAIR' });
  }

  createChallenge({ timeMinutes, incSeconds, rated, color }) {
    this.send({
      type: 'CREATE_CHALLENGE',
      timeMinutes,
      incSeconds,
      rated,
      color,
    });
  }

  cancelChallenge(challengeId) {
    this.send({ type: 'CANCEL_CHALLENGE', challengeId });
  }

  joinChallenge(challengeId) {
    this.send({ type: 'JOIN_CHALLENGE', challengeId });
  }

  joinByCode(code) {
    this.send({ type: 'JOIN_BY_CODE', code });
  }

  sendMove({ gameId, from, to, promotion, san, fen, isCheckmate, isDraw }) {
    this.send({
      type: 'MOVE',
      gameId,
      from,
      to,
      promotion,
      san,
      fen,
      isCheckmate,
      isDraw,
    });
  }

  offerDraw(gameId) {
    this.send({ type: 'OFFER_DRAW', gameId });
  }

  respondDraw(gameId, accept) {
    this.send({ type: 'DRAW_RESPONSE', gameId, accept });
  }

  resign(gameId) {
    this.send({ type: 'RESIGN', gameId });
  }

  sendChat(gameId, text) {
    this.send({ type: 'CHAT', gameId, text });
  }

  on(event, callback) {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, []);
    }
    this.callbacks.get(event).push(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (!this.callbacks.has(event)) return;
    const list = this.callbacks.get(event).filter((cb) => cb !== callback);
    this.callbacks.set(event, list);
  }

  emit(event, data) {
    if (!this.callbacks.has(event)) return;
    for (const cb of this.callbacks.get(event)) {
      try {
        cb(data);
      } catch (err) {
        console.error(`Error in event callback for ${event}:`, err);
      }
    }
  }
}

export const multiplayerClient = new MultiplayerClient();
