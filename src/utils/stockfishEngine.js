// Stockfish Single-Threaded Web Worker Yöneticisi
// 1) Elo ayarlı bot maçı
// 2) Analiz Stüdyosu için en iyi devam yolları (PV) ve ok koordinatları
// 3) Maç Sonu İncelemesi (Game Review) & Toplu Hesap Analizi için %0 senkronizasyon kayması (isready/readyok bariyerli) UCI kuyruğu

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

export const MOVE_CLASSIFICATIONS = {
  best: {
    id: 'best',
    label: 'En İyi Hamle',
    symbol: '★',
    color: '#629924',
    bgClass: 'bg-[#629924]/25 text-[#8cd936] border-[#629924]',
  },
  excellent: {
    id: 'excellent',
    label: 'Çok İyi',
    symbol: '!',
    color: '#73b32b',
    bgClass: 'bg-[#73b32b]/20 text-[#9be544] border-[#73b32b]/60',
  },
  good: {
    id: 'good',
    label: 'İyi',
    symbol: '✓',
    color: '#8ca2ad',
    bgClass: 'bg-[#8ca2ad]/20 text-[#c5d6df] border-[#8ca2ad]/50',
  },
  inaccuracy: {
    id: 'inaccuracy',
    label: 'Yanlışlık (?!)',
    symbol: '?!',
    color: '#f0c15c',
    bgClass: 'bg-[#f0c15c]/20 text-[#f5d07e] border-[#f0c15c]/60',
  },
  mistake: {
    id: 'mistake',
    label: 'Hata (?)',
    symbol: '?',
    color: '#e68a2e',
    bgClass: 'bg-[#e68a2e]/20 text-[#f4a456] border-[#e68a2e]/60',
  },
  blunder: {
    id: 'blunder',
    label: 'Büyük Hata (??)',
    symbol: '??',
    color: '#db3b3b',
    bgClass: 'bg-[#db3b3b]/25 text-[#ff7373] border-[#db3b3b]/70',
  },
};

export function getEngineParamsForElo(elo) {
  const clamped = Math.max(800, Math.min(2850, Number(elo) || 1500));
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
    limitStrength: clamped < 2750,
  };
}

