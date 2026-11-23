// Stockfish Single-Threaded Web Worker Yöneticisi
// Render.com ücretsiz planında 0ms ağ gecikmesi ve COOP/COEP (SharedArrayBuffer) hatası olmadan çalışır.

export const ELO_PRESETS = [
  { elo: 800, label: 'Başlangıç', badge: 'Seviye 1' },
  { elo: 1000, label: 'Amatör', badge: 'Seviye 2' },
  { elo: 1200, label: 'Kulüp Adayı', badge: 'Seviye 3' },
  { elo: 1500, label: 'Kulüp Oyuncusu', badge: 'Seviye 4' },
  { elo: 1800, label: 'Turnuva Oyuncusu', badge: 'Seviye 5' },
  { elo: 2000, label: 'Uzman (Expert)', badge: 'Seviye 6' },
  { elo: 2200, label: 'Ulusal Usta (NM)', badge: 'Seviye 7' },
  { elo: 2500, label: 'Büyükusta (GM)', badge: 'Seviye 8' },
  { elo: 2800, label: 'Süper GM (Max)', badge: 'Maksimum' },
];

export function getEngineParamsForElo(elo) {
  const clamped = Math.max(800, Math.min(2850, Number(elo) || 1500));
  // Skill Level 0..20 arası doğrusal eşleme + düşük Elo'larda derinlik & hata payı kontrolü
  const skillLevel = Math.round(((clamped - 800) / (2800 - 800)) * 20);
  let depth = 15;
  let movetime = 600;

  if (clamped <= 900) {
    depth = 2;
    movetime = 150;
  } else if (clamped <= 1100) {
    depth = 4;
    movetime = 220;
  } else if (clamped <= 1350) {
    depth = 6;
    movetime = 300;
  } else if (clamped <= 1600) {
    depth = 8;
    movetime = 400;
  } else if (clamped <= 1900) {
    depth = 11;
    movetime = 550;
  } else if (clamped <= 2200) {
    depth = 14;
    movetime = 700;
  } else if (clamped <= 2500) {
    depth = 16;
    movetime = 900;
  } else {
    depth = 18;
    movetime = 1100;
  }

  return {
    elo: clamped,
    skillLevel: Math.max(0, Math.min(20, skillLevel)),
    depth,
    movetime,
    limitStrength: clamped < 2750
  };
}

export class StockfishController {
  constructor() {
    this.worker = null;
    this.isReady = false;
    this.currentRequestId = 0;
    this.pendingMoveResolve = null;
    this.onEvalUpdate = null;
    this.currentTurnColor = 'w';
  }

  async init() {
    if (this.worker) return;

    return new Promise((resolve) => {
      try {
        this.worker = new Worker('/stockfish.js');
      } catch (err) {
        console.error('Stockfish Worker başlatılamadı:', err);
        resolve(false);
        return;
      }

      const handleMessage = (event) => {
        const line = typeof event.data === 'string' ? event.data.trim() : '';
        if (!line) return;

        if (line === 'uciok') {
          this.send('isready');
        } else if (line === 'readyok') {
          this.isReady = true;
          resolve(true);
        } else if (line.startsWith('info ') && line.includes(' score ')) {
          this.parseEvalInfo(line);
        } else if (line.startsWith('bestmove ')) {
          const parts = line.split(/\s+/);
          const bestMoveUci = parts[1];
          if (this.pendingMoveResolve) {
            const cb = this.pendingMoveResolve;
            this.pendingMoveResolve = null;
            cb(bestMoveUci && bestMoveUci !== '(none)' ? bestMoveUci : null);
          }
        }
      };

      this.worker.onmessage = handleMessage;
      this.worker.onerror = (e) => {
        console.error('Stockfish worker error:', e);
      };

      this.send('uci');
    });
  }

  send(cmd) {
    if (this.worker) {
      this.worker.postMessage(cmd);
    }
  }

  parseEvalInfo(line) {
    if (!this.onEvalUpdate) return;
    // "score cp 34" veya "score mate -2" ayrıştırması
    const mateMatch = line.match(/score mate (-?\d+)/);
    const cpMatch = line.match(/score cp (-?\d+)/);
    const depthMatch = line.match(/depth (\d+)/);
    const depth = depthMatch ? parseInt(depthMatch[1], 10) : 1;

    if (mateMatch) {
      let mateVal = parseInt(mateMatch[1], 10);
      // UCI skoru sırası gelen oyuncuya göredir; her zaman Beyaz perspektifine çevir
      if (this.currentTurnColor === 'b') mateVal = -mateVal;
      this.onEvalUpdate({
        type: 'mate',
        value: mateVal,
        depth
      });
    } else if (cpMatch) {
      let cpVal = parseInt(cpMatch[1], 10);
      if (this.currentTurnColor === 'b') cpVal = -cpVal;
      this.onEvalUpdate({
        type: 'cp',
        value: cpVal / 100, // Piyon birimi (örn. +1.25)
        depth
      });
    }
  }

  stop() {
    this.currentRequestId++;
    if (this.pendingMoveResolve) {
      const cb = this.pendingMoveResolve;
      this.pendingMoveResolve = null;
      cb(null);
    }
    if (this.worker && this.isReady) {
      this.send('stop');
    }
  }

  newGame(elo = 1500) {
    this.stop();
    if (!this.worker) return;
    const params = getEngineParamsForElo(elo);
    this.send('ucinewgame');
    this.send(`setoption name Skill Level value ${params.skillLevel}`);
    this.send(`setoption name UCI_LimitStrength value ${params.limitStrength ? 'true' : 'false'}`);
    this.send(`setoption name UCI_Elo value ${params.elo}`);
    if (params.elo < 1400) {
      // Düşük Elo'larda daha insansı taktik hatalar için
      const errProb = Math.min(900, Math.round((1500 - params.elo) * 1.1));
      this.send(`setoption name Skill Level Maximum Error value ${errProb}`);
      this.send(`setoption name Skill Level Probability value ${Math.max(10, 140 - Math.round(params.elo / 12))}`);
    }
    this.send('isready');
  }

  async getBestMove(fen, elo = 1500, turnColor = 'w') {
    await this.init();
    this.stop();

    const requestId = ++this.currentRequestId;
    this.currentTurnColor = turnColor;
    const params = getEngineParamsForElo(elo);

    this.send(`setoption name Skill Level value ${params.skillLevel}`);
    this.send(`setoption name UCI_LimitStrength value ${params.limitStrength ? 'true' : 'false'}`);
    this.send(`setoption name UCI_Elo value ${params.elo}`);
    this.send(`position fen ${fen}`);

    const rawMove = await new Promise((resolve) => {
      this.pendingMoveResolve = resolve;
      this.send(`go depth ${params.depth} movetime ${params.movetime}`);
    });

    if (requestId !== this.currentRequestId) {
      return null;
    }
    return rawMove;
  }

  async evaluatePosition(fen, turnColor = 'w') {
    await this.init();
    this.currentTurnColor = turnColor;
    this.send(`position fen ${fen}`);
    this.send('go depth 10');
  }

  destroy() {
    this.stop();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.isReady = false;
    }
  }
}