// Lichess kazanma olasılığı (Win%) ve Hamle Doğruluğu (% Accuracy) formülü
export function evalToWinPercentWhite(evalObj) {
  if (!evalObj) return 50;
  let cp = 0;
  if (evalObj.type === 'mate') {
    cp = evalObj.value > 0 ? 3000 : -3000;
  } else {
    cp = (evalObj.value || 0) * 100;
  }
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export function classifyMoveFromEvalDrop(
  prevEval,
  nextEval,
  moverColor,
  playedUci,
  bestMoveUci
) {
  const winBeforeWhite = evalToWinPercentWhite(prevEval);
  const winAfterWhite = evalToWinPercentWhite(nextEval);

  const winBeforeMover = moverColor === 'w' ? winBeforeWhite : 100 - winBeforeWhite;
  const winAfterMover = moverColor === 'w' ? winAfterWhite : 100 - winAfterWhite;

  const winDrop = Math.max(0, winBeforeMover - winAfterMover);

  // Lichess hamle doğruluğu formülü: 103.1668 * exp(-0.04354 * winDrop) - 3.1669
  const rawAcc = 103.1668 * Math.exp(-0.04354 * winDrop) - 3.1669;
  const accuracy = Math.max(0, Math.min(100, rawAcc));

  // Eğer motorun 1 numaralı hamlesi oynandıysa doğrudan "best"
  if (
    bestMoveUci &&
    playedUci &&
    playedUci.slice(0, 4) === bestMoveUci.slice(0, 4)
  ) {
    return {
      classification: 'best',
      accuracy: Math.max(96, accuracy),
      winDrop: 0,
    };
  }

  let classification = 'good';
  if (winDrop <= 2.2) {
    classification = 'best';
  } else if (winDrop <= 5.5) {
    classification = 'excellent';
  } else if (winDrop <= 10.5) {
    classification = 'good';
  } else if (winDrop <= 18.0) {
    classification = 'inaccuracy';
  } else if (winDrop <= 30.0) {
    classification = 'mistake';
  } else {
    classification = 'blunder';
  }

  return {
    classification,
    accuracy,
    winDrop,
  };
}

export class StockfishController {
  constructor() {
    this.worker = null;
    this.isReady = false;
    this.isSearching = false;
    this.currentRequestId = 0;
    this.pendingMoveResolve = null;
    this.readyCallbacks = [];
    this.onEvalUpdate = null;
    this.currentTurnColor = 'w';
    this.latestLines = {};
  }

  async init() {
    if (this.worker && this.isReady) return true;
    if (this.worker && !this.isReady) {
      return new Promise((resolve) => {
        this.readyCallbacks.push(() => resolve(true));
      });
    }

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

        if (line.includes('uciok')) {
          this.send('isready');
        }
        if (line.includes('readyok')) {
          this.isReady = true;
          while (this.readyCallbacks.length > 0) {
            const cb = this.readyCallbacks.shift();
            cb();
          }
          resolve(true);
        }
        if (line.startsWith('info ') && line.includes(' score ')) {
          this.parseEvalInfo(line);
        }
        if (line.startsWith('bestmove ')) {
          this.isSearching = false;
          const parts = line.split(/\s+/);
          const bestMoveUci = parts[1];
          if (this.pendingMoveResolve) {
            const cb = this.pendingMoveResolve;
            this.pendingMoveResolve = null;
            cb({
              bestMove:
                bestMoveUci && bestMoveUci !== '(none)' ? bestMoveUci : null,
              lines: Object.values(this.latestLines).sort(
                (a, b) => a.multipv - b.multipv
              ),
            });
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

  // Önceki aramanın 'bestmove' çıktısını tamamen temizleyip motorun yeni komuta %100 hazır olmasını bekler
  async syncReady() {
    await this.init();
    if (!this.worker) return;

    if (this.isSearching) {
      this.send('stop');
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.isSearching = false;
        resolve();
      }, 600);

      this.readyCallbacks.push(() => {
        clearTimeout(timeout);
        this.isSearching = false;
        resolve();
      });

      this.send('isready');
    });
  }

  parseEvalInfo(line) {
    const mateMatch = line.match(/score mate (-?\d+)/);
    const cpMatch = line.match(/score cp (-?\d+)/);
    const depthMatch = line.match(/depth (\d+)/);
    const multipvMatch = line.match(/multipv (\d+)/);
    const pvMatch = line.match(/ pv (.+)$/);

    const depth = depthMatch ? parseInt(depthMatch[1], 10) : 1;
    const multipv = multipvMatch ? parseInt(multipvMatch[1], 10) : 1;
    const pvMoves = pvMatch ? pvMatch[1].trim().split(/\s+/) : [];
    const firstMove = pvMoves[0] || null;

    let scoreObj = null;
    if (mateMatch) {
      let mateVal = parseInt(mateMatch[1], 10);
      if (this.currentTurnColor === 'b') mateVal = -mateVal;
      scoreObj = {
        type: 'mate',
        value: mateVal,
        depth,
        multipv,
        pv: pvMoves,
        bestMove: firstMove,
      };
    } else if (cpMatch) {
      let cpVal = parseInt(cpMatch[1], 10);
      if (this.currentTurnColor === 'b') cpVal = -cpVal;
      scoreObj = {
        type: 'cp',
        value: cpVal / 100,
        depth,
        multipv,
        pv: pvMoves,
        bestMove: firstMove,
      };
    }

    if (scoreObj) {
      this.latestLines[multipv] = scoreObj;
      if (this.onEvalUpdate) {
        const sortedLines = Object.values(this.latestLines).sort(
          (a, b) => a.multipv - b.multipv
        );
        this.onEvalUpdate({
          primary: sortedLines[0] || scoreObj,
          lines: sortedLines,
        });
      }
    }
  }

  stop() {
    this.currentRequestId++;
    if (this.pendingMoveResolve) {
      const cb = this.pendingMoveResolve;
      this.pendingMoveResolve = null;
      cb({ bestMove: null, lines: [] });
    }
    if (this.worker && this.isReady && this.isSearching) {
      this.send('stop');
    }
  }

  newGame(elo = 1500) {
    this.stop();
    if (!this.worker) return;
    const params = getEngineParamsForElo(elo);
    this.latestLines = {};
    this.send('ucinewgame');
    this.send('setoption name MultiPV value 1');
    this.send(`setoption name Skill Level value ${params.skillLevel}`);
    this.send(
      `setoption name UCI_LimitStrength value ${
        params.limitStrength ? 'true' : 'false'
      }`
    );
    this.send(`setoption name UCI_Elo value ${params.elo}`);
    if (params.elo < 1400) {
      const errProb = Math.min(900, Math.round((1500 - params.elo) * 1.1));
      this.send(`setoption name Skill Level Maximum Error value ${errProb}`);
      this.send(
        `setoption name Skill Level Probability value ${Math.max(
          10,
          140 - Math.round(params.elo / 12)
        )}`
      );
    }
    this.send('isready');
  }

  async getBestMove(fen, elo = 1500, turnColor = 'w') {
    const requestId = ++this.currentRequestId;
    await this.syncReady();
    if (requestId !== this.currentRequestId) return null;

    this.currentTurnColor = turnColor;
    this.latestLines = {};
    const params = getEngineParamsForElo(elo);

    this.send('setoption name MultiPV value 1');
    this.send(`setoption name Skill Level value ${params.skillLevel}`);
    this.send(
      `setoption name UCI_LimitStrength value ${
        params.limitStrength ? 'true' : 'false'
      }`
    );
    this.send(`setoption name UCI_Elo value ${params.elo}`);
    this.send(`position fen ${fen}`);

    this.isSearching = true;
    const result = await new Promise((resolve) => {
      this.pendingMoveResolve = resolve;
      this.send(`go depth ${params.depth} movetime ${params.movetime}`);
    });

    if (requestId !== this.currentRequestId) {
      return null;
    }
    return result.bestMove;
  }

  // Analiz Tahtası veya Maç Sonu İnceleme için %100 senkronize (isready bariyerli) konum analizi
  async analyzePosition(
    fen,
    turnColor = 'w',
    {
      depth = 16,
      multiPV = 3,
      movetime = 1500,
      skillLevel = 20,
      hashMb = 16,
    } = {}
  ) {
    const requestId = ++this.currentRequestId;
    await this.syncReady();
    if (requestId !== this.currentRequestId) return null;

    this.currentTurnColor = turnColor;
    this.latestLines = {};

    this.send(`setoption name Skill Level value ${skillLevel}`);
    this.send('setoption name UCI_LimitStrength value false');
    this.send(`setoption name Hash value ${hashMb}`);
    this.send(`setoption name MultiPV value ${multiPV}`);
    this.send(`position fen ${fen}`);

    this.isSearching = true;
    const result = await new Promise((resolve) => {
      this.pendingMoveResolve = resolve;
      const cmd = movetime
        ? `go depth ${depth} movetime ${movetime}`
        : `go depth ${depth}`;
      this.send(cmd);
    });

    if (requestId !== this.currentRequestId) {
      return null;
    }
    return result;
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
