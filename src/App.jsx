import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Chess } from 'chess.js';
import {
  RotateCcw,
  FlipHorizontal,
  Volume2,
  VolumeX,
  Copy,
  Check,
  Flag,
  Play,
  Cpu,
  Trophy,
  Activity,
  Sliders,
  Sparkles,
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Compass,
  BookOpen,
  Wrench,
  Eye,
  EyeOff,
  Trash2,
  RefreshCw,
  Award,
  Swords,
  Lock,
  BarChart3,
  Settings,
  Users,
  User,
  Clock,
  MessageSquare,
  Send,
  LogIn,
  LogOut,
  UserPlus,
  Zap,
  Share2,
  X,
} from 'lucide-react';
import ChessBoard, { BOARD_THEMES } from './components/ChessBoard.jsx';
import ChessPiece from './components/ChessPieces.jsx';
import EvalBar from './components/EvalBar.jsx';
import AccountScout from './components/AccountScout.jsx';
import MultiplayerLobby from './components/MultiplayerLobby.jsx';
import AuthModal from './components/AuthModal.jsx';
import { buildStandardPgn } from './utils/pgnExporter.js';
import {
  multiplayerClient,
  loadUserProfile,
  saveUserProfile,
} from './utils/multiplayerClient.js';
import { parseGameMovesAndTimeline } from './utils/accountAnalyzer.js';
import { soundEngine } from './utils/soundEngine.js';
import {
  StockfishController,
  ELO_PRESETS,
  MOVE_CLASSIFICATIONS,
  getEngineParamsForElo,
  classifyMoveFromEvalDrop,
} from './utils/stockfishEngine.js';
import {
  FAMOUS_OPENINGS,
  lookupOpeningBook,
  detectOpeningAndVariation,
  fetchGM2600MastersExplorer,
} from './utils/openingBook.js';

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const EMPTY_BOARD_FEN = '8/8/8/8/8/8/8/8 w - - 0 1';
const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

// Herhangi bir FEN string'ini (boş tahta dahil) 8x8 matrise dönüştürür
function parseFenToBoardMatrix(fenString) {
  const rows = (fenString || STARTING_FEN).split(' ')[0].split('/');
  const matrix = Array.from({ length: 8 }, () => Array(8).fill(null));

  rows.forEach((rowStr, rIdx) => {
    if (rIdx >= 8) return;
    let cIdx = 0;
    for (const ch of rowStr) {
      if (/\d/.test(ch)) {
        cIdx += parseInt(ch, 10);
      } else if (/[prnbqkPRNBQK]/.test(ch) && cIdx < 8) {
        const color = ch === ch.toUpperCase() ? 'w' : 'b';
        const type = ch.toLowerCase();
        const square = `${FILES[cIdx]}${RANKS[rIdx]}`;
        matrix[rIdx][cIdx] = { type, color, square };
        cIdx++;
      }
    }
  });
  return matrix;
}

// 8x8 matrisi tekrar FEN string'ine dönüştürür
function boardMatrixToFen(matrix, turnColor = 'w', castling = '-') {
  const rankStrings = [];
  for (let r = 0; r < 8; r++) {
    let empty = 0;
    let str = '';
    for (let c = 0; c < 8; c++) {
      const cell = matrix[r][c];
      if (!cell) {
        empty++;
      } else {
        if (empty > 0) {
          str += empty;
          empty = 0;
        }
        const ch = cell.color === 'w' ? cell.type.toUpperCase() : cell.type.toLowerCase();
        str += ch;
      }
    }
    if (empty > 0) str += empty;
    rankStrings.push(str);
  }
  return `${rankStrings.join('/')} ${turnColor} ${castling || '-'} - 0 1`;
}

function calculateCapturedAndAdvantage(fen) {
  const startCounts = {
    w: { p: 8, n: 2, b: 2, r: 2, q: 1 },
    b: { p: 8, n: 2, b: 2, r: 2, q: 1 },
  };
  const currentCounts = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0 },
  };

  const boardPart = (fen || STARTING_FEN).split(' ')[0];
  for (const ch of boardPart) {
    if (/[pnbrqPNBRQ]/.test(ch)) {
      const color = ch === ch.toUpperCase() ? 'w' : 'b';
      const type = ch.toLowerCase();
      currentCounts[color][type]++;
    }
  }

  const capturedByWhite = [];
  const capturedByBlack = [];
  const order = ['q', 'r', 'b', 'n', 'p'];

  for (const type of order) {
    const missingBlack = Math.max(0, startCounts.b[type] - currentCounts.b[type]);
    for (let i = 0; i < missingBlack; i++) capturedByWhite.push(type);

    const missingWhite = Math.max(0, startCounts.w[type] - currentCounts.w[type]);
    for (let i = 0; i < missingWhite; i++) capturedByBlack.push(type);
  }

  let whiteMaterial = 0;
  let blackMaterial = 0;
  for (const type of order) {
    whiteMaterial += currentCounts.w[type] * PIECE_VALUES[type];
    blackMaterial += currentCounts.b[type] * PIECE_VALUES[type];
  }

  return {
    capturedByWhite,
    capturedByBlack,
    whiteAdvantage: Math.max(0, whiteMaterial - blackMaterial),
    blackAdvantage: Math.max(0, blackMaterial - whiteMaterial),
  };
}

function inspectGameOver(chess, resignWinner = null) {
  if (resignWinner) {
    return {
      isOver: true,
      title: resignWinner === 'w' ? 'Beyaz Kazandı' : 'Siyah Kazandı',
      reason: 'Rakip Oyuncu Pes Etti (Resignation)',
      winner: resignWinner,
    };
  }

  if (!chess.isGameOver()) {
    return { isOver: false, title: '', reason: '', winner: null };
  }

  if (chess.isCheckmate()) {
    const winner = chess.turn() === 'w' ? 'b' : 'w';
    return {
      isOver: true,
      title: winner === 'w' ? 'Beyaz Şah Mat ile Kazandı!' : 'Siyah Şah Mat ile Kazandı!',
      reason: 'Şah Mat (Checkmate)',
      winner,
    };
  }

  if (chess.isStalemate()) {
    return {
      isOver: true,
      title: 'Oyun Berabere',
      reason: 'Pat (Stalemate - Yasal Hamle Yok)',
      winner: 'draw',
    };
  }

  if (chess.isThreefoldRepetition()) {
    return {
      isOver: true,
      title: 'Oyun Berabere',
      reason: 'Üç Kez Konum Tekrarı (Threefold Repetition)',
      winner: 'draw',
    };
  }

  if (chess.isInsufficientMaterial()) {
    return {
      isOver: true,
      title: 'Oyun Berabere',
      reason: 'Yetersiz Materyal (Insufficient Material)',
      winner: 'draw',
    };
  }

  if (chess.isDraw()) {
    return {
      isOver: true,
      title: 'Oyun Berabere',
      reason: '50 Hamle Kuralı (50-Move Rule)',
      winner: 'draw',
    };
  }

  return {
    isOver: true,
    title: 'Oyun Bitti',
    reason: 'Beraberlik',
    winner: 'draw',
  };
}

const EDITOR_PALETTE_PIECES = [
  { color: 'w', type: 'k', name: 'Beyaz Şah' },
  { color: 'w', type: 'q', name: 'Beyaz Vezir' },
  { color: 'w', type: 'r', name: 'Beyaz Kale' },
  { color: 'w', type: 'b', name: 'Beyaz Fil' },
  { color: 'w', type: 'n', name: 'Beyaz At' },
  { color: 'w', type: 'p', name: 'Beyaz Piyon' },
  { color: 'b', type: 'k', name: 'Siyah Şah' },
  { color: 'b', type: 'q', name: 'Siyah Vezir' },
  { color: 'b', type: 'r', name: 'Siyah Kale' },
  { color: 'b', type: 'b', name: 'Siyah Fil' },
  { color: 'b', type: 'n', name: 'Siyah At' },
  { color: 'b', type: 'p', name: 'Siyah Piyon' },
];

export default function App() {
  // Uygulama Modu: 'play' (Botla Maç) | 'analysis' (Stockfish Analiz & Açılış & Tahta Yapıcı Stüdyosu)
  const [appMode, setAppMode] = useState('play');

  // --- 1. BOT MAÇI (PLAY) REFERANS VE STATE'LERİ ---
  const gameRef = useRef(new Chess());
  const engineRef = useRef(null);
  const botTimeoutRef = useRef(null);
  const moveListEndRef = useRef(null);

  const [fen, setFen] = useState(STARTING_FEN);
  // Her hamlede oluşan FEN'lerin tam zaman çizelgesi (0 = başlangıç, 1 = 1.Beyaz hamlesi sonrası, vb.)
  const [fenTimeline, setFenTimeline] = useState([STARTING_FEN]);
  const [moveHistory, setMoveHistory] = useState([]);
  // Tıklanabilir hamle geçmişi indeksi: null ise en güncel konum, sayı ise o yarım hamle (0..moveHistory.length)
  const [viewingPly, setViewingPly] = useState(null);

  const [selectedSquare, setSelectedSquare] = useState(null);
  const [lastMove, setLastMove] = useState(null);
  const [pendingPromotion, setPendingPromotion] = useState(null);

  // Bot & Oyuncu Ayarları
  const [playerColor, setPlayerColor] = useState('w');
  const [sideChoice, setSideChoice] = useState('w');
  const [orientation, setOrientation] = useState('w');
  const [botElo, setBotElo] = useState(1500);
  const [isBotThinking, setIsBotThinking] = useState(false);
  const [engineReady, setEngineReady] = useState(false);

  // Maç Sonu İnceleme (Game Review - Doğruluk Oranı & En İyi Hamle Okları)
  const [isReviewingGame, setIsReviewingGame] = useState(false);
  const [isAnalyzingFullGame, setIsAnalyzingFullGame] = useState(false);
  const [reviewProgress, setReviewProgress] = useState(0);
  const [gameReviewData, setGameReviewData] = useState(null);
  const [showReviewArrows, setShowReviewArrows] = useState(true);
  // Chess.com / Lichess'ten içe aktarılan maçın gerçek oyuncu bilgileri
  const [importedGameMeta, setImportedGameMeta] = useState(null);

  // --- 2. STOCKFISH ANALİZ STÜDYOSU & TAHTA YAPICI STATE'LERİ ---
  const analysisGameRef = useRef(new Chess());
  const [analysisFen, setAnalysisFen] = useState(STARTING_FEN);
  const [analysisTimeline, setAnalysisTimeline] = useState([STARTING_FEN]);
  const [analysisHistory, setAnalysisHistory] = useState([]);
  const [analysisPly, setAnalysisPly] = useState(0);
  const [analysisSelectedSq, setAnalysisSelectedSq] = useState(null);
  const [analysisPendingPromo, setAnalysisPendingPromo] = useState(null);
  const [showAnalysisArrows, setShowAnalysisArrows] = useState(true);
  const [showOpeningArrows, setShowOpeningArrows] = useState(true);
  const [liveAnalysisLines, setLiveAnalysisLines] = useState([]);
  const [liveMastersOpeningData, setLiveMastersOpeningData] = useState(null);
  const [evalScore, setEvalScore] = useState({ type: 'cp', value: 0.2, depth: 12 });

  // Lichess Tarzı Özelleştirilebilir Stockfish Analiz Motoru Ayarları
  const [engineEnabled, setEngineEnabled] = useState(true);
  const [showEngineSettings, setShowEngineSettings] = useState(false);
  const [engineVariantName, setEngineVariantName] = useState('Stockfish 19 · 1MB NNUE');
  const [analysisSearchTimeSec, setAnalysisSearchTimeSec] = useState(4); // 1s .. 15s
  const [analysisMaxDepth, setAnalysisMaxDepth] = useState(18); // 8 .. 25
  const [analysisMultiPV, setAnalysisMultiPV] = useState(3); // 1 .. 5 (Çoklu varyantlar)
  const [analysisThreadsSkill, setAnalysisThreadsSkill] = useState(20); // 1 .. 20
  const [analysisHashMb, setAnalysisHashMb] = useState(16); // 16MB .. 128MB

  // Tahta Yapıcı (Board Editor)
  const [isBoardEditorOpen, setIsBoardEditorOpen] = useState(false);
  const [editorMatrix, setEditorMatrix] = useState(() => parseFenToBoardMatrix(STARTING_FEN));
  const [editorTool, setEditorTool] = useState({ color: 'w', type: 'q' }); // veya 'trash'
  const [editorTurn, setEditorTurn] = useState('w');
  const [editorError, setEditorError] = useState('');

  // Görsel & Yardımcı Ayarlar
  const [boardTheme, setBoardTheme] = useState('brown');
  const [muted, setMuted] = useState(false);
  const [resignWinner, setResignWinner] = useState(null);
  const [showResignConfirm, setShowResignConfirm] = useState(false);

  // Lichess Tarzı İnteraktif Hata İnceleme (Review Mistakes)
  const [mistakeReview, setMistakeReview] = useState(null); // { color: 'w'|'b', errors: [], currentIndex: 0 }

  // --- 3. CANLI MULTIPLAYER (ONLINE LOBİ & MAÇ) STATE'LERİ ---
  const onlineGameRef = useRef(new Chess());
  const [onlineFen, setOnlineFen] = useState(STARTING_FEN);
  const [onlineTimeline, setOnlineTimeline] = useState([STARTING_FEN]);
  const [onlineMoveHistory, setOnlineMoveHistory] = useState([]);
  const [onlineSelectedSq, setOnlineSelectedSq] = useState(null);
  const [onlinePendingPromo, setOnlinePendingPromo] = useState(null);
  const [onlineActiveGame, setOnlineActiveGame] = useState(null);
  const [onlineWaitingQueue, setOnlineWaitingQueue] = useState(null);
  const [onlineMyChallenge, setOnlineMyChallenge] = useState(null);
  const [onlineLobbyState, setOnlineLobbyState] = useState({
    onlineCount: 1,
    openChallenges: [],
    activeGameCount: 0,
  });
  const [onlineUserProfile, setOnlineUserProfile] = useState(() => loadUserProfile());
  const [onlineIsConnected, setOnlineIsConnected] = useState(false);
  const [onlineTimeWhiteMs, setOnlineTimeWhiteMs] = useState(180000);
  const [onlineTimeBlackMs, setOnlineTimeBlackMs] = useState(180000);
  const [onlineDrawOffered, setOnlineDrawOffered] = useState(false);
  const [onlineGameOverData, setOnlineGameOverData] = useState(null);
  const [onlineChatMessages, setOnlineChatMessages] = useState([]);
  const [onlineChatInput, setOnlineChatInput] = useState('');
  const [showOnlineChat, setShowOnlineChat] = useState(false);
  const [showNewGameModal, setShowNewGameModal] = useState(false);
  const [dismissGameOverModal, setDismissGameOverModal] = useState(false);
  const [copiedType, setCopiedType] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  // --- CHESS.COM TARZI PREMOVE (ÖN HAMLE) SİSTEMİ & AYARI ---
  const [premove, setPremove] = useState(null); // { from, to }
  const [premoveFrom, setPremoveFrom] = useState(null); // string | null ('e7' vb.)
  const premoveRef = useRef(null);
  const [premoveEnabled, setPremoveEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem('chess_premove_enabled');
      return saved !== null ? JSON.parse(saved) : true;
    } catch {
      return true;
    }
  });

  const togglePremove = () => {
    setPremoveEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('chess_premove_enabled', JSON.stringify(next));
      } catch {}
      if (!next) {
        setPremove(null);
        premoveRef.current = null;
        setPremoveFrom(null);
      }
      return next;
    });
  };

  // --- LICHESS TARZI /game/:id PAYLAŞMA & YÜKLEME SİSTEMİ ---
  const [sharedGameBanner, setSharedGameBanner] = useState(null);
  const [copiedShareUrl, setCopiedShareUrl] = useState(false);

  // URL'de /game/:id varsa ilgili maçı sunucudan yükle
  useEffect(() => {
    const pathname = window.location.pathname;
    const match = pathname.match(/\/game\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      const gid = match[1];
      fetch(`/api/games/${gid}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.ok && data.game) {
            loadGameRecordIntoAnalysis(data.game);
          }
        })
        .catch((err) => console.error('Failed to load shared game from URL:', err));
    }
  }, []);

  // Stockfish Web Worker Başlatma
  useEffect(() => {
    const controller = new StockfishController();
    controller.onEvalUpdate = ({ primary, lines }) => {
      if (primary) setEvalScore(primary);
      if (lines) setLiveAnalysisLines(lines);
    };
    engineRef.current = controller;

    controller.init().then((ok) => {
      setEngineReady(Boolean(ok));
      controller.newGame(botElo);
    });

    return () => {
      if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);
      controller.destroy();
    };
  }, []);

  const game = gameRef.current;
  const gameOverState = useMemo(() => inspectGameOver(game, resignWinner), [fen, resignWinner]);

  // Aktif görüntülenen yarım hamle (ply) indeksi
  const activePlayPly = viewingPly !== null ? viewingPly : moveHistory.length;
  const isViewingPastMove = activePlayPly < moveHistory.length;
  const displayedPlayFen = fenTimeline[activePlayPly] || fen;

  // Analiz modunda veya Maç Sonu İnceleme modunda ilgili konumu kullanıcının Lichess motor ayarlarıyla (Derinlik, MultiPV 1-5, Arama Süresi, Hafıza) canlı analiz et
  useEffect(() => {
    if (!engineRef.current || !engineReady) return;
    if (!engineEnabled) {
      engineRef.current.stop();
      return;
    }

    if (appMode === 'analysis' && !isBoardEditorOpen) {
      const turnColor = analysisFen.split(' ')[1] || 'w';
      engineRef.current.analyzePosition(analysisFen, turnColor, {
        depth: analysisMaxDepth,
        multiPV: analysisMultiPV,
        movetime: analysisSearchTimeSec * 1000,
        skillLevel: analysisThreadsSkill,
        hashMb: analysisHashMb,
      });
    } else if (
      appMode === 'play' &&
      (gameOverState.isOver || isReviewingGame) &&
      !isAnalyzingFullGame
    ) {
      const turnColor = displayedPlayFen.split(' ')[1] || 'w';
      engineRef.current.analyzePosition(displayedPlayFen, turnColor, {
        depth: analysisMaxDepth,
        multiPV: analysisMultiPV,
        movetime: analysisSearchTimeSec * 1000,
        skillLevel: analysisThreadsSkill,
        hashMb: analysisHashMb,
      });
    }
  }, [
    appMode,
    analysisFen,
    isBoardEditorOpen,
    displayedPlayFen,
    gameOverState.isOver,
    isReviewingGame,
    isAnalyzingFullGame,
    engineReady,
    engineEnabled,
    analysisMaxDepth,
    analysisMultiPV,
    analysisSearchTimeSec,
    analysisThreadsSkill,
    analysisHashMb,
  ]);

  // Hamle listesi güncellendiğinde en alta kaydır
  useEffect(() => {
    if (moveListEndRef.current && viewingPly === null) {
      moveListEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [moveHistory.length, viewingPly]);

  // Hamle sesini oynat
  const triggerSoundForMove = useCallback(
    (moveObj, chessInstance = gameRef.current) => {
      if (!moveObj) return;
      if (chessInstance.isGameOver()) {
        const overInfo = inspectGameOver(chessInstance, null);
        soundEngine.playGameEnd(overInfo.winner === playerColor);
        return;
      }
      if (chessInstance.inCheck()) {
        soundEngine.playCheck();
        return;
      }
      if (moveObj.flags.includes('p')) {
        soundEngine.playPromotion();
        return;
      }
      if (moveObj.flags.includes('k') || moveObj.flags.includes('q')) {
        soundEngine.playCastle();
        return;
      }
      if (moveObj.captured || moveObj.flags.includes('e')) {
        soundEngine.playCapture();
        return;
      }
      soundEngine.playMove();
    },
    [playerColor]
  );

  // --- LICHESS STİLİ HATA İNCELEME MODU (REVIEW MISTAKES) ---
  const startMistakeReview = useCallback(
    (color) => {
      if (!gameReviewData || !gameReviewData.moveAnalyses) return;
      const errors = gameReviewData.moveAnalyses.filter(
        (m) =>
          m.color === color &&
          ['inaccuracy', 'mistake', 'blunder'].includes(m.classification)
      );

      if (errors.length === 0) {
        alert(
          `${color === 'w' ? 'Beyaz' : 'Siyah'} bu maçta kusurlu hamle veya hata yapmadı!`
        );
        return;
      }

      setMistakeReview({
        color,
        errors,
        currentIndex: 0,
      });
      setViewingPly(errors[0].ply);
      setShowReviewArrows(true);
    },
    [gameReviewData]
  );

  // --- MULTIPLAYER WEBSOCKET ETKİNLİK DİNLEYİCİLERİ ---
  useEffect(() => {
    const unbindConn = multiplayerClient.on('connection_change', (connected) => {
      setOnlineIsConnected(connected);
    });
    const unbindLobby = multiplayerClient.on('lobby_state', (state) => {
      setOnlineLobbyState(state);
    });
    const unbindProfile = multiplayerClient.on('profile_updated', (profile) => {
      setOnlineUserProfile({ ...profile });
    });
    const unbindQueue = multiplayerClient.on('queue_waiting', (q) => {
      setOnlineWaitingQueue(q);
    });
    const unbindCancelQueue = multiplayerClient.on('queue_cancelled', () => {
      setOnlineWaitingQueue(null);
    });
    const unbindChalCreated = multiplayerClient.on('challenge_created', (data) => {
      setOnlineMyChallenge(data);
    });
    const unbindGameStart = multiplayerClient.on('game_start', (data) => {
      setOnlineActiveGame(data);
      setOnlineWaitingQueue(null);
      setOnlineMyChallenge(null);
      setOnlineDrawOffered(false);
      setOnlineGameOverData(null);
      setOnlineChatMessages([]);
      const newG = new Chess();
      onlineGameRef.current = newG;
      setOnlineFen(newG.fen());
      setOnlineTimeline([newG.fen()]);
      setOnlineMoveHistory([]);
      setOnlineTimeWhiteMs(data.timeWhiteMs);
      setOnlineTimeBlackMs(data.timeBlackMs);
      soundEngine.playGameStart();
    });
    const unbindOpponentMove = multiplayerClient.on('opponent_move', (data) => {
      const g = onlineGameRef.current;
      const moveRes = g.move({
        from: data.move.from,
        to: data.move.to,
        promotion: data.move.promotion,
      });
      if (moveRes) {
        setOnlineFen(g.fen());
        setOnlineTimeline((prev) => [...prev, g.fen()]);
        setOnlineMoveHistory(g.history({ verbose: true }));
        setOnlineTimeWhiteMs(data.timeWhiteMs);
        setOnlineTimeBlackMs(data.timeBlackMs);
        if (moveRes.captured) soundEngine.playCapture();
        else if (g.inCheck()) soundEngine.playCheck();
        else soundEngine.playMove();

        // CHESS.COM & LICHESS TARZI PREMOVE OTOMATİK UYGULAMA (0 MS GECİKME)
        if (premoveRef.current) {
          const pm = premoveRef.current;
          setPremove(null);
          premoveRef.current = null;
          setPremoveFrom(null);
          setTimeout(() => {
            attemptOnlineMove(pm.from, pm.to);
          }, 15);
        }
      }
    });
    const unbindDrawOffered = multiplayerClient.on('draw_offered', () => {
      setOnlineDrawOffered(true);
    });
    const unbindDrawDeclined = multiplayerClient.on('draw_declined', () => {
      alert('Rakip beraberlik teklifini reddetti.');
    });
    const unbindChat = multiplayerClient.on('chat_msg', (msg) => {
      setOnlineChatMessages((prev) => [...prev, msg]);
    });
    const unbindGameOver = multiplayerClient.on('game_over', (data) => {
      setOnlineGameOverData(data);
      setPremove(null);
      premoveRef.current = null;
      setPremoveFrom(null);
      if (data.gameId) {
        window.history.pushState(null, '', '/game/' + data.gameId);
      }
      if (data.winner === onlineActiveGame?.myColor) {
        soundEngine.playVictory();
      } else if (data.winner === 'draw') {
        soundEngine.playDraw();
      } else {
        soundEngine.playDefeat();
      }
    });

    return () => {
      unbindConn();
      unbindLobby();
      unbindProfile();
      unbindQueue();
      unbindCancelQueue();
      unbindChalCreated();
      unbindGameStart();
      unbindOpponentMove();
      unbindDrawOffered();
      unbindDrawDeclined();
      unbindChat();
      unbindGameOver();
    };
  }, [onlineActiveGame?.myColor]);

  // Canlı maçta saat sayacı (Fischer dijital saat akışı)
  useEffect(() => {
    if (appMode !== 'online' || !onlineActiveGame || onlineGameOverData) return;
    if (onlineMoveHistory.length === 0) return; // İlk hamle yapılana kadar süre akmaz

    const interval = setInterval(() => {
      const turn = onlineGameRef.current.turn();
      if (turn === 'w') {
        setOnlineTimeWhiteMs((prev) => Math.max(0, prev - 100));
      } else {
        setOnlineTimeBlackMs((prev) => Math.max(0, prev - 100));
      }
    }, 100);

    return () => clearInterval(interval);
  }, [appMode, onlineActiveGame, onlineGameOverData, onlineMoveHistory.length]);

  // Online hamle denemesi
  const attemptOnlineMove = useCallback(
    (from, to, promotion = null) => {
      if (!onlineActiveGame || onlineGameOverData) return false;
      const g = onlineGameRef.current;
      if (g.turn() !== onlineActiveGame.myColor) return false;

      // Terfi kontrolü (Premove ise zaman kaybetmemek için vezir otomatik seçilir)
      const piece = g.get(from);
      if (
        piece &&
        piece.type === 'p' &&
        ((piece.color === 'w' && to[1] === '8') ||
          (piece.color === 'b' && to[1] === '1')) &&
        !promotion
      ) {
        if (premoveRef.current) {
          promotion = 'q';
        } else {
          setOnlinePendingPromo({ from, to, color: piece.color });
          return true;
        }
      }

      try {
        const moveRes = g.move({
          from,
          to,
          promotion: promotion || undefined,
        });
        if (moveRes) {
          setOnlineFen(g.fen());
          setOnlineTimeline((prev) => [...prev, g.fen()]);
          setOnlineMoveHistory(g.history({ verbose: true }));
          setOnlineSelectedSq(null);
          setOnlinePendingPromo(null);

          if (moveRes.captured) soundEngine.playCapture();
          else if (g.inCheck()) soundEngine.playCheck();
          else soundEngine.playMove();

          multiplayerClient.sendMove({
            gameId: onlineActiveGame.gameId,
            from: moveRes.from,
            to: moveRes.to,
            promotion: moveRes.promotion,
            san: moveRes.san,
            fen: g.fen(),
            isCheckmate: g.isGameOver() && g.inCheck(),
            isDraw: g.isDraw() || g.isThreefoldRepetition(),
          });
          return true;
        }
      } catch (err) {
        console.error('Online move error:', err);
      }
      return false;
    },
    [onlineActiveGame, onlineGameOverData]
  );

  // Biten online maçı anında Stockfish Analiz Stüdyosu & Doğruluk İncelemesine Aktar
  const reviewOnlineGameWithStockfish = useCallback(() => {
    if (onlineTimeline.length <= 1) return;
    setFenTimeline([...onlineTimeline]);
    setMoveHistory([...onlineMoveHistory]);
    setViewingPly(null);
    setImportedGameMeta({
      white:
        onlineActiveGame?.myColor === 'w'
          ? onlineUserProfile.username
          : onlineActiveGame?.opponent.username,
      black:
        onlineActiveGame?.myColor === 'b'
          ? onlineUserProfile.username
          : onlineActiveGame?.opponent.username,
      date: new Date().toLocaleDateString('tr-TR'),
    });
    setOnlineActiveGame(null);
    setOnlineGameOverData(null);
    setAppMode('play');
    setIsReviewingGame(true);
    setDismissGameOverModal(true);
    setTimeout(() => {
      runFullGameAccuracyReview(onlineTimeline, onlineMoveHistory);
    }, 100);
  }, [
    onlineTimeline,
    onlineMoveHistory,
    onlineActiveGame,
    onlineUserProfile.username,
  ]);

  // --- MAÇ SONU TAM DOĞRULUK ANALİZİ (GAME REVIEW) ---
  const runFullGameAccuracyReview = useCallback(
    async (customFens = null, customMoves = null) => {
      const fens = customFens || [...fenTimeline];
      const moves = customMoves || [...moveHistory];
      if (!engineRef.current || moves.length === 0 || isAnalyzingFullGame) return;

      setIsReviewingGame(true);
      setDismissGameOverModal(true);
      setIsAnalyzingFullGame(true);
      setReviewProgress(0);

      const posEvals = [];

      // Her pozisyonu %100 senkronize (isready bariyerli) depth 8 ile değerlendir
      for (let i = 0; i < fens.length; i++) {
        const f = fens[i];
        const turnColor = f.split(' ')[1] || 'w';

        const tempCheck = new Chess(f);
        if (tempCheck.isCheckmate()) {
          const matedColor = tempCheck.turn();
          posEvals.push({
            type: 'mate',
            value: matedColor === 'w' ? -1 : 1,
            bestMove: null,
          });
          setReviewProgress(Math.round(((i + 1) / fens.length) * 100));
          continue;
        }
        if (tempCheck.isDraw() || tempCheck.isStalemate()) {
          posEvals.push({
            type: 'cp',
            value: 0,
            bestMove: null,
          });
          setReviewProgress(Math.round(((i + 1) / fens.length) * 100));
          continue;
        }

        const res = await engineRef.current.analyzePosition(f, turnColor, {
          depth: 8,
          multiPV: 1,
          movetime: 0,
        });

        const primary =
          res && res.lines && res.lines[0]
            ? res.lines[0]
            : { type: 'cp', value: 0, bestMove: res?.bestMove || null };

        posEvals.push({
          type: primary.type || 'cp',
          value: typeof primary.value === 'number' ? primary.value : 0,
          bestMove: res?.bestMove || primary.bestMove || null,
        });

        setReviewProgress(Math.round(((i + 1) / fens.length) * 100));
      }

      // Her hamleyi sınıflandır, ACPL ve Açılış/Oyun Ortası/Oyun Sonu doğruluğunu çıkar
      const moveAnalyses = [];
      const whiteAccList = [];
      const blackAccList = [];
      const cplListW = [];
      const cplListB = [];
      const phaseAcc = {
        openingW: [],
        openingB: [],
        midW: [],
        midB: [],
        endW: [],
        endB: [],
      };
      const counts = {
        w: {
          best: 0,
          excellent: 0,
          good: 0,
          inaccuracy: 0,
          mistake: 0,
          blunder: 0,
        },
        b: {
          best: 0,
          excellent: 0,
          good: 0,
          inaccuracy: 0,
          mistake: 0,
          blunder: 0,
        },
      };

      for (let i = 0; i < moves.length; i++) {
        const m = moves[i];
        const prevEval = posEvals[i];
        const nextEval = posEvals[i + 1] || prevEval;
        const playedUci = `${m.from}${m.to}${m.promotion || ''}`;
        const engineBestUci = prevEval?.bestMove || null;

        const result = classifyMoveFromEvalDrop(
          prevEval,
          nextEval,
          m.color,
          playedUci,
          engineBestUci
        );

        counts[m.color][result.classification]++;
        const moveNumber = Math.floor(i / 2) + 1;

        if (m.color === 'w') {
          whiteAccList.push(result.accuracy);
          cplListW.push(result.cpl || 0);
          if (moveNumber <= 10) phaseAcc.openingW.push(result.accuracy);
          else if (moveNumber <= 30) phaseAcc.midW.push(result.accuracy);
          else phaseAcc.endW.push(result.accuracy);
        } else {
          blackAccList.push(result.accuracy);
          cplListB.push(result.cpl || 0);
          if (moveNumber <= 10) phaseAcc.openingB.push(result.accuracy);
          else if (moveNumber <= 30) phaseAcc.midB.push(result.accuracy);
          else phaseAcc.endB.push(result.accuracy);
        }

        moveAnalyses.push({
          ply: i + 1,
          san: m.san,
          color: m.color,
          from: m.from,
          to: m.to,
          playedUci,
          bestMoveUci: engineBestUci,
          classification: result.classification,
          accuracy: Math.round(result.accuracy),
          cpl: result.cpl || 0,
          winDrop: result.winDrop || 0,
          evalAfter: nextEval,
        });
      }

      const avg = (arr, def = 100) =>
        arr.length === 0
          ? def
          : Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10;

      const totalWhiteAcc = avg(whiteAccList, 75);
      const totalBlackAcc = avg(blackAccList, 75);

      const acplW = Math.round(
        cplListW.reduce((a, b) => a + b, 0) / Math.max(1, cplListW.length)
      );
      const acplB = Math.round(
        cplListB.reduce((a, b) => a + b, 0) / Math.max(1, cplListB.length)
      );

      setGameReviewData({
        whiteAccuracy: totalWhiteAcc,
        blackAccuracy: totalBlackAcc,
        whiteAcpl: acplW,
        blackAcpl: acplB,
        phases: {
          w: {
            opening: Math.round(avg(phaseAcc.openingW, totalWhiteAcc)),
            middlegame: Math.round(avg(phaseAcc.midW, totalWhiteAcc)),
            endgame: Math.round(avg(phaseAcc.endW, 100)),
          },
          b: {
            opening: Math.round(avg(phaseAcc.openingB, totalBlackAcc)),
            middlegame: Math.round(avg(phaseAcc.midB, totalBlackAcc)),
            endgame: Math.round(avg(phaseAcc.endB, 100)),
          },
        },
        counts,
        moveAnalyses,
        posEvals,
      });

      setIsAnalyzingFullGame(false);
    },
    [fenTimeline, moveHistory, isAnalyzingFullGame]
  );

  // Bot Hamlesini Tetikle
  const triggerBotMove = useCallback(
    async (currentFen, currentElo, botColor) => {
      if (!engineRef.current || appMode !== 'play') return;
      if (gameRef.current.isGameOver()) return;

      setIsBotThinking(true);
      const startTime = performance.now();

      const bestMoveUci = await engineRef.current.getBestMove(
        currentFen,
        currentElo,
        botColor
      );

      if (
        !bestMoveUci ||
        gameRef.current.fen() !== currentFen ||
        gameRef.current.turn() !== botColor
      ) {
        setIsBotThinking(false);
        return;
      }

      const elapsed = performance.now() - startTime;
      const targetDelay = 360 + Math.floor(Math.random() * 300);
      const remainingDelay = Math.max(0, targetDelay - elapsed);

      botTimeoutRef.current = setTimeout(() => {
        if (
          gameRef.current.fen() !== currentFen ||
          gameRef.current.turn() !== botColor ||
          gameRef.current.isGameOver()
        ) {
          setIsBotThinking(false);
          return;
        }

        const from = bestMoveUci.slice(0, 2);
        const to = bestMoveUci.slice(2, 4);
        const promotion =
          bestMoveUci.length >= 5 ? bestMoveUci[4].toLowerCase() : undefined;

        try {
          const moveObj = gameRef.current.move({
            from,
            to,
            promotion: promotion || 'q',
          });

          if (moveObj) {
            const nextFen = gameRef.current.fen();
            const updatedHist = gameRef.current.history({ verbose: true });
            setFen(nextFen);
            setFenTimeline((prev) => [...prev, nextFen]);
            setMoveHistory(updatedHist);
            setViewingPly(null);
            setLastMove({ from: moveObj.from, to: moveObj.to });
            setSelectedSquare(null);
            setIsBotThinking(false);
            triggerSoundForMove(moveObj, gameRef.current);

            // PREMOVE TETİKLEMESİ (BOT MAÇI)
            if (premoveRef.current) {
              const pm = premoveRef.current;
              setPremove(null);
              premoveRef.current = null;
              setPremoveFrom(null);
              setTimeout(() => {
                attemptPlayerMove(pm.from, pm.to);
              }, 20);
            }
          } else {
            setIsBotThinking(false);
          }
        } catch {
          setIsBotThinking(false);
        }
      }, remainingDelay);
    },
    [appMode, triggerSoundForMove]
  );

  // Sıra Botta ise Otomatik Oynat (İçe aktarılmış inceleme maçında bot hamle yapmaz!)
  useEffect(() => {
    if (appMode !== 'play') return;
    if (gameOverState.isOver || isReviewingGame || importedGameMeta) {
      setIsBotThinking(false);
      return;
    }
    const currentTurn = gameRef.current.turn();
    if (currentTurn !== playerColor) {
      triggerBotMove(fen, botElo, currentTurn);
    }
  }, [
    appMode,
    fen,
    playerColor,
    botElo,
    gameOverState.isOver,
    isReviewingGame,
    importedGameMeta,
    triggerBotMove,
  ]);

  // Oyuncu Hamlesini Uygula (Maç Modu)
  const attemptPlayerMove = (fromSquare, toSquare, explicitPromotion = null) => {
    if (gameOverState.isOver || isBotThinking) return false;
    // Eğer oyuncu geçmiş bir hamleye bakıyorsa önce güncel konuma dönmesini sağla veya engelle
    if (isViewingPastMove) {
      setViewingPly(null);
      return false;
    }
    if (game.turn() !== playerColor) return false;

    const pieceOnFrom = game.get(fromSquare);
    if (!pieceOnFrom || pieceOnFrom.color !== playerColor) return false;

    let actualTarget = toSquare;
    if (pieceOnFrom.type === 'k') {
      const targetPiece = game.get(toSquare);
      if (targetPiece && targetPiece.color === playerColor && targetPiece.type === 'r') {
        if (toSquare === 'h1') actualTarget = 'g1';
        else if (toSquare === 'a1') actualTarget = 'c1';
        else if (toSquare === 'h8') actualTarget = 'g8';
        else if (toSquare === 'a8') actualTarget = 'c8';
      }
    }

    const legalMoves = game.moves({ square: fromSquare, verbose: true });
    const matchingMoves = legalMoves.filter((m) => m.to === actualTarget);
    if (matchingMoves.length === 0) return false;

    const isPromotion = matchingMoves.some((m) => m.flags.includes('p'));
    if (isPromotion && !explicitPromotion) {
      if (premoveRef.current) {
        explicitPromotion = 'q';
      } else {
        setPendingPromotion({
          from: fromSquare,
          to: actualTarget,
          color: playerColor,
        });
        return true;
      }
    }

    try {
      const moveObj = game.move({
        from: fromSquare,
        to: actualTarget,
        promotion: explicitPromotion || undefined,
      });

      if (moveObj) {
        const nextFen = game.fen();
        const updatedHist = game.history({ verbose: true });
        setFen(nextFen);
        setFenTimeline((prev) => [...prev, nextFen]);
        setMoveHistory(updatedHist);
        setViewingPly(null);
        setLastMove({ from: moveObj.from, to: moveObj.to });
        setSelectedSquare(null);
        setPendingPromotion(null);
        triggerSoundForMove(moveObj, game);
        return true;
      }
    } catch {
      return false;
    }
    return false;
  };

  // --- ANALİZ TAHTASI HAMLE UYGULAMA (SERBEST STOCKFISH ANALİZ & AÇILIŞ ÇALIŞMA) ---
  const attemptAnalysisMove = (fromSquare, toSquare, explicitPromotion = null) => {
    const aGame = analysisGameRef.current;
    const pieceOnFrom = aGame.get(fromSquare);
    if (!pieceOnFrom) return false;

    let actualTarget = toSquare;
    if (pieceOnFrom.type === 'k') {
      const targetPiece = aGame.get(toSquare);
      if (
        targetPiece &&
        targetPiece.color === pieceOnFrom.color &&
        targetPiece.type === 'r'
      ) {
        if (toSquare === 'h1') actualTarget = 'g1';
        else if (toSquare === 'a1') actualTarget = 'c1';
        else if (toSquare === 'h8') actualTarget = 'g8';
        else if (toSquare === 'a8') actualTarget = 'c8';
      }
    }

    const legalMoves = aGame.moves({ square: fromSquare, verbose: true });
    const matchingMoves = legalMoves.filter((m) => m.to === actualTarget);
    if (matchingMoves.length === 0) return false;

    const isPromotion = matchingMoves.some((m) => m.flags.includes('p'));
    if (isPromotion && !explicitPromotion) {
      setAnalysisPendingPromo({
        from: fromSquare,
        to: actualTarget,
        color: pieceOnFrom.color,
      });
      return true;
    }

    try {
      const moveObj = aGame.move({
        from: fromSquare,
        to: actualTarget,
        promotion: explicitPromotion || undefined,
      });

      if (moveObj) {
        const nextFen = aGame.fen();
        const slicedTimeline = analysisTimeline.slice(0, analysisPly + 1);
        const slicedHistory = analysisHistory.slice(0, analysisPly);

        setAnalysisTimeline([...slicedTimeline, nextFen]);
        setAnalysisHistory([...slicedHistory, moveObj]);
        setAnalysisPly(slicedTimeline.length);
        setAnalysisFen(nextFen);
        setAnalysisSelectedSq(null);
        setAnalysisPendingPromo(null);
        triggerSoundForMove(moveObj, aGame);
        return true;
      }
    } catch {
      return false;
    }
    return false;
  };

  // Analiz geçmişinde belirli bir hamleye tıklama / gitme
  const jumpToAnalysisPly = (targetPly) => {
    const clamped = Math.max(0, Math.min(analysisTimeline.length - 1, targetPly));
    const targetFen = analysisTimeline[clamped];
    try {
      analysisGameRef.current.load(targetFen);
      setAnalysisPly(clamped);
      setAnalysisFen(targetFen);
      setAnalysisSelectedSq(null);
      soundEngine.playMove();
    } catch {
      // ignore
    }
  };

  // Hazır Açılış Yükle (Açılış Çalışma Modu)
  const loadFamousOpening = (opening) => {
    const fresh = new Chess();
    const timeline = [fresh.fen()];
    const hist = [];

    for (const san of opening.moves) {
      const m = fresh.move(san);
      if (m) {
        timeline.push(fresh.fen());
        hist.push(m);
      }
    }

    analysisGameRef.current = fresh;
    setImportedGameMeta(null);
    setIsBoardEditorOpen(false);
    setAnalysisTimeline(timeline);
    setAnalysisHistory(hist);
    setAnalysisPly(timeline.length - 1);
    setAnalysisFen(fresh.fen());
    setAnalysisSelectedSq(null);
    soundEngine.playMove();
  };

  // Chess.com / Lichess Hesap Analizinden Seçilen Bir Maçı Doğrudan Serbest Analiz Stüdyosunda Aç
  const handleOpenImportedGameInAnalysis = (gameItem) => {
    if (!gameItem) return;
    const { history, fens } = parseGameMovesAndTimeline(
      gameItem.pgn,
      gameItem.movesStr
    );
    if (fens.length === 0) return;

    const loaded = new Chess();
    try {
      loaded.load(fens[0]);
    } catch {
      // ignore
    }

    analysisGameRef.current = loaded;
    setImportedGameMeta({
      whiteName: gameItem.whiteName || 'Beyaz',
      whiteRating: gameItem.whiteRating || '-',
      blackName: gameItem.blackName || 'Siyah',
      blackRating: gameItem.blackRating || '-',
      openingName: gameItem.openingName,
    });
    setOrientation(gameItem.userColor || 'w');
    setIsBoardEditorOpen(false);
    setAnalysisTimeline(fens);
    setAnalysisHistory(history);
    setAnalysisPly(0);
    setAnalysisFen(fens[0]);
    setAnalysisSelectedSq(null);
    setAppMode('analysis');
    soundEngine.playMove();
  };

  // Chess.com / Lichess Hesap Analizinden Seçilen Bir Maçı Hamle Hamle Doğruluk İnceleme (Game Review) Modunda Aç ve Analizi Otomatik Başlat
  const handleOpenImportedGameInFullReview = (gameItem) => {
    if (!gameItem) return;
    if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);
    if (engineRef.current) engineRef.current.stop();
    setIsBotThinking(false);

    const { history, fens } = parseGameMovesAndTimeline(
      gameItem.pgn,
      gameItem.movesStr
    );
    if (history.length === 0) return;

    const finalFen = fens[fens.length - 1];
    const loaded = new Chess(finalFen);

    gameRef.current = loaded;
    const lastM = history[history.length - 1];

    setImportedGameMeta({
      whiteName: gameItem.whiteName || 'Beyaz',
      whiteRating: gameItem.whiteRating || '-',
      blackName: gameItem.blackName || 'Siyah',
      blackRating: gameItem.blackRating || '-',
      openingName: gameItem.openingName,
    });
    setPlayerColor(gameItem.userColor || 'w');
    setOrientation(gameItem.userColor || 'w');
    setFen(finalFen);
    setFenTimeline(fens);
    setMoveHistory(history);
    setViewingPly(1);
    setLastMove(lastM ? { from: lastM.from, to: lastM.to } : null);
    setResignWinner(null);
    setIsReviewingGame(true);
    setDismissGameOverModal(true);
    setGameReviewData(null);
    setAppMode('play');
    soundEngine.playMove();

    // Maç yüklendikten hemen sonra otomatik hamle hamle doğruluk & hata analizini başlat
    setTimeout(() => {
      runFullGameAccuracyReview(fens, history);
    }, 80);
  };

  // Lichess tarzı /game/:id kaydı üzerinden maçı Analiz Stüdyosuna tam olarak yükleme
  const loadGameRecordIntoAnalysis = useCallback((gameRecord) => {
    if (!gameRecord) return;
    try {
      const g = new Chess();
      const movesTimeline = [STARTING_FEN];
      const moveHistoryList = [];

      if (Array.isArray(gameRecord.moves)) {
        for (const m of gameRecord.moves) {
          try {
            const res = g.move({ from: m.from, to: m.to, promotion: m.promotion || 'q' });
            if (res) {
              movesTimeline.push(g.fen());
              moveHistoryList.push(res);
            }
          } catch {
            // ignore
          }
        }
      }

      analysisGameRef.current = g;
      setAnalysisFen(movesTimeline[movesTimeline.length - 1] || STARTING_FEN);
      setAnalysisTimeline(movesTimeline);
      setAnalysisHistory(moveHistoryList);
      setAnalysisPly(movesTimeline.length - 1);
      setAnalysisSelectedSq(null);
      setIsBoardEditorOpen(false);

      const whiteName = gameRecord.white?.username || 'Beyaz';
      const blackName = gameRecord.black?.username || 'Siyah';
      const whiteRating = gameRecord.white?.rating || '?';
      const blackRating = gameRecord.black?.rating || '?';
      const resStr =
        gameRecord.winner === 'w'
          ? '1-0'
          : gameRecord.winner === 'b'
          ? '0-1'
          : '1/2-1/2';

      setImportedGameMeta({
        event: `Online Match #${gameRecord.id}`,
        site: 'live-stockfishh.onrender.com',
        date: gameRecord.date ? gameRecord.date.split('T')[0] : '2026.11.25',
        white: whiteName,
        whiteElo: whiteRating,
        black: blackName,
        blackElo: blackRating,
        result: resStr,
        termination: gameRecord.reason,
      });

      setSharedGameBanner({
        id: gameRecord.id,
        white: whiteName,
        black: blackName,
        result: resStr,
      });

      setAppMode('analysis');
      soundEngine.playGameStart();
    } catch (err) {
      console.error('Failed to load game record into analysis:', err);
    }
  }, []);

  // Aktif Maçı Sunucuya Kaydedip Lichess Tarzı Paylaşım Linki Al (/game/:id)
  const handleShareCurrentGame = async () => {
    try {
      let whiteObj = { username: 'Beyaz', rating: '?' };
      let blackObj = { username: 'Siyah', rating: '?' };
      let winner = 'draw';
      let reason = 'Kayıt';
      let moves = [];
      let fen = STARTING_FEN;
      let pgn = '';

      if (appMode === 'online' && onlineActiveGame) {
        whiteObj = {
          username:
            onlineActiveGame.myColor === 'w'
              ? onlineUserProfile.username
              : onlineActiveGame.opponent?.username,
          rating:
            onlineActiveGame.myColor === 'w'
              ? onlineUserProfile.ratings?.[onlineActiveGame.category] || 1500
              : onlineActiveGame.opponent?.rating,
        };
        blackObj = {
          username:
            onlineActiveGame.myColor === 'b'
              ? onlineUserProfile.username
              : onlineActiveGame.opponent?.username,
          rating:
            onlineActiveGame.myColor === 'b'
              ? onlineUserProfile.ratings?.[onlineActiveGame.category] || 1500
              : onlineActiveGame.opponent?.rating,
        };
        moves = onlineGameRef.current.history({ verbose: true });
        fen = onlineFen;
        pgn = onlineGameRef.current.pgn();
        if (onlineGameOverData) {
          winner = onlineGameOverData.winner;
          reason = onlineGameOverData.reason;
        }
      } else if (appMode === 'analysis') {
        whiteObj = {
          username: importedGameMeta?.white || 'Beyaz',
          rating: importedGameMeta?.whiteElo || '?',
        };
        blackObj = {
          username: importedGameMeta?.black || 'Siyah',
          rating: importedGameMeta?.blackElo || '?',
        };
        moves = analysisGameRef.current.history({ verbose: true });
        fen = analysisFen;
        pgn = analysisGameRef.current.pgn();
        reason = importedGameMeta?.termination || 'Analiz';
      } else {
        whiteObj = {
          username:
            playerColor === 'w'
              ? onlineUserProfile.username
              : `Stockfish (${botElo})`,
          rating:
            playerColor === 'w'
              ? onlineUserProfile.ratings?.blitz || 1500
              : botElo,
        };
        blackObj = {
          username:
            playerColor === 'b'
              ? onlineUserProfile.username
              : `Stockfish (${botElo})`,
          rating:
            playerColor === 'b'
              ? onlineUserProfile.ratings?.blitz || 1500
              : botElo,
        };
        moves = game.history({ verbose: true });
        fen = displayedPlayFen;
        pgn = game.pgn();
        if (gameOverState.isOver) {
          winner = gameOverState.winner;
          reason = gameOverState.reason;
        }
      }

      const res = await fetch('/api/games/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          white: whiteObj,
          black: blackObj,
          winner,
          reason,
          moves,
          fen,
          pgn,
        }),
      });
      const data = await res.json();
      if (data.ok && data.id) {
        const fullUrl = `${window.location.origin}/game/${data.id}`;
        window.history.pushState(null, '', `/game/${data.id}`);
        await navigator.clipboard.writeText(fullUrl);
        setCopiedShareUrl(true);
        setSharedGameBanner({
          id: data.id,
          white: whiteObj.username,
          black: blackObj.username,
          result: winner === 'w' ? '1-0' : winner === 'b' ? '0-1' : '1/2-1/2',
        });
        setTimeout(() => setCopiedShareUrl(false), 3000);
      }
    } catch (err) {
      console.error('Failed to save & share game:', err);
    }
  };

  // Maçı Analiz Stüdyosuna Aktar
  const openCurrentMatchInAnalysisStudio = () => {
    if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);
    if (engineRef.current) engineRef.current.stop();
    setIsBotThinking(false);

    const targetFen = displayedPlayFen;
    const cloned = new Chess();
    try {
      cloned.load(targetFen);
    } catch {
      // fallback
    }

    analysisGameRef.current = cloned;
    setAnalysisTimeline([...fenTimeline]);
    setAnalysisHistory([...moveHistory]);
    setAnalysisPly(activePlayPly);
    setAnalysisFen(targetFen);
    setIsBoardEditorOpen(false);
    setAppMode('analysis');
  };

  // Tahta Yapıcıda (Board Editor) Kareye Tıklama
  const handleEditorSquareClick = (square) => {
    const fileIdx = FILES.indexOf(square[0]);
    const rankIdx = RANKS.indexOf(square[1]);
    if (fileIdx === -1 || rankIdx === -1) return;

    setEditorError('');
    setEditorMatrix((prev) => {
      const next = prev.map((row) => [...row]);
      if (editorTool === 'trash') {
        next[rankIdx][fileIdx] = null;
      } else {
        const existing = next[rankIdx][fileIdx];
        if (
          existing &&
          existing.color === editorTool.color &&
          existing.type === editorTool.type
        ) {
          next[rankIdx][fileIdx] = null;
        } else {
          next[rankIdx][fileIdx] = {
            color: editorTool.color,
            type: editorTool.type,
            square,
          };
        }
      }
      return next;
    });
    soundEngine.playMove();
  };

  // Tahta Yapıcıdan (Board Editor) Stockfish Analizine Geç
  const applyEditorPositionToAnalysis = () => {
    const candidateFen = boardMatrixToFen(editorMatrix, editorTurn, '-');
    const testChess = new Chess();
    try {
      testChess.load(candidateFen);
    } catch (err) {
      setEditorError(
        'Geçersiz satranç konumu: Tahtada her iki tarafın da tam 1 Şahı olmalı ve piyonlar 1. veya 8. yatayda bulunmamalıdır.'
      );
      return;
    }

    analysisGameRef.current = testChess;
    setAnalysisTimeline([candidateFen]);
    setAnalysisHistory([]);
    setAnalysisPly(0);
    setAnalysisFen(candidateFen);
    setIsBoardEditorOpen(false);
    setEditorError('');
    soundEngine.playMove();
  };

  // Yeni Bot Maçı Başlat
  const startNewGame = (customSide = sideChoice, customElo = botElo) => {
    if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);
    if (engineRef.current) {
      engineRef.current.stop();
      engineRef.current.newGame(customElo);
    }

    let resolvedColor = customSide;
    if (customSide === 'random') {
      resolvedColor = Math.random() < 0.5 ? 'w' : 'b';
    }

    const freshGame = new Chess();
    gameRef.current = freshGame;

    setAppMode('play');
    setPlayerColor(resolvedColor);
    setOrientation(resolvedColor);
    setBotElo(customElo);
    setFen(freshGame.fen());
    setFenTimeline([freshGame.fen()]);
    setMoveHistory([]);
    setViewingPly(null);
    setSelectedSquare(null);
    setLastMove(null);
    setPendingPromotion(null);
    setResignWinner(null);
    setShowResignConfirm(false);
    setShowNewGameModal(false);
    setDismissGameOverModal(false);
    setIsBotThinking(false);
    setIsReviewingGame(false);
    setIsAnalyzingFullGame(false);
    setGameReviewData(null);
    setImportedGameMeta(null);
    setEvalScore({ type: 'cp', value: 0.2, depth: 10 });
    soundEngine.playMove();
  };

  // Hamle Geri Al (Takeback)
  const handleTakeback = () => {
    if (moveHistory.length === 0 || gameOverState.isOver) return;

    if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);
    if (engineRef.current) engineRef.current.stop();
    setIsBotThinking(false);
    setPendingPromotion(null);
    setViewingPly(null);

    if (game.turn() === playerColor && moveHistory.length >= 2) {
      game.undo();
      game.undo();
    } else if (game.turn() !== playerColor && moveHistory.length >= 1) {
      game.undo();
    } else {
      return;
    }

    const updatedHistory = game.history({ verbose: true });
    const prevMove = updatedHistory[updatedHistory.length - 1] || null;
    const nextFen = game.fen();

    setFen(nextFen);
    setFenTimeline((prev) => prev.slice(0, updatedHistory.length + 1));
    setMoveHistory(updatedHistory);
    setLastMove(prevMove ? { from: prevMove.from, to: prevMove.to } : null);
    setSelectedSquare(null);
    soundEngine.playMove();
  };

  // Pes Et (Resign)
  const handleConfirmResign = () => {
    if (gameOverState.isOver) return;
    if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);
    if (engineRef.current) engineRef.current.stop();
    setIsBotThinking(false);
    const winner = playerColor === 'w' ? 'b' : 'w';
    setResignWinner(winner);
    setShowResignConfirm(false);
    setDismissGameOverModal(false);
    soundEngine.playGameEnd(false);
  };

  // PGN ve FEN Kopyalama
  const handleCopy = async (type) => {
    try {
      const activeFenStr =
        appMode === 'online'
          ? onlineFen
          : appMode === 'analysis'
          ? analysisFen
          : displayedPlayFen;

      let text = '';
      if (type === 'pgn') {
        let whiteName = 'Beyaz';
        let blackName = 'Siyah';
        let whiteElo = '?';
        let blackElo = '?';
        let result = '*';
        let termination = undefined;
        let eventName = 'Live Chess Match';
        let timeControlStr = undefined;
        let targetGame = game;

        if (appMode === 'online') {
          targetGame = onlineGameRef.current || game;
          const myName = onlineUserProfile.username || 'Oyuncu';
          const myElo =
            (onlineActiveGame &&
              onlineUserProfile.ratings &&
              onlineUserProfile.ratings[onlineActiveGame.category]) ||
            1500;
          const oppName = onlineActiveGame?.opponent?.username || 'Rakip';
          const oppElo = onlineActiveGame?.opponent?.rating || 1500;

          if (onlineActiveGame?.myColor === 'w') {
            whiteName = myName;
            whiteElo = myElo;
            blackName = oppName;
            blackElo = oppElo;
          } else {
            whiteName = oppName;
            whiteElo = oppElo;
            blackName = myName;
            blackElo = myElo;
          }

          if (onlineGameOverData) {
            result =
              onlineGameOverData.winner === 'white'
                ? '1-0'
                : onlineGameOverData.winner === 'black'
                ? '0-1'
                : '1/2-1/2';
            termination = onlineGameOverData.reason || undefined;
          }

          if (onlineActiveGame) {
            timeControlStr = `${onlineActiveGame.timeMinutes * 60}+${onlineActiveGame.incSeconds}`;
            eventName = `Online ${onlineActiveGame.category?.toUpperCase() || 'Blitz'} Match`;
          }
        } else if (appMode === 'play') {
          targetGame = game;
          const userStr = onlineUserProfile.username || 'Oyuncu';
          const userElo = onlineUserProfile.ratings?.blitz || 1500;
          eventName = `vs Stockfish (${botElo} ELO)`;

          if (playerColor === 'w') {
            whiteName = userStr;
            whiteElo = userElo;
            blackName = `Stockfish (${botElo})`;
            blackElo = botElo;
          } else {
            whiteName = `Stockfish (${botElo})`;
            whiteElo = botElo;
            blackName = userStr;
            blackElo = userElo;
          }

          if (gameOverState.isOver) {
            result =
              gameOverState.winner === 'w'
                ? '1-0'
                : gameOverState.winner === 'b'
                ? '0-1'
                : '1/2-1/2';
            termination = gameOverState.reason || undefined;
          }
        } else if (appMode === 'analysis') {
          targetGame = analysisGameRef.current;
          if (importedGameMeta) {
            whiteName = importedGameMeta.white || importedGameMeta.whiteName || 'Beyaz';
            blackName = importedGameMeta.black || importedGameMeta.blackName || 'Siyah';
            whiteElo = importedGameMeta.whiteElo || importedGameMeta.whiteRating || '?';
            blackElo = importedGameMeta.blackElo || importedGameMeta.blackRating || '?';
            result = importedGameMeta.result || '*';
            eventName = importedGameMeta.event || 'İçe Aktarılan Maç Analizi';
          } else {
            eventName = 'Stockfish Analiz Stüdyosu';
            whiteName = 'Analiz Beyaz';
            blackName = 'Analiz Siyah';
          }
        }

        text = buildStandardPgn(targetGame, {
          event: eventName,
          site: 'Live-Stockfish Chess (live-stockfishh.onrender.com)',
          white: whiteName,
          black: blackName,
          whiteElo,
          blackElo,
          result,
          timeControl: timeControlStr,
          termination,
        });
      } else {
        text = activeFenStr;
      }

      await navigator.clipboard.writeText(text);
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 2000);
    } catch {
      // ignore
    }
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    soundEngine.setMuted(next);
  };

  // --- AKTİF GÖRÜNTÜLENEN TAHTA VERİLERİNİN HESAPLANMASI ---
  const activeBoardMatrix = useMemo(() => {
    if (appMode === 'online') {
      return parseFenToBoardMatrix(onlineFen);
    }
    if (appMode === 'analysis') {
      if (isBoardEditorOpen) return editorMatrix;
      return parseFenToBoardMatrix(analysisFen);
    }
    return parseFenToBoardMatrix(displayedPlayFen);
  }, [
    appMode,
    onlineFen,
    isBoardEditorOpen,
    editorMatrix,
    analysisFen,
    displayedPlayFen,
  ]);

  // Görüntülenen konumdaki son hamle vurgusu
  const displayedLastMove = useMemo(() => {
    if (appMode === 'online') {
      if (onlineMoveHistory.length === 0) return null;
      const m = onlineMoveHistory[onlineMoveHistory.length - 1];
      return m ? { from: m.from, to: m.to } : null;
    }
    if (appMode === 'analysis') {
      if (isBoardEditorOpen || analysisPly === 0) return null;
      const m = analysisHistory[analysisPly - 1];
      return m ? { from: m.from, to: m.to } : null;
    }
    if (activePlayPly === 0) return null;
    const m = moveHistory[activePlayPly - 1];
    return m ? { from: m.from, to: m.to } : lastMove;
  }, [
    appMode,
    onlineMoveHistory,
    isBoardEditorOpen,
    analysisPly,
    analysisHistory,
    activePlayPly,
    moveHistory,
    lastMove,
  ]);

  // Görüntülenen konumda şah tehdit altında mı?
  const displayedKingInCheckSquare = useMemo(() => {
    if (appMode === 'online') {
      if (!onlineGameRef.current.inCheck()) return null;
      const turnColor = onlineGameRef.current.turn();
      const b = onlineGameRef.current.board();
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const p = b[r][c];
          if (p && p.type === 'k' && p.color === turnColor) {
            return p.square;
          }
        }
      }
      return null;
    }
    const targetFen = appMode === 'analysis' ? analysisFen : displayedPlayFen;
    if (appMode === 'analysis' && isBoardEditorOpen) return null;
    try {
      const temp = new Chess(targetFen);
      if (!temp.inCheck()) return null;
      const turnColor = temp.turn();
      const b = temp.board();
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const p = b[r][c];
          if (p && p.type === 'k' && p.color === turnColor) {
            return p.square;
          }
        }
      }
    } catch {
      return null;
    }
    return null;
  }, [appMode, onlineFen, isBoardEditorOpen, analysisFen, displayedPlayFen]);

  // Seçili kare için yasal hamleler
  const activeLegalMoves = useMemo(() => {
    if (appMode === 'online') {
      if (!onlineSelectedSq || onlineGameOverData) return [];
      try {
        return onlineGameRef.current.moves({
          square: onlineSelectedSq,
          verbose: true,
        });
      } catch {
        return [];
      }
    }
    if (appMode === 'analysis') {
      if (isBoardEditorOpen || !analysisSelectedSq) return [];
      try {
        return analysisGameRef.current.moves({
          square: analysisSelectedSq,
          verbose: true,
        });
      } catch {
        return [];
      }
    }
    if (!selectedSquare || gameOverState.isOver || isViewingPastMove) return [];
    try {
      return game.moves({ square: selectedSquare, verbose: true });
    } catch {
      return [];
    }
  }, [
    appMode,
    onlineSelectedSq,
    onlineGameOverData,
    onlineFen,
    isBoardEditorOpen,
    analysisSelectedSq,
    analysisFen,
    selectedSquare,
    fen,
    gameOverState.isOver,
    isViewingPastMove,
  ]);

  // Açılış Kitabı Eşleşmesi (Analiz Modunda: Hem yerel GM2600.bin hem canlı Lichess Masters 2600+ GM Veritabanı)
  useEffect(() => {
    if (appMode !== 'analysis' || isBoardEditorOpen) return;
    let cancelled = false;
    const localBook = lookupOpeningBook(analysisFen);
    if (localBook) setLiveMastersOpeningData(localBook);

    fetchGM2600MastersExplorer(analysisFen).then((res) => {
      if (!cancelled && res) {
        setLiveMastersOpeningData(res);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [appMode, isBoardEditorOpen, analysisFen]);

  const currentOpeningBookMatch = useMemo(() => {
    if (appMode !== 'analysis' || isBoardEditorOpen) return null;
    return liveMastersOpeningData || lookupOpeningBook(analysisFen);
  }, [appMode, isBoardEditorOpen, liveMastersOpeningData, analysisFen]);

  // Oynanan Maçın veya Analiz Tahtasının Anlık GM2600 Açılış & Varyant İsmi
  const activePlayOpeningInfo = useMemo(() => {
    if (appMode === 'online') {
      return detectOpeningAndVariation(onlineMoveHistory);
    }
    return detectOpeningAndVariation(moveHistory.slice(0, activePlayPly));
  }, [appMode, onlineMoveHistory, moveHistory, activePlayPly]);

  const activeAnalysisOpeningInfo = useMemo(() => {
    const localDetected = detectOpeningAndVariation(
      analysisHistory.slice(0, analysisPly)
    );
    if (
      liveMastersOpeningData &&
      liveMastersOpeningData.name &&
      liveMastersOpeningData.name !== 'Büyükusta (GM2600) Teori Konumu'
    ) {
      return {
        eco: liveMastersOpeningData.eco || localDetected.eco,
        name: liveMastersOpeningData.name,
        variation: localDetected.variation,
        fullTitle: `${liveMastersOpeningData.eco || localDetected.eco} • ${
          liveMastersOpeningData.name
        }`,
      };
    }
    return localDetected;
  }, [analysisHistory, analysisPly, liveMastersOpeningData]);

  // TAHTA ÜZERİNDEKİ OKLAR (Stockfish En İyi Devam Yolları + Açılış Kitabı Okları + Maç Sonu İnceleme Okları)
  const boardArrows = useMemo(() => {
    const list = [];

    // 1) Maç modunda: Maç devam ederken hiçbir kopya/ok gösterilmez! Sadece maç bittiğinde / incelemede gösterilir.
    if (appMode === 'play') {
      if ((!gameOverState.isOver && !isReviewingGame) || !showReviewArrows) {
        return [];
      }

      // Eğer tam maç analizi yapıldıysa o adımda oynanan hamleyi ve motorun önerdiği en iyi hamleyi okla göster
      if (gameReviewData && activePlayPly > 0) {
        const stepAnalysis = gameReviewData.moveAnalyses[activePlayPly - 1];
        if (stepAnalysis) {
          const cls = MOVE_CLASSIFICATIONS[stepAnalysis.classification];
          // Oynanan hamle oku
          list.push({
            from: stepAnalysis.from,
            to: stepAnalysis.to,
            color: cls ? cls.color : '#629924',
            opacity: 0.85,
            strokeWidth: 2.2,
          });
          // Eğer oynanan hamle en iyi hamle değilse, motorun önerdiği en iyi hamleyi yeşil okla göster
          if (
            stepAnalysis.bestMoveUci &&
            stepAnalysis.bestMoveUci.slice(0, 4) !==
              `${stepAnalysis.from}${stepAnalysis.to}`
          ) {
            list.push({
              from: stepAnalysis.bestMoveUci.slice(0, 2),
              to: stepAnalysis.bestMoveUci.slice(2, 4),
              color: '#629924',
              opacity: 0.92,
              strokeWidth: 2.5,
              label: 'En İyi',
            });
          }
          return list;
        }
      }

      // Canlı motor okları (maç sonu serbest incelemede: seçilen Çoklu Varyant 1..5 sayısına göre)
      if (engineEnabled) {
        const arrowColors = ['#629924', '#3692e7', '#8ca2ad', '#b58863', '#9b59b6'];
        liveAnalysisLines.slice(0, analysisMultiPV).forEach((line, idx) => {
          if (line.bestMove && line.bestMove.length >= 4) {
            list.push({
              from: line.bestMove.slice(0, 2),
              to: line.bestMove.slice(2, 4),
              color: arrowColors[idx] || '#8ca2ad',
              opacity: idx === 0 ? 0.92 : Math.max(0.45, 0.8 - idx * 0.12),
              strokeWidth: idx === 0 ? 2.5 : 1.85,
            });
          }
        });
      }
      return list;
    }

    // 2) Analiz Stüdyosu Modu
    if (appMode === 'analysis' && !isBoardEditorOpen) {
      if (showAnalysisArrows && engineEnabled) {
        const arrowColors = ['#629924', '#3692e7', '#8ca2ad', '#b58863', '#9b59b6'];
        liveAnalysisLines.slice(0, analysisMultiPV).forEach((line, idx) => {
          if (line.bestMove && line.bestMove.length >= 4) {
            const scoreText =
              line.type === 'mate'
                ? `M${Math.abs(line.value)}`
                : `${line.value > 0 ? '+' : ''}${line.value.toFixed(1)}`;
            list.push({
              from: line.bestMove.slice(0, 2),
              to: line.bestMove.slice(2, 4),
              color: arrowColors[idx] || '#8ca2ad',
              opacity: idx === 0 ? 0.92 : Math.max(0.45, 0.8 - idx * 0.12),
              strokeWidth: idx === 0 ? 2.6 : 1.85,
              label: idx === 0 ? scoreText : `#${idx + 1}`,
            });
          }
        });
      }

      // Açılış Kitabı devam yolu okları (mavi/altın tonlu)
      if (showOpeningArrows && currentOpeningBookMatch) {
        currentOpeningBookMatch.continuations.forEach((cont) => {
          const alreadyDrawn = list.some(
            (a) => a.from === cont.from && a.to === cont.to
          );
          if (!alreadyDrawn) {
            list.push({
              from: cont.from,
              to: cont.to,
              color: '#f0c15c',
              opacity: 0.78,
              strokeWidth: 1.9,
              label: cont.san,
            });
          }
        });
      }
    }

    return list;
  }, [
    appMode,
    gameOverState.isOver,
    isReviewingGame,
    showReviewArrows,
    gameReviewData,
    activePlayPly,
    liveAnalysisLines,
    isBoardEditorOpen,
    showAnalysisArrows,
    showOpeningArrows,
    currentOpeningBookMatch,
    engineEnabled,
    analysisMultiPV,
  ]);

  // Maç sonu incelemede kare üzerindeki kalite rozeti (★, !, ?!, ?, ??)
  const activeMoveBadge = useMemo(() => {
    if (appMode !== 'play' || !gameReviewData || activePlayPly === 0) return null;
    const step = gameReviewData.moveAnalyses[activePlayPly - 1];
    if (!step) return null;
    const cls = MOVE_CLASSIFICATIONS[step.classification];
    if (!cls) return null;
    return {
      square: step.to,
      symbol: cls.symbol,
      color: cls.color,
      label: `${cls.label} (%${step.accuracy} Doğruluk)`,
    };
  }, [appMode, gameReviewData, activePlayPly]);

  // Eval Bar Görünürlüğü:
  // KURAL: Canlı bot maçı devam ederken Eval Bar KESİNLİKLE AÇILAMAZ! Sadece Analiz Tahtasında veya Maç Bittiğinde görünür.
  const isEvalBarAllowed =
    (appMode === 'analysis' && !isBoardEditorOpen) ||
    (appMode === 'play' && (gameOverState.isOver || isReviewingGame));

  // Gösterilecek Eval Skoru
  const displayedEvalScore = useMemo(() => {
    if (
      appMode === 'play' &&
      gameReviewData &&
      gameReviewData.posEvals &&
      gameReviewData.posEvals[activePlayPly]
    ) {
      return gameReviewData.posEvals[activePlayPly];
    }
    return evalScore;
  }, [appMode, gameReviewData, activePlayPly, evalScore]);

  // Hamle Çiftleri (Maç Modu)
  const movePairs = useMemo(() => {
    const pairs = [];
    for (let i = 0; i < moveHistory.length; i += 2) {
      pairs.push({
        moveNumber: Math.floor(i / 2) + 1,
        white: moveHistory[i],
        whitePly: i + 1,
        black: moveHistory[i + 1] || null,
        blackPly: i + 2,
      });
    }
    return pairs;
  }, [moveHistory]);

  // Hamle Çiftleri (Analiz Modu)
  const analysisMovePairs = useMemo(() => {
    const pairs = [];
    for (let i = 0; i < analysisHistory.length; i += 2) {
      pairs.push({
        moveNumber: Math.floor(i / 2) + 1,
        white: analysisHistory[i],
        whitePly: i + 1,
        black: analysisHistory[i + 1] || null,
        blackPly: i + 2,
      });
    }
    return pairs;
  }, [analysisHistory]);

  // Hamle Çiftleri (Online Mod)
  const onlineMovePairs = useMemo(() => {
    const pairs = [];
    for (let i = 0; i < onlineMoveHistory.length; i += 2) {
      pairs.push({
        moveNumber: Math.floor(i / 2) + 1,
        white: onlineMoveHistory[i],
        whitePly: i + 1,
        black: onlineMoveHistory[i + 1] || null,
        blackPly: i + 2,
      });
    }
    return pairs;
  }, [onlineMoveHistory]);

  const materialInfo = useMemo(
    () =>
      calculateCapturedAndAdvantage(
        appMode === 'online'
          ? onlineFen
          : appMode === 'analysis'
          ? analysisFen
          : displayedPlayFen
      ),
    [appMode, onlineFen, analysisFen, displayedPlayFen]
  );

  // Klavye Sol/Sağ Ok Tuşları ile Hamle Geçmişinde Gezinme
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (appMode === 'play') {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setViewingPly((prev) => {
            const cur = prev !== null ? prev : moveHistory.length;
            return Math.max(0, cur - 1);
          });
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          setViewingPly((prev) => {
            if (prev === null) return null;
            const next = prev + 1;
            return next >= moveHistory.length ? null : next;
          });
        }
      } else if (appMode === 'analysis' && !isBoardEditorOpen) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          jumpToAnalysisPly(analysisPly - 1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          jumpToAnalysisPly(analysisPly + 1);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [appMode, moveHistory.length, analysisPly, analysisTimeline.length, isBoardEditorOpen]);

  const topBarColor =
    appMode === 'online' && onlineActiveGame
      ? onlineActiveGame.myColor === 'w'
        ? 'b'
        : 'w'
      : orientation === 'w'
      ? 'b'
      : 'w';
  const bottomBarColor =
    appMode === 'online' && onlineActiveGame
      ? onlineActiveGame.myColor
      : orientation === 'w'
      ? 'w'
      : 'b';

  const formatClockMs = (ms) => {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    if (totalSec < 10) {
      const tenths = Math.floor((ms % 1000) / 100);
      return `${s}.${tenths}`;
    }
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const renderPlayerBar = (barColor) => {
    const isOnline = appMode === 'online' && !!onlineActiveGame;
    const isBot = !isOnline && barColor !== playerColor;
    const isOpponent = isOnline && barColor !== onlineActiveGame.myColor;

    const capturedList =
      barColor === 'w'
        ? materialInfo.capturedByWhite
        : materialInfo.capturedByBlack;
    const capturedPieceColor = barColor === 'w' ? 'b' : 'w';
    const advantage =
      barColor === 'w'
        ? materialInfo.whiteAdvantage
        : materialInfo.blackAdvantage;

    const currentTurn = isOnline
      ? onlineGameRef.current.turn()
      : displayedPlayFen.split(' ')[1] || 'w';
    const isActiveTurn =
      currentTurn === barColor &&
      (isOnline ? !onlineGameOverData : !gameOverState.isOver);

    const onlineTimeMs =
      barColor === 'w' ? onlineTimeWhiteMs : onlineTimeBlackMs;

    const accuracyForBar =
      gameReviewData &&
      (barColor === 'w'
        ? gameReviewData.whiteAccuracy
        : gameReviewData.blackAccuracy);

    return (
      <div
        className={`flex items-center justify-between px-3 py-2 rounded bg-[#262421] border transition-colors ${
          isActiveTurn ? 'border-[#629924]' : 'border-[#3c3934]'
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-8 h-8 rounded flex items-center justify-center border ${
              isOnline
                ? isOpponent
                  ? 'bg-[#302e2c] border-amber-500/60 text-amber-400'
                  : 'bg-[#302e2c] border-[#3692e7]/60 text-[#3692e7]'
                : isBot
                ? 'bg-[#302e2c] border-[#629924]/60 text-[#629924]'
                : 'bg-[#302e2c] border-[#3692e7]/60 text-[#3692e7]'
            }`}
          >
            {isOnline ? (
              <User className="w-4 h-4" />
            ) : isBot ? (
              <Cpu className="w-4 h-4" />
            ) : (
              <Trophy className="w-4 h-4" />
            )}
          </div>

          <div className="truncate">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white truncate">
                {isOnline
                  ? isOpponent
                    ? onlineActiveGame.opponent.username
                    : onlineUserProfile.username
                  : importedGameMeta
                  ? barColor === 'w'
                    ? `${importedGameMeta.whiteName} (${importedGameMeta.whiteRating})`
                    : `${importedGameMeta.blackName} (${importedGameMeta.blackRating})`
                  : appMode === 'analysis'
                  ? barColor === 'w'
                    ? 'Beyaz (Analiz)'
                    : 'Siyah (Analiz)'
                  : isBot
                  ? 'Stockfish Bot'
                  : 'Sen (Oyuncu)'}
              </span>
              {isOnline && (
                <span className="px-1.5 py-0.5 text-[11px] font-bold rounded bg-amber-500/20 text-amber-400 border border-amber-500/40">
                  {isOpponent
                    ? `${onlineActiveGame.opponent.rating} ELO`
                    : `${
                        onlineUserProfile.ratings[onlineActiveGame.category] ||
                        1500
                      } ELO`}
                </span>
              )}
              {appMode === 'play' && !importedGameMeta && isBot && (
                <span className="px-1.5 py-0.5 text-[11px] font-bold rounded bg-[#3692e7]/20 text-[#3692e7] border border-[#3692e7]/40">
                  {botElo} ELO
                </span>
              )}
              {importedGameMeta && (
                <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-[#302e2c] text-[#bababa] border border-[#3c3934]">
                  {barColor === 'w' ? 'Beyaz' : 'Siyah'}
                </span>
              )}
              {accuracyForBar !== undefined && accuracyForBar !== null && (
                <span className="px-2 py-0.5 text-[11px] font-extrabold rounded bg-[#629924]/25 text-[#8cd936] border border-[#629924]">
                  %{accuracyForBar} Doğruluk
                </span>
              )}
            </div>

            <div className="flex items-center gap-1 h-4 mt-0.5">
              <div className="flex items-center -space-x-1.5 overflow-hidden">
                {capturedList.map((type, idx) => (
                  <div key={idx} className="w-3.5 h-3.5 inline-block">
                    <ChessPiece color={capturedPieceColor} type={type} />
                  </div>
                ))}
              </div>
              {advantage > 0 && (
                <span className="text-[11px] font-bold text-[#629924] ml-1">
                  +{advantage}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isOnline && (
            <div
              className={`px-3 py-1 rounded font-mono font-black text-xs sm:text-sm tracking-wide border flex items-center gap-1.5 ${
                isActiveTurn && onlineTimeMs < 20000
                  ? 'bg-red-950/80 border-red-500 text-red-400 animate-pulse'
                  : isActiveTurn
                  ? 'bg-[#1b1917] border-[#629924] text-white shadow'
                  : 'bg-[#1b1917] border-[#3c3934] text-[#999]'
              }`}
            >
              <Clock className="w-3.5 h-3.5 text-[#888]" />
              <span>{formatClockMs(onlineTimeMs)}</span>
            </div>
          )}
          {appMode === 'play' && isBot && isBotThinking && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#629924]/20 border border-[#629924]/50 text-[#8cd936] text-xs font-medium animate-pulse">
              <span className="w-2 h-2 rounded-full bg-[#8cd936] animate-ping" />
              Bot düşünüyor...
            </div>
          )}
          {((appMode === 'play' && !isBot && !isViewingPastMove) ||
            (isOnline && !isOpponent)) &&
            isActiveTurn && (
              <span className="px-2 py-0.5 rounded bg-[#629924]/20 text-[#8cd936] text-xs font-semibold">
                Sıra Sende
              </span>
            )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#161512] text-[#bababa] flex flex-col">
      {/* ÜST LICHESS HEADER VE MOD GEÇİŞ SEKMELERİ */}
      <header className="border-b border-[#2e2b27] bg-[#1e1c18]/95 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-2.5 sm:px-6 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded bg-[#262421] border border-[#3c3934] p-1 flex items-center justify-center shrink-0">
                <ChessPiece color="w" type="n" />
              </div>
              <span className="font-bold text-white tracking-tight text-base sm:text-lg">
                lichess<span className="text-[#629924] font-normal">.arena</span>
              </span>
            </div>

            {/* Mobil Sağ Üst Hızlı Butonlar */}
            <div className="flex sm:hidden items-center gap-1.5">
              {/* Mobil Premove Toggle */}
              <button
                type="button"
                onClick={togglePremove}
                className={`p-1.5 rounded border text-[11px] font-bold transition-colors ${
                  premoveEnabled
                    ? 'bg-amber-500/20 border-amber-500 text-amber-400'
                    : 'bg-[#262421] border-[#3c3934] text-[#888]'
                }`}
                title="Premove (Ön Hamle) Ayarı: Sıra rakipteyken önceden hamle hazırla"
              >
                <Zap className={`w-3.5 h-3.5 ${premoveEnabled ? 'fill-current' : ''}`} />
              </button>

              {onlineUserProfile?.isRegistered ? (
                <button
                  type="button"
                  onClick={() => multiplayerClient.logout()}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-[#262421] border border-red-900/50 text-red-400 text-[11px]"
                  title="Çıkış Yap"
                >
                  <span className="font-bold text-[#8cd936] max-w-[70px] truncate">{onlineUserProfile.username}</span>
                  <LogOut className="w-3 h-3" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowAuthModal(true)}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-[#3692e7]/20 border border-[#3692e7]/50 text-[#3692e7] text-[11px] font-semibold"
                >
                  <LogIn className="w-3 h-3" />
                  <span>Giriş</span>
                </button>
              )}
              <button
                type="button"
                onClick={toggleMute}
                className="p-1.5 rounded bg-[#262421] border border-[#3c3934] text-white"
                title={muted ? 'Sesi Aç' : 'Sesi Kapat'}
              >
                {muted ? (
                  <VolumeX className="w-4 h-4 text-red-400" />
                ) : (
                  <Volume2 className="w-4 h-4 text-[#629924]" />
                )}
              </button>
              {appMode === 'play' && (
                <button
                  type="button"
                  onClick={() => setShowNewGameModal(true)}
                  className="flex items-center gap-1 px-2 py-1.5 rounded bg-[#629924] text-white text-xs font-bold shadow"
                >
                  <Play className="w-3 h-3 fill-current" />
                  Yeni Maç
                </button>
              )}
            </div>
          </div>

          {/* ANA MOD SEÇİCİ: Mobilde tam genişlikte 4 sekme, PC'de yatay grup */}
          <div className="grid grid-cols-4 sm:flex items-center bg-[#262421] p-0.5 rounded-md border border-[#3c3934] w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setAppMode('play')}
              className={`flex items-center justify-center gap-1.5 px-2 sm:px-3 py-1.5 rounded text-[11px] sm:text-xs font-bold transition-colors truncate ${
                appMode === 'play'
                  ? 'bg-[#629924] text-white shadow'
                  : 'text-[#bababa] hover:text-white'
              }`}
            >
              <Swords className="w-3.5 h-3.5 shrink-0" />
              <span>Botla Maç</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);
                if (engineRef.current) engineRef.current.stop();
                setIsBotThinking(false);
                setAppMode('online');
                multiplayerClient.connect();
              }}
              className={`flex items-center justify-center gap-1.5 px-2 sm:px-3 py-1.5 rounded text-[11px] sm:text-xs font-bold transition-colors truncate ${
                appMode === 'online'
                  ? 'bg-amber-600 text-white shadow'
                  : 'text-[#bababa] hover:text-white'
              }`}
            >
              <Users className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Canlı Oyna</span>
              {onlineLobbyState.onlineCount > 1 && (
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse ml-0.5 hidden sm:inline-block" />
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);
                if (engineRef.current) engineRef.current.stop();
                setIsBotThinking(false);
                setAppMode('analysis');
              }}
              className={`flex items-center justify-center gap-1.5 px-2 sm:px-3 py-1.5 rounded text-[11px] sm:text-xs font-bold transition-colors truncate ${
                appMode === 'analysis'
                  ? 'bg-[#3692e7] text-white shadow'
                  : 'text-[#bababa] hover:text-white'
              }`}
            >
              <Compass className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Analiz & Yapıcı</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);
                if (engineRef.current) engineRef.current.stop();
                setIsBotThinking(false);
                setAppMode('scout');
              }}
              className={`flex items-center justify-center gap-1.5 px-2 sm:px-3 py-1.5 rounded text-[11px] sm:text-xs font-bold transition-colors truncate ${
                appMode === 'scout'
                  ? 'bg-[#e68a2e] text-black shadow'
                  : 'text-[#bababa] hover:text-white'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Hesap Analizi</span>
            </button>
          </div>

          {/* Sağ Üst Kontroller (PC ve Tablet Görünümü) */}
          <div className="hidden sm:flex items-center gap-2">
            {/* Tahta Teması */}
            <div className="hidden md:flex items-center bg-[#262421] border border-[#3c3934] rounded p-0.5">
              {Object.values(BOARD_THEMES).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setBoardTheme(t.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    boardTheme === t.id
                      ? 'bg-[#3c3934] text-white'
                      : 'text-[#999] hover:text-white'
                  }`}
                >
                  <span
                    className="w-3 h-3 rounded-sm border border-black/30"
                    style={{
                      background: `linear-gradient(135deg, ${t.light} 50%, ${t.dark} 50%)`,
                    }}
                  />
                  {t.name.split(' ')[1]}
                </button>
              ))}
            </div>

            {/* Maç Esnasında Eval Bar Kilidi Bildirimi */}
            {appMode === 'play' && !gameOverState.isOver && !isReviewingGame ? (
              <div
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium bg-[#262421] border border-[#3c3934] text-[#888]"
                title="Adil oyun kuralları gereği maç devam ederken Eval Bar ve motor okları kapalıdır."
              >
                <Lock className="w-3.5 h-3.5 text-[#e68a2e]" />
                <span>Maçta Eval Kapalı</span>
              </div>
            ) : (
              <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-semibold bg-[#629924]/20 border border-[#629924] text-[#8cd936]">
                <Activity className="w-3.5 h-3.5" />
                <span>Stockfish Analiz Aktif</span>
              </div>
            )}

            {/* PC Kullanıcı Hesap Durumu / Giriş Butonu */}
            {onlineUserProfile?.isRegistered ? (
              <div className="flex items-center gap-2 bg-[#262421] border border-[#3c3934] rounded px-2.5 py-1.5 shadow-sm">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs font-bold text-[#8cd936] max-w-[110px] truncate" title={onlineUserProfile.username}>
                  {onlineUserProfile.username}
                </span>
                <span className="text-[11px] text-[#aaa] font-mono bg-[#1c1b18] px-1.5 py-0.5 rounded border border-[#3c3934]">
                  {onlineUserProfile.ratings?.blitz || 1500}
                </span>
                <button
                  type="button"
                  onClick={() => multiplayerClient.logout()}
                  className="text-xs text-red-400 hover:text-red-300 ml-0.5 p-0.5 rounded hover:bg-red-950/40 transition-colors"
                  title="Çıkış Yap"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowAuthModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#262421] hover:bg-[#302e2c] border border-[#3c3934] text-xs font-bold text-white transition-colors cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5 text-[#3692e7]" />
                <span>Giriş / Kayıt</span>
              </button>
            )}

            {/* PC Premove (Ön Hamle) Ayarı */}
            <button
              type="button"
              onClick={togglePremove}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-semibold border transition-colors ${
                premoveEnabled
                  ? 'bg-amber-500/15 border-amber-500 text-amber-300'
                  : 'bg-[#262421] border-[#3c3934] text-[#888] hover:text-white'
              }`}
              title="Premove (Ön Hamle) Ayarı: Sıra rakipteyken önceden hamle hazırla. Sıra size geçtiğinde 0 ms gecikmeyle anında uygulanır."
            >
              <Zap className={`w-3.5 h-3.5 ${premoveEnabled ? 'text-amber-400 fill-current' : 'text-[#888]'}`} />
              <span className="hidden md:inline">Premove:</span>
              <span>{premoveEnabled ? 'Açık' : 'Kapalı'}</span>
            </button>

            {/* Ses Aç/Kapa */}
            <button
              type="button"
              onClick={toggleMute}
              className="p-2 rounded bg-[#262421] hover:bg-[#302e2c] border border-[#3c3934] text-white transition-colors"
              title={muted ? 'Sesi Aç' : 'Sesi Kapat'}
            >
              {muted ? (
                <VolumeX className="w-4 h-4 text-red-400" />
              ) : (
                <Volume2 className="w-4 h-4 text-[#629924]" />
              )}
            </button>

            {appMode === 'play' && (
              <button
                type="button"
                onClick={() => setShowNewGameModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#629924] hover:bg-[#73b32b] text-white text-xs sm:text-sm font-semibold shadow transition-colors"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                Yeni Maç
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ANA İÇERİK */}
      {appMode === 'scout' ? (
        <AccountScout
          stockfishController={engineRef.current}
          onOpenGameInAnalysis={handleOpenImportedGameInAnalysis}
          onOpenGameInFullReview={handleOpenImportedGameInFullReview}
        />
      ) : appMode === 'online' && !onlineActiveGame ? (
        <main className="flex-1 max-w-5xl w-full mx-auto px-2 sm:px-6 py-6">
          <MultiplayerLobby
            client={multiplayerClient}
            userProfile={onlineUserProfile}
            lobbyState={onlineLobbyState}
            isConnected={onlineIsConnected}
            waitingQueue={onlineWaitingQueue}
            myActiveChallenge={onlineMyChallenge}
            onQuickPair={(tc, rated) => multiplayerClient.quickPair(tc, rated)}
            onCancelPair={() => {
              multiplayerClient.cancelPair();
              setOnlineWaitingQueue(null);
            }}
            onCreateChallenge={(params) =>
              multiplayerClient.createChallenge(params)
            }
            onCancelChallenge={(id) => {
              multiplayerClient.cancelChallenge(id);
              setOnlineMyChallenge(null);
            }}
            onJoinChallenge={(id) => multiplayerClient.joinChallenge(id)}
            onJoinByCode={(code) => multiplayerClient.joinByCode(code)}
            onUpdateUsername={(name) => multiplayerClient.updateUsername(name)}
            onOpenAuth={() => setShowAuthModal(true)}
            onLogout={() => multiplayerClient.logout()}
          />
        </main>
      ) : (
      <main className="flex-1 max-w-7xl w-full mx-auto px-2 sm:px-6 py-4 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* SOL BÖLÜM: TAHTA + EVAL BAR (Sadece Analiz veya Maç Sonunda) */}
        <div className="lg:col-span-7 xl:col-span-8 flex flex-col items-center w-full">
          <div className="w-full max-w-[600px] flex flex-col gap-2">
            {/* Üst Bar */}
            {!isBoardEditorOpen && renderPlayerBar(topBarColor)}

            {/* Geçmiş Hamle Görüntüleme Uyarısı */}
            {appMode === 'play' && isViewingPastMove && !gameOverState.isOver && (
              <div className="flex items-center justify-between px-3 py-1.5 rounded bg-[#e68a2e]/20 border border-[#e68a2e] text-xs text-[#f5d07e]">
                <span>
                  Geçmiş konum inceleniyor ({activePlayPly}. yarım hamle). Oynamaya
                  devam etmek için güncel hamleye dönün.
                </span>
                <button
                  type="button"
                  onClick={() => setViewingPly(null)}
                  className="px-2 py-0.5 rounded bg-[#e68a2e] text-black font-bold hover:bg-[#f4a456]"
                >
                  Güncel Hamleye Dön
                </button>
              </div>
            )}

            {/* Orta: EvalBar (Sadece Analizde veya Maç Sonunda!) + 8x8 Satranç Tahtası */}
            <div className="relative flex items-center justify-center gap-2 w-full">
              <EvalBar
                evalScore={displayedEvalScore}
                orientation={orientation}
                visible={isEvalBarAllowed}
              />

              <div className="relative flex-1 flex flex-col items-center justify-center gap-2">
                {/* LICHESS STİLİ HATA İNCELEME ÇUBUĞU (REVIEW MISTAKES BAR) */}
                {mistakeReview && mistakeReview.errors.length > 0 && (
                  <div className="w-full bg-[#1b2533] border-2 border-[#3692e7] rounded-md p-2 flex items-center justify-between text-xs shadow-lg animate-fade-in">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white">
                        {mistakeReview.color === 'w' ? '⚪ Beyaz' : '⚫ Siyah'} Hatası{' '}
                        {mistakeReview.currentIndex + 1} / {mistakeReview.errors.length}
                      </span>
                      <span
                        className="px-1.5 py-0.5 rounded font-bold uppercase text-[10px]"
                        style={{
                          backgroundColor:
                            MOVE_CLASSIFICATIONS[
                              mistakeReview.errors[mistakeReview.currentIndex]
                                ?.classification
                            ]?.color || '#e68a2e',
                          color: '#fff',
                        }}
                      >
                        {
                          MOVE_CLASSIFICATIONS[
                            mistakeReview.errors[mistakeReview.currentIndex]
                              ?.classification
                          ]?.label || 'Hata'
                        }
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={mistakeReview.currentIndex <= 0}
                        onClick={() => {
                          const nextIdx = mistakeReview.currentIndex - 1;
                          setMistakeReview((prev) => ({
                            ...prev,
                            currentIndex: nextIdx,
                          }));
                          setViewingPly(mistakeReview.errors[nextIdx].ply);
                        }}
                        className="px-2 py-1 rounded bg-[#273549] hover:bg-[#344661] disabled:opacity-40 text-white font-bold cursor-pointer"
                      >
                        ← Önceki
                      </button>
                      <button
                        type="button"
                        disabled={
                          mistakeReview.currentIndex >=
                          mistakeReview.errors.length - 1
                        }
                        onClick={() => {
                          const nextIdx = mistakeReview.currentIndex + 1;
                          setMistakeReview((prev) => ({
                            ...prev,
                            currentIndex: nextIdx,
                          }));
                          setViewingPly(mistakeReview.errors[nextIdx].ply);
                        }}
                        className="px-2 py-1 rounded bg-[#3692e7] hover:bg-[#2563eb] disabled:opacity-40 text-white font-bold cursor-pointer"
                      >
                        Sonraki →
                      </button>
                      <button
                        type="button"
                        onClick={() => setMistakeReview(null)}
                        className="px-2 py-1 text-[#aaa] hover:text-white cursor-pointer"
                        title="İncelemeyi Bitir"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )}

                {/* Lichess Tarzı Paylaşılan Maç İnceleme Banner'ı */}
                {sharedGameBanner && (
                  <div className="w-full bg-[#1e293b] border border-[#3b82f6] rounded-md px-3.5 py-2 mb-2 flex items-center justify-between text-xs text-white shadow-lg animate-fade-in">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                      <span>
                        İncelenen Maç: <strong>{sharedGameBanner.white}</strong> vs <strong>{sharedGameBanner.black}</strong> ({sharedGameBanner.result})
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const fullUrl = `${window.location.origin}/game/${sharedGameBanner.id}`;
                          navigator.clipboard.writeText(fullUrl);
                          setCopiedShareUrl(true);
                          setTimeout(() => setCopiedShareUrl(false), 2500);
                        }}
                        className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-bold text-[11px] flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <Share2 className="w-3 h-3" /> {copiedShareUrl ? 'Kopyalandı!' : 'Linki Paylaş'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSharedGameBanner(null)}
                        className="text-[#94a3b8] hover:text-white p-0.5 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Chess.com Tarzı Aktif Premove Bildirimi */}
                {premove && (
                  <div className="w-full bg-red-950/70 border border-red-500 text-red-200 text-xs px-3 py-1.5 rounded flex items-center justify-between mb-1.5 shadow">
                    <div className="flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-red-400 fill-current animate-pulse" />
                      <span>
                        Premove Hazır: <strong className="font-mono text-white">{premove.from} → {premove.to}</strong> (Sıra sende olunca 0 ms ile oynanacak)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setPremove(null);
                        premoveRef.current = null;
                        setPremoveFrom(null);
                      }}
                      className="text-[11px] bg-red-800/80 hover:bg-red-700 text-white px-2 py-0.5 rounded font-bold cursor-pointer"
                    >
                      İptal
                    </button>
                  </div>
                )}

                <ChessBoard
                  board={activeBoardMatrix}
                  orientation={
                    appMode === 'online' && onlineActiveGame
                      ? onlineActiveGame.myColor
                      : orientation
                  }
                  themeKey={boardTheme}
                  selectedSquare={
                    appMode === 'online'
                      ? (onlineGameRef.current.turn() === onlineActiveGame?.myColor
                          ? onlineSelectedSq
                          : premoveFrom)
                      : appMode === 'analysis'
                      ? analysisSelectedSq
                      : (game.turn() === playerColor && !isBotThinking
                          ? selectedSquare
                          : premoveFrom)
                  }
                  legalMovesForSelected={activeLegalMoves}
                  lastMove={displayedLastMove}
                  kingInCheckSquare={displayedKingInCheckSquare}
                  premove={premove}
                  onCancelPremove={() => {
                    setPremove(null);
                    premoveRef.current = null;
                    setPremoveFrom(null);
                  }}
                  pendingPromotion={
                    appMode === 'online'
                      ? onlinePendingPromo
                      : appMode === 'analysis'
                      ? analysisPendingPromo
                      : pendingPromotion
                  }
                  arrows={boardArrows}
                  moveBadge={activeMoveBadge}
                  editorMode={appMode === 'analysis' && isBoardEditorOpen}
                  onEditorSquareClick={handleEditorSquareClick}
                  onSquareClick={(sq) => {
                    if (appMode === 'online') {
                      if (onlineGameOverData) return;
                      const isMyTurn = onlineGameRef.current.turn() === onlineActiveGame?.myColor;
                      if (isMyTurn) {
                        if (premove) { setPremove(null); premoveRef.current = null; }
                        if (onlineSelectedSq) {
                          if (onlineSelectedSq === sq) {
                            setOnlineSelectedSq(null);
                            return;
                          }
                          const moved = attemptOnlineMove(onlineSelectedSq, sq);
                          if (moved) return;
                        }
                        const clicked = onlineGameRef.current.get(sq);
                        if (
                          clicked &&
                          clicked.color === onlineActiveGame?.myColor
                        ) {
                          setOnlineSelectedSq(sq);
                        } else {
                          setOnlineSelectedSq(null);
                        }
                      } else {
                        // Online Premove
                        if (!premoveEnabled) return;
                        const clicked = onlineGameRef.current.get(sq);
                        if (premoveFrom) {
                          if (premoveFrom === sq) {
                            setPremoveFrom(null);
                            return;
                          }
                          if (clicked && clicked.color === onlineActiveGame?.myColor) {
                            setPremoveFrom(sq);
                            return;
                          }
                          const newPm = { from: premoveFrom, to: sq };
                          setPremove(newPm);
                          premoveRef.current = newPm;
                          setPremoveFrom(null);
                        } else {
                          if (clicked && clicked.color === onlineActiveGame?.myColor) {
                            setPremoveFrom(sq);
                            setPremove(null);
                            premoveRef.current = null;
                          }
                        }
                      }
                      return;
                    }
                    if (appMode === 'analysis') {
                      if (isBoardEditorOpen) return;
                      if (analysisSelectedSq) {
                        if (analysisSelectedSq === sq) {
                          setAnalysisSelectedSq(null);
                          return;
                        }
                        const moved = attemptAnalysisMove(analysisSelectedSq, sq);
                        if (moved) return;
                      }
                      const p = analysisGameRef.current.get(sq);
                      if (p && p.color === analysisGameRef.current.turn()) {
                        setAnalysisSelectedSq(sq);
                      } else {
                        setAnalysisSelectedSq(null);
                      }
                    } else {
                      if (gameOverState.isOver || isViewingPastMove) return;
                      const isMyTurn = game.turn() === playerColor && !isBotThinking;
                      if (isMyTurn) {
                        if (premove) { setPremove(null); premoveRef.current = null; }
                        if (selectedSquare) {
                          if (selectedSquare === sq) {
                            setSelectedSquare(null);
                            return;
                          }
                          const moved = attemptPlayerMove(selectedSquare, sq);
                          if (moved) return;
                        }
                        const clickedPiece = game.get(sq);
                        if (clickedPiece && clickedPiece.color === playerColor) {
                          setSelectedSquare(sq);
                        } else {
                          setSelectedSquare(null);
                        }
                      } else {
                        // Bot Maçı Premove
                        if (!premoveEnabled) return;
                        const clickedPiece = game.get(sq);
                        if (premoveFrom) {
                          if (premoveFrom === sq) {
                            setPremoveFrom(null);
                            return;
                          }
                          if (clickedPiece && clickedPiece.color === playerColor) {
                            setPremoveFrom(sq);
                            return;
                          }
                          const newPm = { from: premoveFrom, to: sq };
                          setPremove(newPm);
                          premoveRef.current = newPm;
                          setPremoveFrom(null);
                        } else {
                          if (clickedPiece && clickedPiece.color === playerColor) {
                            setPremoveFrom(sq);
                            setPremove(null);
                            premoveRef.current = null;
                          }
                        }
                      }
                    }
                  }}
                  onPieceDrop={(fromSq, toSq) => {
                    if (appMode === 'online') {
                      if (onlineGameOverData) return;
                      const isMyTurn = onlineGameRef.current.turn() === onlineActiveGame?.myColor;
                      if (isMyTurn) {
                        attemptOnlineMove(fromSq, toSq);
                      } else {
                        if (!premoveEnabled) return;
                        const piece = onlineGameRef.current.get(fromSq);
                        if (piece && piece.color === onlineActiveGame?.myColor && fromSq !== toSq) {
                          const newPm = { from: fromSq, to: toSq };
                          setPremove(newPm);
                          premoveRef.current = newPm;
                          setPremoveFrom(null);
                        }
                      }
                      return;
                    }
                    if (appMode === 'analysis') {
                      if (isBoardEditorOpen) return;
                      attemptAnalysisMove(fromSq, toSq);
                    } else {
                      if (gameOverState.isOver || isViewingPastMove) return;
                      const isMyTurn = game.turn() === playerColor && !isBotThinking;
                      if (isMyTurn) {
                        attemptPlayerMove(fromSq, toSq);
                      } else {
                        if (!premoveEnabled) return;
                        const piece = game.get(fromSq);
                        if (piece && piece.color === playerColor && fromSq !== toSq) {
                          const newPm = { from: fromSq, to: toSq };
                          setPremove(newPm);
                          premoveRef.current = newPm;
                          setPremoveFrom(null);
                        }
                      }
                    }
                  }}
                  onCompletePromotion={(pieceType) => {
                    if (appMode === 'online' && onlinePendingPromo) {
                      attemptOnlineMove(
                        onlinePendingPromo.from,
                        onlinePendingPromo.to,
                        pieceType
                      );
                    } else if (appMode === 'analysis' && analysisPendingPromo) {
                      attemptAnalysisMove(
                        analysisPendingPromo.from,
                        analysisPendingPromo.to,
                        pieceType
                      );
                    } else if (pendingPromotion) {
                      attemptPlayerMove(
                        pendingPromotion.from,
                        pendingPromotion.to,
                        pieceType
                      );
                    }
                  }}
                  onCancelPromotion={() => {
                    setPendingPromotion(null);
                    setAnalysisPendingPromo(null);
                    setOnlinePendingPromo(null);
                  }}
                  disabled={
                    (appMode === 'play' &&
                      (gameOverState.isOver || isViewingPastMove || (!premoveEnabled && isBotThinking))) ||
                    (appMode === 'online' &&
                      (!!onlineGameOverData ||
                        (!premoveEnabled &&
                          onlineGameRef.current.turn() !==
                            onlineActiveGame?.myColor)))
                  }
                />

                {/* ONLINE MAÇ SONU MODAL PENCERESİ */}
                {appMode === 'online' && onlineGameOverData && (
                  <div className="absolute inset-0 z-40 bg-black/80 backdrop-blur-[2px] flex items-center justify-center p-4 animate-fade-in">
                    <div className="bg-[#262421] border-2 border-amber-500 rounded-lg max-w-sm w-full p-5 shadow-2xl text-center space-y-4">
                      <div className="w-14 h-14 rounded-full bg-amber-500/20 border-2 border-amber-500 text-amber-400 mx-auto flex items-center justify-center">
                        <Trophy className="w-8 h-8" />
                      </div>

                      <div>
                        <h2 className="text-xl font-black text-white">
                          {onlineGameOverData.winner === onlineActiveGame?.myColor
                            ? '🏆 TEBRİKLER, KAZANDINIZ!'
                            : onlineGameOverData.winner === 'draw'
                            ? '🤝 MAÇ BERABERE'
                            : 'KAYBETTİNİZ'}
                        </h2>
                        <p className="text-xs text-[#aaa] mt-1 capitalize">
                          Sebep:{' '}
                          {onlineGameOverData.reason === 'checkmate'
                            ? 'Şah Mat'
                            : onlineGameOverData.reason === 'timeout'
                            ? 'Süre Bitti (Bayrak Düştü)'
                            : onlineGameOverData.reason === 'resignation'
                            ? 'Terk Edildi'
                            : 'Beraberlik'}
                        </p>
                      </div>

                      {/* ELO Değişimi Kartı */}
                      {onlineGameOverData.ratingChanges && (
                        <div className="bg-[#1b1917] p-3 rounded border border-[#3c3934] text-xs">
                          <span className="text-[#888] block mb-1">
                            {onlineActiveGame?.category?.toUpperCase()} ELO DEĞİŞİMİ
                          </span>
                          <div className="flex items-center justify-center gap-2 text-base font-bold text-white">
                            <span>
                              {onlineGameOverData.myColor === 'w'
                                ? onlineGameOverData.ratingChanges.white.old
                                : onlineGameOverData.ratingChanges.black.old}
                            </span>
                            <span className="text-[#888]">→</span>
                            <span
                              className={
                                (onlineGameOverData.myColor === 'w'
                                  ? onlineGameOverData.ratingChanges.white.delta
                                  : onlineGameOverData.ratingChanges.black.delta) >= 0
                                  ? 'text-green-400'
                                  : 'text-red-400'
                              }
                            >
                              {onlineGameOverData.myColor === 'w'
                                ? onlineGameOverData.ratingChanges.white.new
                                : onlineGameOverData.ratingChanges.black.new}
                            </span>
                            <span
                              className={`text-xs px-1.5 py-0.5 rounded ${
                                (onlineGameOverData.myColor === 'w'
                                  ? onlineGameOverData.ratingChanges.white.delta
                                  : onlineGameOverData.ratingChanges.black.delta) >= 0
                                  ? 'bg-green-950 text-green-300'
                                  : 'bg-red-950 text-red-300'
                              }`}
                            >
                              {(onlineGameOverData.myColor === 'w'
                                ? onlineGameOverData.ratingChanges.white.delta
                                : onlineGameOverData.ratingChanges.black.delta) >= 0
                                ? `+${
                                    onlineGameOverData.myColor === 'w'
                                      ? onlineGameOverData.ratingChanges.white.delta
                                      : onlineGameOverData.ratingChanges.black.delta
                                  }`
                                : onlineGameOverData.myColor === 'w'
                                ? onlineGameOverData.ratingChanges.white.delta
                                : onlineGameOverData.ratingChanges.black.delta}
                            </span>
                          </div>
                        </div>
                      )}

                      <div className="flex flex-col gap-2 pt-2">
                        <button
                          type="button"
                          onClick={() => {
                            const gid = onlineGameOverData?.gameId || onlineActiveGame?.gameId;
                            if (gid) {
                              const shareUrl = `${window.location.origin}/game/${gid}`;
                              navigator.clipboard.writeText(shareUrl);
                              setCopiedShareUrl(true);
                              setTimeout(() => setCopiedShareUrl(false), 2500);
                            }
                          }}
                          className="w-full py-2 px-3 rounded bg-[#1e293b] hover:bg-[#28384e] border border-[#3b82f6]/60 text-blue-300 text-xs font-bold shadow flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                          {copiedShareUrl ? '✓ Maç Linki Kopyalandı!' : `🔗 Maç Linkini Paylaş (/game/${onlineGameOverData?.gameId || onlineActiveGame?.gameId || ''})`}
                        </button>
                        <button
                          type="button"
                          onClick={reviewOnlineGameWithStockfish}
                          className="w-full py-2.5 px-4 rounded bg-[#3692e7] hover:bg-[#2878c2] text-white text-xs sm:text-sm font-bold shadow flex items-center justify-center gap-2 cursor-pointer transition-colors"
                        >
                          <Award className="w-4 h-4" />
                          🔍 Bu Maçı Stockfish ile Analiz Et
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setOnlineActiveGame(null);
                            setOnlineGameOverData(null);
                          }}
                          className="w-full py-2 px-3 rounded bg-[#36332e] hover:bg-[#44403a] text-white text-xs font-semibold cursor-pointer transition-colors"
                        >
                          Lobiye Dön
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* OYUN SONU MODAL PENCERESİ (DOĞRULUK ANALİZİ BAŞLATMA BUTONLU) */}
                {appMode === 'play' &&
                  gameOverState.isOver &&
                  !dismissGameOverModal && (
                    <div className="absolute inset-0 z-40 bg-black/75 backdrop-blur-[2px] flex items-center justify-center p-4">
                      <div className="bg-[#262421] border-2 border-[#629924] rounded-lg max-w-sm w-full p-5 shadow-2xl text-center">
                        <div className="w-12 h-12 rounded-full bg-[#629924]/20 border border-[#629924] text-[#8cd936] mx-auto flex items-center justify-center mb-3">
                          <Trophy className="w-6 h-6" />
                        </div>
                        <h2 className="text-lg sm:text-xl font-bold text-white mb-1">
                          {gameOverState.title}
                        </h2>
                        <p className="text-xs sm:text-sm text-[#bababa] mb-5">
                          {gameOverState.reason}
                        </p>

                        <div className="flex flex-col gap-2">
                          <button
                            type="button"
                            onClick={() => runFullGameAccuracyReview()}
                            className="w-full py-2.5 px-4 rounded bg-[#3692e7] hover:bg-[#48a1f2] text-white text-xs sm:text-sm font-bold shadow flex items-center justify-center gap-2 transition-colors"
                          >
                            <Award className="w-4 h-4" />
                            Maç Sonu Doğruluk Analizi & Tahtayı İncele
                          </button>

                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setDismissGameOverModal(true);
                                setIsReviewingGame(true);
                              }}
                              className="py-2 px-3 rounded bg-[#36332e] hover:bg-[#44403a] text-white text-xs font-medium transition-colors"
                            >
                              Serbest İncele
                            </button>
                            <button
                              type="button"
                              onClick={() => startNewGame(sideChoice, botElo)}
                              className="py-2 px-3 rounded bg-[#629924] hover:bg-[#73b32b] text-white text-xs font-bold shadow flex items-center justify-center gap-1.5 transition-colors"
                            >
                              <Play className="w-3.5 h-3.5 fill-current" />
                              Tekrar Oyna
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
              </div>
            </div>

            {/* Alt Bar */}
            {!isBoardEditorOpen && renderPlayerBar(bottomBarColor)}

            {/* SADECE MOBİLDE GÖRÜNEN (`lg:hidden`) HIZLI HAMLE BANDI VE KONTROL ÇUBUĞU (PC FORMATINI HİÇ ETKİLEMEZ) */}
            {!isBoardEditorOpen && (
              <div className="flex lg:hidden flex-col gap-1.5 bg-[#262421] border border-[#3c3934] rounded-md p-2 shadow-md">
                {/* Mobilde Canlı GM2600 Açılış & Varyant Özeti */}
                <div className="flex items-center justify-between gap-2 px-1 text-[11px]">
                  <div className="flex items-center gap-1.5 truncate">
                    <BookOpen className="w-3.5 h-3.5 text-[#f0c15c] shrink-0" />
                    <span className="font-mono font-bold text-[#f5d07e]">
                      {appMode === 'analysis'
                        ? activeAnalysisOpeningInfo.eco
                        : activePlayOpeningInfo.eco}
                    </span>
                    <span className="text-white font-semibold truncate">
                      {appMode === 'analysis'
                        ? activeAnalysisOpeningInfo.name
                        : activePlayOpeningInfo.name}
                    </span>
                  </div>
                  {(appMode === 'analysis'
                    ? activeAnalysisOpeningInfo.variation
                    : activePlayOpeningInfo.variation) && (
                    <span className="text-[10px] text-[#999] truncate max-w-[42%]">
                      {appMode === 'analysis'
                        ? activeAnalysisOpeningInfo.variation
                        : activePlayOpeningInfo.variation}
                    </span>
                  )}
                </div>

                {/* Mobilde Yatay Kaydırılabilir Tıklanabilir Hamle Şeridi */}
                <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-1 px-1 bg-[#1a1816] rounded border border-[#3c3934] text-xs font-mono">
                  {(appMode === 'online'
                    ? onlineMovePairs
                    : appMode === 'analysis'
                    ? analysisMovePairs
                    : movePairs
                  ).length === 0 ? (
                    <span className="text-[11px] text-[#777] font-sans px-1">
                      Hamle yapıldığında burada tıklanabilir olarak listelenir...
                    </span>
                  ) : (
                    (appMode === 'online'
                      ? onlineMovePairs
                      : appMode === 'analysis'
                      ? analysisMovePairs
                      : movePairs
                    ).map((pair) => (
                        <div
                          key={pair.moveNumber}
                          className="flex items-center gap-0.5 shrink-0"
                        >
                          <span className="text-[#777] text-[11px] pl-1">
                            {pair.moveNumber}.
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              appMode === 'analysis'
                                ? jumpToAnalysisPly(pair.whitePly)
                                : setViewingPly(
                                    pair.whitePly === moveHistory.length
                                      ? null
                                      : pair.whitePly
                                  )
                            }
                            className={`px-1.5 py-0.5 rounded text-xs ${
                              (appMode === 'analysis'
                                ? analysisPly
                                : activePlayPly) === pair.whitePly
                                ? 'bg-[#629924] text-white font-bold'
                                : 'text-[#e0e0e0]'
                            }`}
                          >
                            {pair.white.san}
                          </button>
                          {pair.black && (
                            <button
                              type="button"
                              onClick={() =>
                                appMode === 'analysis'
                                  ? jumpToAnalysisPly(pair.blackPly)
                                  : setViewingPly(
                                      pair.blackPly === moveHistory.length
                                        ? null
                                        : pair.blackPly
                                    )
                              }
                              className={`px-1.5 py-0.5 rounded text-xs ${
                                (appMode === 'analysis'
                                  ? analysisPly
                                  : activePlayPly) === pair.blackPly
                                  ? 'bg-[#629924] text-white font-bold'
                                  : 'text-[#e0e0e0]'
                              }`}
                            >
                              {pair.black.san}
                            </button>
                          )}
                        </div>
                      )
                    )
                  )}
                </div>

                {/* Mobilde Tek Dokunuşlu Hızlı Aksiyon Barı (Önceki, Sonraki, Çevir, Geri Al, Pes Et) */}
                <div className="grid grid-cols-5 gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      appMode === 'analysis'
                        ? jumpToAnalysisPly(analysisPly - 1)
                        : setViewingPly(Math.max(0, activePlayPly - 1))
                    }
                    disabled={
                      (appMode === 'analysis' ? analysisPly : activePlayPly) === 0
                    }
                    className="py-2 rounded bg-[#302e2c] active:bg-[#3c3934] disabled:opacity-35 text-white flex items-center justify-center border border-[#3c3934]"
                    title="Önceki Hamle"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (appMode === 'analysis') {
                        jumpToAnalysisPly(analysisPly + 1);
                      } else {
                        const next = activePlayPly + 1;
                        setViewingPly(
                          next >= moveHistory.length ? null : next
                        );
                      }
                    }}
                    disabled={
                      appMode === 'analysis'
                        ? analysisPly >= analysisTimeline.length - 1
                        : activePlayPly >= moveHistory.length
                    }
                    className="py-2 rounded bg-[#302e2c] active:bg-[#3c3934] disabled:opacity-35 text-white flex items-center justify-center border border-[#3c3934]"
                    title="Sonraki Hamle"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setOrientation((prev) => (prev === 'w' ? 'b' : 'w'))
                    }
                    className="py-2 rounded bg-[#302e2c] active:bg-[#3c3934] text-white text-[11px] font-semibold flex items-center justify-center gap-1 border border-[#3c3934]"
                  >
                    <FlipHorizontal className="w-3.5 h-3.5" />
                    <span>Çevir</span>
                  </button>

                  {appMode === 'play' ? (
                    <>
                      <button
                        type="button"
                        onClick={handleTakeback}
                        disabled={
                          moveHistory.length === 0 || gameOverState.isOver
                        }
                        className="py-2 rounded bg-[#302e2c] active:bg-[#3c3934] disabled:opacity-35 text-white text-[11px] font-semibold flex items-center justify-center gap-1 border border-[#3c3934]"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Geri Al</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleConfirmResign}
                        disabled={
                          gameOverState.isOver || moveHistory.length === 0
                        }
                        className="py-2 rounded bg-red-950/70 active:bg-red-900 disabled:opacity-35 text-red-200 text-[11px] font-semibold flex items-center justify-center gap-1 border border-red-800/50"
                      >
                        <Flag className="w-3.5 h-3.5" />
                        <span>Pes Et</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setShowAnalysisArrows((v) => !v)}
                        className={`py-2 rounded text-[11px] font-semibold flex items-center justify-center gap-1 border ${
                          showAnalysisArrows
                            ? 'bg-[#629924]/25 border-[#629924] text-[#8cd936]'
                            : 'bg-[#302e2c] border-[#3c3934] text-[#999]'
                        }`}
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Oklar</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditorMatrix(parseFenToBoardMatrix(analysisFen));
                          setIsBoardEditorOpen((v) => !v);
                        }}
                        className="py-2 rounded bg-[#3692e7] text-white text-[11px] font-bold flex items-center justify-center gap-1"
                      >
                        <Wrench className="w-3.5 h-3.5" />
                        <span>Yapıcı</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* TAHTA YAPICI (BOARD EDITOR) TAŞ PALETİ */}
            {appMode === 'analysis' && isBoardEditorOpen && (
              <div className="bg-[#262421] border border-[#3692e7] rounded-md p-3 flex flex-col gap-3 shadow-lg">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase text-white flex items-center gap-1.5">
                    <Wrench className="w-3.5 h-3.5 text-[#3692e7]" />
                    Tahta Yapıcı • Kareye Tıklayarak Taş Ekle / Sil
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditorTool('trash')}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-bold border ${
                      editorTool === 'trash'
                        ? 'bg-red-900/50 border-red-500 text-white'
                        : 'bg-[#1e1c19] border-[#3c3934] text-[#bababa]'
                    }`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Silgi
                  </button>
                </div>

                {/* 12 Taş Seçim Paleti */}
                <div className="grid grid-cols-6 sm:grid-cols-12 gap-1.5">
                  {EDITOR_PALETTE_PIECES.map((item) => {
                    const isSelected =
                      editorTool !== 'trash' &&
                      editorTool.color === item.color &&
                      editorTool.type === item.type;
                    return (
                      <button
                        key={`${item.color}${item.type}`}
                        type="button"
                        title={item.name}
                        onClick={() =>
                          setEditorTool({ color: item.color, type: item.type })
                        }
                        className={`aspect-square rounded p-1 border flex items-center justify-center transition-all ${
                          isSelected
                            ? 'bg-[#629924]/35 border-[#629924] scale-105 shadow'
                            : 'bg-[#f0d9b5]/90 hover:bg-[#f0d9b5] border-[#3c3934]'
                        }`}
                      >
                        <ChessPiece color={item.color} type={item.type} />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* SAĞ BÖLÜM: MODA GÖRE MAÇ PANELİ VEYA STOCKFISH ANALİZ STÜDYOSU PANELİ */}
        <div className="lg:col-span-5 xl:col-span-4 w-full max-w-[600px] mx-auto lg:max-w-none flex flex-col gap-4">
          {appMode === 'online' && onlineActiveGame ? (
            <div className="bg-[#262421] border border-[#3c3934] rounded-lg p-4 flex flex-col gap-4 shadow-xl">
              {/* Online Maç Bilgi Başlığı */}
              <div className="flex items-center justify-between border-b border-[#3c3934] pb-3">
                <div>
                  <h3 className="font-bold text-white text-base flex items-center gap-2">
                    <Swords className="w-4 h-4 text-amber-500" />
                    <span>
                      {onlineActiveGame.timeMinutes}+{onlineActiveGame.incSeconds}{' '}
                      {onlineActiveGame.category?.toUpperCase()}
                    </span>
                  </h3>
                  <div className="text-xs text-[#888] mt-0.5">
                    {onlineActiveGame.rated
                      ? 'Puanlı Maç (Rated Elo)'
                      : 'Puansız Dostluk Maçı'}{' '}
                    • Oda: {onlineActiveGame.code}
                  </div>
                </div>
                <span
                  className={`px-2.5 py-1 rounded text-xs font-bold ${
                    onlineActiveGame.myColor === 'w'
                      ? 'bg-neutral-100 text-black'
                      : 'bg-black text-white border border-neutral-700'
                  }`}
                >
                  {onlineActiveGame.myColor === 'w' ? '⚪ Beyazsın' : '⚫ Siyahsın'}
                </span>
              </div>

              {/* Hamle Geçmişi Notasyonu */}
              <div className="bg-[#1e1c18] border border-[#3c3934] rounded-md p-3 max-h-56 overflow-y-auto text-xs font-mono">
                {onlineMoveHistory.length === 0 ? (
                  <div className="text-center text-[#666] py-6">
                    Maç başladı. İlk hamle bekleniyor...
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                    {onlineMoveHistory
                      .reduce((acc, m, i) => {
                        if (i % 2 === 0) acc.push([m]);
                        else acc[acc.length - 1].push(m);
                        return acc;
                      }, [])
                      .map((pair, turnIdx) => (
                        <div
                          key={turnIdx}
                          className="flex items-center gap-2 text-white"
                        >
                          <span className="text-[#666] w-6">{turnIdx + 1}.</span>
                          <span className="font-bold">{pair[0]?.san}</span>
                          {pair[1] && (
                            <span className="text-[#aaa]">{pair[1]?.san}</span>
                          )}
                        </div>
                      ))}
                  </div>
                )}
              </div>

              {/* Maç İçi Aksiyon Butonları (Terk, Beraberlik, Sohbet) */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm('Bu maçı terk etmek istediğinize emin misiniz?')
                    ) {
                      multiplayerClient.resign(onlineActiveGame.gameId);
                    }
                  }}
                  className="bg-[#3a2020] hover:bg-[#522525] border border-red-900/60 text-red-300 py-2 rounded text-xs font-bold transition-colors cursor-pointer"
                >
                  🚩 Terk Et
                </button>

                <button
                  type="button"
                  onClick={() => {
                    multiplayerClient.offerDraw(onlineActiveGame.gameId);
                    alert('Beraberlik teklifi rakibe gönderildi.');
                  }}
                  className="bg-[#24262b] hover:bg-[#32363d] border border-[#3c3934] text-[#ccc] py-2 rounded text-xs font-bold transition-colors cursor-pointer"
                >
                  🤝 Beraberlik
                </button>

                <button
                  type="button"
                  onClick={() => setShowOnlineChat((v) => !v)}
                  className={`border py-2 rounded text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                    showOnlineChat
                      ? 'bg-[#3692e7] border-[#3692e7] text-white'
                      : 'bg-[#1e1c18] border-[#3c3934] text-[#aaa] hover:text-white'
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Sohbet</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const fullUrl = `${window.location.origin}/game/${onlineActiveGame.gameId}`;
                    navigator.clipboard.writeText(fullUrl);
                    setCopiedShareUrl(true);
                    setTimeout(() => setCopiedShareUrl(false), 2500);
                  }}
                  className="col-span-3 bg-[#1e293b] hover:bg-[#28384e] border border-[#3b82f6]/50 text-blue-300 py-1.5 rounded text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>{copiedShareUrl ? '✓ Maç Linki Kopyalandı!' : `🔗 Maç Linkini Paylaş (/game/${onlineActiveGame.gameId})`}</span>
                </button>
              </div>

              {/* Rakip Beraberlik Teklif Ettiğinde Bildirim */}
              {onlineDrawOffered && (
                <div className="bg-[#2a2e1d] border-2 border-yellow-500 rounded p-3 flex items-center justify-between gap-3 text-xs">
                  <span className="text-yellow-200 font-bold">
                    Rakip beraberlik teklif etti!
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        multiplayerClient.respondDraw(
                          onlineActiveGame.gameId,
                          true
                        );
                        setOnlineDrawOffered(false);
                      }}
                      className="bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded font-bold cursor-pointer"
                    >
                      Kabul Et
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        multiplayerClient.respondDraw(
                          onlineActiveGame.gameId,
                          false
                        );
                        setOnlineDrawOffered(false);
                      }}
                      className="bg-red-700 hover:bg-red-600 text-white px-3 py-1 rounded font-bold cursor-pointer"
                    >
                      Reddet
                    </button>
                  </div>
                </div>
              )}

              {/* Canlı Oyun İçi Sohbet Bölümü */}
              {showOnlineChat && (
                <div className="border border-[#3c3934] rounded-md p-3 bg-[#1e1c18] flex flex-col gap-2">
                  <div className="text-[11px] font-bold uppercase text-[#888]">
                    Oyun İçi Sohbet
                  </div>
                  <div className="h-32 overflow-y-auto space-y-1.5 text-xs pr-1">
                    {onlineChatMessages.length === 0 ? (
                      <div className="text-[#555] text-center py-4">
                        Henüz mesaj yok
                      </div>
                    ) : (
                      onlineChatMessages.map((msg, i) => (
                        <div key={i} className="leading-snug">
                          <strong className="text-[#3692e7]">
                            {msg.sender}:{' '}
                          </strong>
                          <span className="text-[#e0e0e0]">{msg.text}</span>
                        </div>
                      ))
                    )}
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (onlineChatInput.trim()) {
                        multiplayerClient.sendChat(
                          onlineActiveGame.gameId,
                          onlineChatInput.trim()
                        );
                        setOnlineChatInput('');
                      }
                    }}
                    className="flex gap-1.5 mt-1"
                  >
                    <input
                      type="text"
                      placeholder="Mesaj yazın..."
                      value={onlineChatInput}
                      onChange={(e) => setOnlineChatInput(e.target.value)}
                      maxLength={120}
                      className="flex-1 bg-[#141311] border border-[#3c3934] text-white px-2.5 py-1 text-xs rounded outline-none"
                    />
                    <button
                      type="submit"
                      className="bg-[#3692e7] text-white px-3 py-1 rounded text-xs font-bold cursor-pointer"
                    >
                      <Send className="w-3 h-3" />
                    </button>
                  </form>
                </div>
              )}
            </div>
          ) : appMode === 'play' ? (
            <>
              {/* MAÇ SONU DOĞRULUK RAPORU KARTI (GAME REVIEW) */}
              {(gameOverState.isOver || isReviewingGame) && (
                <div className="bg-[#262421] border-2 border-[#3692e7] rounded-md overflow-hidden shadow-xl flex flex-col">
                  {/* Lichess Tarzı Üst Motor & Ayar Barı */}
                  <div className="bg-[#1e1c19] border-b border-[#3692e7]/60 flex items-stretch justify-between">
                    <div className="flex items-center gap-2.5 px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setEngineEnabled((v) => !v)}
                        className={`relative w-10 h-5.5 rounded-full transition-colors flex items-center px-0.5 border ${
                          engineEnabled
                            ? 'bg-[#629924] border-[#73b32b]'
                            : 'bg-[#3c3934] border-[#555]'
                        }`}
                        title="Stockfish Motorunu Aç/Kapat"
                      >
                        <span
                          className={`w-4 h-4 rounded-full bg-white shadow transform transition-transform flex items-center justify-center text-[9px] font-bold ${
                            engineEnabled
                              ? 'translate-x-4 text-[#629924]'
                              : 'translate-x-0 text-[#777]'
                          }`}
                        >
                          {engineEnabled ? '✓' : '✕'}
                        </span>
                      </button>
                      <div className="leading-tight">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-white">
                            SF 19 1MB
                          </span>
                          <span className="text-xs font-extrabold text-[#629924]">
                            NNUE
                          </span>
                          <span className="text-[11px] font-mono text-[#72b8ff]">
                            d={evalScore?.depth || analysisMaxDepth}
                          </span>
                        </div>
                        <span className="text-[10px] text-[#999] block">
                          yerel tarayıcı üzerinde • {analysisMultiPV}/5 varyant
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center">
                      <button
                        type="button"
                        onClick={() => setShowReviewArrows((v) => !v)}
                        className={`flex items-center gap-1 px-2.5 py-1 mr-2 rounded text-xs font-semibold border transition-colors ${
                          showReviewArrows
                            ? 'bg-[#629924]/25 border-[#629924] text-[#8cd936]'
                            : 'bg-[#1e1c19] border-[#3c3934] text-[#999]'
                        }`}
                      >
                        {showReviewArrows ? (
                          <Eye className="w-3.5 h-3.5" />
                        ) : (
                          <EyeOff className="w-3.5 h-3.5" />
                        )}
                        <span>Oklar</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowEngineSettings((v) => !v)}
                        className={`h-full px-3 flex items-center justify-center transition-colors ${
                          showEngineSettings
                            ? 'bg-[#1b78d0] text-white'
                            : 'bg-[#262421] hover:bg-[#302e2c] text-[#bababa] border-l border-[#3c3934]'
                        }`}
                        title="Motor Ayarları (Arama süresi, Derinlik, Çoklu varyantlar 1-5)"
                      >
                        <Settings className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Dişli Çark Açıkken Lichess Motor Ayarları */}
                  {showEngineSettings && (
                    <div className="p-3.5 bg-[#22201d] border-b border-[#3692e7] flex flex-col gap-2.5 text-xs">
                      <div className="grid grid-cols-12 items-center gap-2">
                        <span className="col-span-4 text-[#bababa]">Motor</span>
                        <div className="col-span-8">
                          <select
                            value={engineVariantName}
                            onChange={(e) => setEngineVariantName(e.target.value)}
                            className="w-full px-2 py-1 rounded bg-[#161512] border border-[#3692e7] text-white text-xs"
                          >
                            <option value="Stockfish 19 · 1MB NNUE">
                              Stockfish 19 · 1MB NNUE
                            </option>
                            <option value="Stockfish 16 · 7MB NNUE">
                              Stockfish 16 · 7MB NNUE
                            </option>
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-12 items-center gap-2">
                        <span className="col-span-4 text-[#bababa]">
                          Arama süresi
                        </span>
                        <div className="col-span-6">
                          <input
                            type="range"
                            min={1}
                            max={15}
                            value={analysisSearchTimeSec}
                            onChange={(e) =>
                              setAnalysisSearchTimeSec(Number(e.target.value))
                            }
                            className="w-full accent-[#1b78d0] cursor-pointer"
                          />
                        </div>
                        <span className="col-span-2 text-right font-mono font-bold text-white">
                          {analysisSearchTimeSec}s
                        </span>
                      </div>
                      <div className="grid grid-cols-12 items-center gap-2">
                        <span className="col-span-4 text-[#bababa]">Derinlik</span>
                        <div className="col-span-6">
                          <input
                            type="range"
                            min={8}
                            max={25}
                            value={analysisMaxDepth}
                            onChange={(e) =>
                              setAnalysisMaxDepth(Number(e.target.value))
                            }
                            className="w-full accent-[#1b78d0] cursor-pointer"
                          />
                        </div>
                        <span className="col-span-2 text-right font-mono font-bold text-white">
                          {analysisMaxDepth}
                        </span>
                      </div>
                      <div className="grid grid-cols-12 items-center gap-2">
                        <span className="col-span-4 text-[#bababa]">
                          Çoklu varyantlar
                        </span>
                        <div className="col-span-6">
                          <input
                            type="range"
                            min={1}
                            max={5}
                            value={analysisMultiPV}
                            onChange={(e) =>
                              setAnalysisMultiPV(Number(e.target.value))
                            }
                            className="w-full accent-[#1b78d0] cursor-pointer"
                          />
                        </div>
                        <span className="col-span-2 text-right font-mono font-bold text-white">
                          {analysisMultiPV} / 5
                        </span>
                      </div>
                      <div className="grid grid-cols-12 items-center gap-2">
                        <span className="col-span-4 text-[#bababa]">
                          İş parçacığı
                        </span>
                        <div className="col-span-6">
                          <input
                            type="range"
                            min={1}
                            max={20}
                            value={analysisThreadsSkill}
                            onChange={(e) =>
                              setAnalysisThreadsSkill(Number(e.target.value))
                            }
                            className="w-full accent-[#1b78d0] cursor-pointer"
                          />
                        </div>
                        <span className="col-span-2 text-right font-mono font-bold text-white">
                          {analysisThreadsSkill} / 20
                        </span>
                      </div>
                      <div className="grid grid-cols-12 items-center gap-2">
                        <span className="col-span-4 text-[#bababa]">Hafıza</span>
                        <div className="col-span-6">
                          <input
                            type="range"
                            min={16}
                            max={128}
                            step={16}
                            value={analysisHashMb}
                            onChange={(e) =>
                              setAnalysisHashMb(Number(e.target.value))
                            }
                            className="w-full accent-[#1b78d0] cursor-pointer"
                          />
                        </div>
                        <span className="col-span-2 text-right font-mono font-bold text-white">
                          {analysisHashMb}MB
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Canlı Çoklu Varyant Satırları (1..5) */}
                  {engineEnabled && liveAnalysisLines.length > 0 && (
                    <div className="px-3 py-2 bg-[#1a1816] border-b border-[#3c3934] space-y-1">
                      {liveAnalysisLines
                        .slice(0, analysisMultiPV)
                        .map((line, idx) => {
                          const scoreStr =
                            line.type === 'mate'
                              ? `M${Math.abs(line.value)}`
                              : `${line.value > 0 ? '+' : ''}${line.value.toFixed(
                                  2
                                )}`;
                          return (
                            <div
                              key={line.multipv || idx}
                              className="flex items-center gap-2 text-xs font-mono"
                            >
                              <span className="text-[10px] text-[#888] w-4">
                                #{idx + 1}
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  idx === 0
                                    ? 'bg-[#629924] text-white'
                                    : 'bg-[#3692e7]/25 text-[#72b8ff]'
                                }`}
                              >
                                {scoreStr}
                              </span>
                              <span className="text-[#e0e0e0] truncate">
                                {(line.pv || []).slice(0, 6).join(' ')}
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  )}

                  <div className="p-4 flex flex-col gap-3">

                  {isAnalyzingFullGame ? (
                    <div className="py-3 flex flex-col gap-2">
                      <div className="flex justify-between text-xs text-white font-medium">
                        <span>Stockfish hamle doğruluklarını hesaplıyor...</span>
                        <span className="text-[#8cd936] font-bold">
                          %{reviewProgress}
                        </span>
                      </div>
                      <div className="w-full h-2 bg-[#161512] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#629924] transition-all duration-150"
                          style={{ width: `${reviewProgress}%` }}
                        />
                      </div>
                    </div>
                  ) : !gameReviewData ? (
                    <div className="flex flex-col gap-2">
                      <p className="text-xs text-[#bababa]">
                        Her iki tarafın doğruluk yüzdesini (% Accuracy), en iyi
                        hamleleri ve hataları görmek için analizi başlatın.
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => runFullGameAccuracyReview()}
                          className="py-2 px-3 rounded bg-[#3692e7] hover:bg-[#48a1f2] text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow"
                        >
                          <Award className="w-3.5 h-3.5" />
                          Doğruluk Oranlarını Çıkar
                        </button>
                        <button
                          type="button"
                          onClick={openCurrentMatchInAnalysisStudio}
                          className="py-2 px-3 rounded bg-[#302e2c] hover:bg-[#3c3934] text-white text-xs font-semibold border border-[#3c3934] flex items-center justify-center gap-1.5"
                        >
                          <Compass className="w-3.5 h-3.5 text-[#629924]" />
                          Analiz Tahtasında Aç
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {/* LICHESS STİLİ BEYAZ & SİYAH DOĞRULUK VE HATA ANALİZ KARTLARI */}
                      <div className="space-y-3">
                        {/* ⚪ Beyaz Kartı */}
                        <div className="p-3.5 rounded-lg bg-[#1e1c19] border border-[#3c3934] flex flex-col gap-2.5">
                          <div className="flex items-center justify-between border-b border-[#3c3934]/60 pb-2">
                            <div className="flex items-center gap-2">
                              <span className="w-3.5 h-3.5 rounded-full bg-white border border-neutral-400 inline-block shadow-sm" />
                              <span className="font-bold text-white text-xs">
                                {importedGameMeta?.white || 'Beyaz'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-lg font-black text-white">
                                %{gameReviewData.whiteAccuracy}
                              </span>
                              <span className="text-[11px] text-[#888]">Doğruluk</span>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3 text-xs">
                            <div className="space-y-1 text-[#aaa]">
                              <div className="flex items-center justify-between">
                                <span className="text-[#e68a2e] font-bold">
                                  {gameReviewData.counts.w.inaccuracy}
                                </span>
                                <span>Kusurlu hamle</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-orange-500 font-bold">
                                  {gameReviewData.counts.w.mistake}
                                </span>
                                <span>Hata</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-red-500 font-bold">
                                  {gameReviewData.counts.w.blunder}
                                </span>
                                <span>Vahim hata</span>
                              </div>
                              <div className="flex items-center justify-between text-[11px] pt-1 border-t border-[#3c3934]/40">
                                <span className="text-white font-bold">
                                  {gameReviewData.whiteAcpl || 0}
                                </span>
                                <span className="text-[#888]">Ortalama santipiyon kaybı</span>
                              </div>
                            </div>

                            <div className="space-y-1 text-right text-[#aaa] border-l border-[#3c3934]/60 pl-3">
                              <div className="flex items-center justify-between">
                                <span className="text-[#888]">Açılış:</span>
                                <span className="text-[#8cd936] font-bold">
                                  %{gameReviewData.phases?.w?.opening || gameReviewData.whiteAccuracy}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-[#888]">Oyun ortası:</span>
                                <span className="text-[#8cd936] font-bold">
                                  %{gameReviewData.phases?.w?.middlegame || gameReviewData.whiteAccuracy}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-[#888]">Oyun sonu:</span>
                                <span className="text-[#8cd936] font-bold">
                                  %{gameReviewData.phases?.w?.endgame || 100}
                                </span>
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => startMistakeReview('w')}
                            className="w-full mt-1 py-2 px-3 rounded bg-[#3692e7] hover:bg-[#2878c2] text-white text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer shadow"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            BEYAZIN HATALARINI GÖZDEN GEÇİRİN
                          </button>
                        </div>

                        {/* ⚫ Siyah Kartı */}
                        <div className="p-3.5 rounded-lg bg-[#1e1c19] border border-[#3c3934] flex flex-col gap-2.5">
                          <div className="flex items-center justify-between border-b border-[#3c3934]/60 pb-2">
                            <div className="flex items-center gap-2">
                              <span className="w-3.5 h-3.5 rounded-full bg-black border border-neutral-600 inline-block shadow-sm" />
                              <span className="font-bold text-white text-xs">
                                {importedGameMeta?.black || 'Siyah'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-lg font-black text-white">
                                %{gameReviewData.blackAccuracy}
                              </span>
                              <span className="text-[11px] text-[#888]">Doğruluk</span>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3 text-xs">
                            <div className="space-y-1 text-[#aaa]">
                              <div className="flex items-center justify-between">
                                <span className="text-[#e68a2e] font-bold">
                                  {gameReviewData.counts.b.inaccuracy}
                                </span>
                                <span>Kusurlu hamle</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-orange-500 font-bold">
                                  {gameReviewData.counts.b.mistake}
                                </span>
                                <span>Hata</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-red-500 font-bold">
                                  {gameReviewData.counts.b.blunder}
                                </span>
                                <span>Vahim hata</span>
                              </div>
                              <div className="flex items-center justify-between text-[11px] pt-1 border-t border-[#3c3934]/40">
                                <span className="text-white font-bold">
                                  {gameReviewData.blackAcpl || 0}
                                </span>
                                <span className="text-[#888]">Ortalama santipiyon kaybı</span>
                              </div>
                            </div>

                            <div className="space-y-1 text-right text-[#aaa] border-l border-[#3c3934]/60 pl-3">
                              <div className="flex items-center justify-between">
                                <span className="text-[#888]">Açılış:</span>
                                <span className="text-[#8cd936] font-bold">
                                  %{gameReviewData.phases?.b?.opening || gameReviewData.blackAccuracy}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-[#888]">Oyun ortası:</span>
                                <span className="text-[#e68a2e] font-bold">
                                  %{gameReviewData.phases?.b?.middlegame || gameReviewData.blackAccuracy}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-[#888]">Oyun sonu:</span>
                                <span className="text-[#8cd936] font-bold">
                                  %{gameReviewData.phases?.b?.endgame || 100}
                                </span>
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => startMistakeReview('b')}
                            className="w-full mt-1 py-2 px-3 rounded bg-[#3692e7] hover:bg-[#2878c2] text-white text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer shadow"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            SİYAHIN HATALARINI GÖZDEN GEÇİRİN
                          </button>
                        </div>
                      </div>

                      {/* Hamle Kalitesi Dağılım Tablosu */}
                      <div className="bg-[#1e1c19] rounded border border-[#3c3934] p-2.5 text-xs space-y-1">
                        {Object.values(MOVE_CLASSIFICATIONS).map((cls) => (
                          <div
                            key={cls.id}
                            className="grid grid-cols-7 items-center py-0.5"
                          >
                            <span className="col-span-1 font-bold text-center text-white">
                              {gameReviewData.counts.w[cls.id]}
                            </span>
                            <span
                              className="col-span-5 text-center font-semibold flex items-center justify-center gap-1.5"
                              style={{ color: cls.color }}
                            >
                              <span
                                className="inline-flex w-4 h-4 rounded-full text-[10px] text-white items-center justify-center font-extrabold"
                                style={{ backgroundColor: cls.color }}
                              >
                                {cls.symbol}
                              </span>
                              {cls.label}
                            </span>
                            <span className="col-span-1 font-bold text-center text-white">
                              {gameReviewData.counts.b[cls.id]}
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* Seçili Hamlenin Detaylı Açıklaması */}
                      {activePlayPly > 0 &&
                        gameReviewData.moveAnalyses[activePlayPly - 1] && (
                          <div className="px-3 py-2 rounded bg-[#161512] border border-[#3c3934] flex items-center justify-between text-xs">
                            <div>
                              <span className="font-bold text-white">
                                {Math.ceil(activePlayPly / 2)}.
                                {activePlayPly % 2 === 1 ? '' : '..'}{' '}
                                {
                                  gameReviewData.moveAnalyses[activePlayPly - 1]
                                    .san
                                }
                              </span>{' '}
                              <span
                                className="font-bold"
                                style={{
                                  color:
                                    MOVE_CLASSIFICATIONS[
                                      gameReviewData.moveAnalyses[
                                        activePlayPly - 1
                                      ].classification
                                    ]?.color,
                                }}
                              >
                                (
                                {
                                  MOVE_CLASSIFICATIONS[
                                    gameReviewData.moveAnalyses[
                                      activePlayPly - 1
                                    ].classification
                                  ]?.label
                                }{' '}
                                • %
                                {
                                  gameReviewData.moveAnalyses[activePlayPly - 1]
                                    .accuracy
                                }
                                )
                              </span>
                            </div>
                            {gameReviewData.moveAnalyses[activePlayPly - 1]
                              .bestMoveUci && (
                              <span className="text-[11px] text-[#8cd936] font-mono">
                                En İyi:{' '}
                                {
                                  gameReviewData.moveAnalyses[activePlayPly - 1]
                                    .bestMoveUci
                                }
                              </span>
                            )}
                          </div>
                        )}

                      <button
                        type="button"
                        onClick={openCurrentMatchInAnalysisStudio}
                        className="w-full py-2 rounded bg-[#302e2c] hover:bg-[#3c3934] text-white text-xs font-semibold border border-[#3c3934] flex items-center justify-center gap-1.5"
                      >
                        <Compass className="w-3.5 h-3.5 text-[#3692e7]" />
                        Bu Konumu Serbest Analiz Stüdyosunda Aç
                      </button>
                    </div>
                  )}
                  </div>
                </div>
              )}

              {/* TIKLANABİLİR MAÇ NOTASYONU (SAN) VE GEZİNME PANELİ */}
              <div className="bg-[#262421] border border-[#3c3934] rounded-md overflow-hidden shadow-lg flex flex-col">
                <div className="px-4 py-2.5 bg-[#1e1c19] border-b border-[#3c3934] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2.5 h-2.5 rounded-full ${
                        engineReady
                          ? 'bg-[#629924]'
                          : 'bg-yellow-500 animate-ping'
                      }`}
                    />
                    <span className="text-xs font-bold uppercase tracking-wider text-white">
                      Maç Notasyonu (Tıklanabilir)
                    </span>
                  </div>
                  <span className="text-xs text-[#999]">
                    {activePlayPly}/{moveHistory.length} hamle
                  </span>
                </div>

                {/* CANLI GM2600 AÇILIŞ VE VARYANT İSMİ BANDI */}
                <div className="px-3.5 py-2 bg-[#22201c] border-b border-[#3c3934] flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <BookOpen className="w-3.5 h-3.5 text-[#f0c15c] shrink-0" />
                    <div className="truncate">
                      <span className="text-[11px] font-extrabold px-1.5 py-0.5 rounded bg-[#f0c15c]/20 text-[#f5d07e] mr-1.5 font-mono">
                        {activePlayOpeningInfo.eco}
                      </span>
                      <span className="text-xs font-bold text-white">
                        {activePlayOpeningInfo.name}
                      </span>
                      {activePlayOpeningInfo.variation && (
                        <span className="text-[11px] text-[#bababa] block truncate">
                          Varyant: {activePlayOpeningInfo.variation}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* İleri / Geri Gezinme Butonları */}
                <div className="grid grid-cols-4 bg-[#1a1816] border-b border-[#3c3934] divide-x divide-[#2e2b27]">
                  <button
                    type="button"
                    onClick={() => setViewingPly(0)}
                    disabled={activePlayPly === 0}
                    className="py-1.5 flex items-center justify-center text-[#bababa] hover:text-white hover:bg-[#302e2c] disabled:opacity-35"
                    title="Başlangıç Konumuna Git"
                  >
                    <ChevronsLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setViewingPly(Math.max(0, activePlayPly - 1))
                    }
                    disabled={activePlayPly === 0}
                    className="py-1.5 flex items-center justify-center text-[#bababa] hover:text-white hover:bg-[#302e2c] disabled:opacity-35"
                    title="Önceki Hamle (Sol Ok)"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const next = activePlayPly + 1;
                      setViewingPly(next >= moveHistory.length ? null : next);
                    }}
                    disabled={activePlayPly >= moveHistory.length}
                    className="py-1.5 flex items-center justify-center text-[#bababa] hover:text-white hover:bg-[#302e2c] disabled:opacity-35"
                    title="Sonraki Hamle (Sağ Ok)"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewingPly(null)}
                    disabled={activePlayPly >= moveHistory.length}
                    className="py-1.5 flex items-center justify-center text-[#bababa] hover:text-white hover:bg-[#302e2c] disabled:opacity-35"
                    title="Son Hamleye Git"
                  >
                    <ChevronsRight className="w-4 h-4" />
                  </button>
                </div>

                {/* SAN Hamle Listesi (Her hamleye tıklandığında o pozisyona götürür) */}
                <div className="h-52 sm:h-60 overflow-y-auto divide-y divide-[#2e2b27] text-xs sm:text-sm font-mono">
                  {movePairs.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-[#777] px-4 text-center">
                      <p className="font-sans text-xs">
                        Henüz hamle yapılmadı. Oynanan hamlelere tıklayarak
                        istediğiniz pozisyona dönebilirsiniz.
                      </p>
                    </div>
                  ) : (
                    movePairs.map((pair, idx) => {
                      const wAnalysis =
                        gameReviewData?.moveAnalyses?.[pair.whitePly - 1];
                      const bAnalysis =
                        pair.black &&
                        gameReviewData?.moveAnalyses?.[pair.blackPly - 1];

                      const wCls =
                        wAnalysis &&
                        MOVE_CLASSIFICATIONS[wAnalysis.classification];
                      const bCls =
                        bAnalysis &&
                        MOVE_CLASSIFICATIONS[bAnalysis.classification];

                      return (
                        <div
                          key={pair.moveNumber}
                          className={`grid grid-cols-7 items-center px-3 py-1 ${
                            idx % 2 === 0 ? 'bg-[#262421]' : 'bg-[#22201d]'
                          }`}
                        >
                          <span className="col-span-1 text-[#777] select-none">
                            {pair.moveNumber}.
                          </span>

                          {/* Beyazın Hamlesi (Tıklanabilir) */}
                          <button
                            type="button"
                            onClick={() =>
                              setViewingPly(
                                pair.whitePly === moveHistory.length
                                  ? null
                                  : pair.whitePly
                              )
                            }
                            className={`col-span-3 text-left font-medium px-2 py-1 rounded flex items-center justify-between transition-colors ${
                              activePlayPly === pair.whitePly
                                ? 'bg-[#629924] text-white font-bold shadow'
                                : 'text-[#e0e0e0] hover:bg-[#36332e]'
                            }`}
                          >
                            <span>{pair.white.san}</span>
                            {wCls && (
                              <span
                                className="text-[10px] font-extrabold px-1 rounded"
                                style={{
                                  color:
                                    activePlayPly === pair.whitePly
                                      ? '#fff'
                                      : wCls.color,
                                }}
                              >
                                {wCls.symbol}
                              </span>
                            )}
                          </button>

                          {/* Siyahın Hamlesi (Tıklanabilir) */}
                          {pair.black ? (
                            <button
                              type="button"
                              onClick={() =>
                                setViewingPly(
                                  pair.blackPly === moveHistory.length
                                    ? null
                                    : pair.blackPly
                                )
                              }
                              className={`col-span-3 text-left font-medium px-2 py-1 rounded flex items-center justify-between transition-colors ${
                                activePlayPly === pair.blackPly
                                  ? 'bg-[#629924] text-white font-bold shadow'
                                  : 'text-[#e0e0e0] hover:bg-[#36332e]'
                              }`}
                            >
                              <span>{pair.black.san}</span>
                              {bCls && (
                                <span
                                  className="text-[10px] font-extrabold px-1 rounded"
                                  style={{
                                    color:
                                      activePlayPly === pair.blackPly
                                        ? '#fff'
                                        : bCls.color,
                                  }}
                                >
                                  {bCls.symbol}
                                </span>
                              )}
                            </button>
                          ) : (
                            <span className="col-span-3" />
                          )}
                        </div>
                      );
                    })
                  )}
                  <div ref={moveListEndRef} />
                </div>

                {/* Oyun Kontrolleri */}
                <div className="p-3 bg-[#1e1c19] border-t border-[#3c3934] flex flex-col gap-2">
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setOrientation((prev) => (prev === 'w' ? 'b' : 'w'))
                      }
                      className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded bg-[#302e2c] hover:bg-[#3c3934] text-white text-xs font-medium border border-[#3c3934] transition-colors"
                    >
                      <FlipHorizontal className="w-3.5 h-3.5" />
                      Tahtayı Çevir
                    </button>

                    <button
                      type="button"
                      onClick={handleTakeback}
                      disabled={moveHistory.length === 0 || gameOverState.isOver}
                      className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded bg-[#302e2c] hover:bg-[#3c3934] disabled:opacity-40 disabled:pointer-events-none text-white text-xs font-medium border border-[#3c3934] transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Geri Al
                    </button>

                    {!showResignConfirm ? (
                      <button
                        type="button"
                        onClick={() => setShowResignConfirm(true)}
                        disabled={gameOverState.isOver || moveHistory.length === 0}
                        className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded bg-red-950/60 hover:bg-red-900/70 disabled:opacity-40 disabled:pointer-events-none text-red-200 text-xs font-medium border border-red-800/50 transition-colors"
                      >
                        <Flag className="w-3.5 h-3.5" />
                        Pes Et
                      </button>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={handleConfirmResign}
                          className="flex-1 py-2 rounded bg-red-600 hover:bg-red-500 text-white text-[11px] font-bold"
                        >
                          Onayla
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowResignConfirm(false)}
                          className="px-2 py-2 rounded bg-[#302e2c] text-xs text-[#bababa]"
                        >
                          İptal
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleCopy('pgn')}
                      className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded bg-[#262421] hover:bg-[#302e2c] border border-[#3c3934] text-xs text-[#bababa] hover:text-white transition-colors"
                    >
                      {copiedType === 'pgn' ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-[#629924]" />
                          <span className="text-[#8cd936] font-semibold">
                            PGN Kopyalandı
                          </span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>PGN Kopyala</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleCopy('fen')}
                      className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded bg-[#262421] hover:bg-[#302e2c] border border-[#3c3934] text-xs text-[#bababa] hover:text-white transition-colors"
                    >
                      {copiedType === 'fen' ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-[#629924]" />
                          <span className="text-[#8cd936] font-semibold">
                            FEN Kopyalandı
                          </span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>FEN Kopyala</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleShareCurrentGame}
                      className="col-span-2 flex items-center justify-center gap-1.5 px-2.5 py-2 rounded bg-[#1e293b] hover:bg-[#28384e] border border-[#3b82f6]/50 text-xs text-blue-300 font-semibold transition-colors mt-1 cursor-pointer"
                    >
                      {copiedShareUrl ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-blue-400" />
                          <span className="text-blue-300 font-bold">Maç Linki Kopyalandı!</span>
                        </>
                      ) : (
                        <>
                          <Share2 className="w-3.5 h-3.5" />
                          <span>🔗 Maçı Paylaş / Kalıcı Link Al (/game/:id)</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* STOCKFISH ELO & MAÇ AYARLARI KARTI */}
              <div className="bg-[#262421] border border-[#3c3934] rounded-md p-4 shadow-lg flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-[#629924]" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                      Stockfish Elo & Maç Ayarları
                    </h3>
                  </div>
                  <span className="text-xs font-bold text-[#3692e7]">
                    {botElo} ELO
                  </span>
                </div>

                <input
                  type="range"
                  min={800}
                  max={2800}
                  step={50}
                  value={botElo}
                  onChange={(e) => setBotElo(Number(e.target.value))}
                  className="w-full accent-[#629924] cursor-pointer h-1.5 bg-[#161512] rounded-lg"
                />

                <div className="grid grid-cols-3 gap-1.5">
                  {ELO_PRESETS.map((preset) => (
                    <button
                      key={preset.elo}
                      type="button"
                      onClick={() => setBotElo(preset.elo)}
                      className={`px-2 py-1.5 rounded text-left border transition-colors ${
                        botElo === preset.elo
                          ? 'bg-[#629924]/25 border-[#629924] text-white'
                          : 'bg-[#1e1c19] border-[#3c3934] text-[#bababa] hover:border-[#555]'
                      }`}
                    >
                      <div className="text-xs font-bold">{preset.elo}</div>
                      <div className="text-[10px] text-[#999] truncate">
                        {preset.label}
                      </div>
                    </button>
                  ))}
                </div>

                <div className="pt-2 border-t border-[#3c3934] flex items-center justify-between">
                  <span className="text-xs font-medium text-[#bababa]">
                    Taraf Seçimi:
                  </span>
                  <div className="inline-flex rounded bg-[#1e1c19] p-0.5 border border-[#3c3934]">
                    {[
                      { id: 'w', label: 'Beyaz' },
                      { id: 'random', label: 'Rastgele' },
                      { id: 'b', label: 'Siyah' },
                    ].map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setSideChoice(item.id)}
                        className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                          sideChoice === item.id
                            ? 'bg-[#3c3934] text-white'
                            : 'text-[#888] hover:text-white'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => startNewGame(sideChoice, botElo)}
                  className="w-full py-2 rounded bg-[#629924] hover:bg-[#73b32b] text-white text-xs sm:text-sm font-bold shadow transition-colors flex items-center justify-center gap-1.5"
                >
                  <Play className="w-4 h-4 fill-current" />
                  Seçili Ayarlarla Yeni Maç Başlat
                </button>
              </div>
            </>
          ) : (
            /* =====================================================================
               STOCKFISH ANALİZ STÜDYOSU, AÇILIŞ REHBERİ VE TAHTA YAPICI PANELİ
               ===================================================================== */
            <>
              {/* KART 1: LICHESS TARZI STOCKFISH MOTOR BAŞLIĞI, AYAR PANELİ (⚙) VE ÇOKLU VARYANTLAR (1/5 .. 5/5) */}
              <div className="bg-[#262421] border border-[#3692e7] rounded-md overflow-hidden shadow-lg flex flex-col">
                {/* Lichess Tarzı Üst Motor Barı: Sol Aç/Kapa Toggle + Orta Motor Bilgisi + Sağ Mavi Dişli Çark (⚙) */}
                <div className="bg-[#1e1c19] border-b border-[#3692e7]/60 flex items-stretch justify-between">
                  <div className="flex items-center gap-3 px-3 py-2">
                    {/* Lichess Motor Aç/Kapa Toggle */}
                    <button
                      type="button"
                      onClick={() => setEngineEnabled((v) => !v)}
                      className={`relative w-11 h-6 rounded-full transition-colors flex items-center px-0.5 border ${
                        engineEnabled
                          ? 'bg-[#629924] border-[#73b32b]'
                          : 'bg-[#3c3934] border-[#555]'
                      }`}
                      title={
                        engineEnabled
                          ? 'Stockfish Motorunu Kapat'
                          : 'Stockfish Motorunu Aç'
                      }
                    >
                      <span
                        className={`w-4.5 h-4.5 rounded-full bg-white shadow transform transition-transform flex items-center justify-center text-[10px] font-bold ${
                          engineEnabled
                            ? 'translate-x-5 text-[#629924]'
                            : 'translate-x-0 text-[#777]'
                        }`}
                      >
                        {engineEnabled ? '✓' : '✕'}
                      </span>
                    </button>

                    <div className="leading-tight">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-white">
                          SF 19 1MB
                        </span>
                        <span className="text-xs font-extrabold text-[#629924]">
                          NNUE
                        </span>
                        <span className="text-[11px] font-mono text-[#72b8ff] ml-1">
                          d={evalScore?.depth || analysisMaxDepth}
                        </span>
                      </div>
                      <span className="text-[11px] text-[#999] block">
                        yerel tarayıcı üzerinde
                      </span>
                    </div>
                  </div>

                  {/* Sağ Taraf: Ok Kontrolleri + Lichess Mavi Dişli Çark (⚙) */}
                  <div className="flex items-center">
                    <div className="flex items-center gap-1 pr-2">
                      <button
                        type="button"
                        onClick={() => setShowAnalysisArrows((v) => !v)}
                        className={`px-2 py-1 rounded text-[11px] font-bold border flex items-center gap-1 ${
                          showAnalysisArrows
                            ? 'bg-[#629924]/25 border-[#629924] text-[#8cd936]'
                            : 'bg-[#262421] border-[#3c3934] text-[#888]'
                        }`}
                        title="Stockfish En İyi Hamle Oklarını Aç/Kapat"
                      >
                        {showAnalysisArrows ? (
                          <Eye className="w-3 h-3" />
                        ) : (
                          <EyeOff className="w-3 h-3" />
                        )}
                        <span className="hidden sm:inline">Oklar</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowOpeningArrows((v) => !v)}
                        className={`px-2 py-1 rounded text-[11px] font-bold border flex items-center gap-1 ${
                          showOpeningArrows
                            ? 'bg-[#f0c15c]/25 border-[#f0c15c] text-[#f5d07e]'
                            : 'bg-[#262421] border-[#3c3934] text-[#888]'
                        }`}
                        title="GM2600 Açılış Kitabı Oklarını Aç/Kapat"
                      >
                        <BookOpen className="w-3 h-3" />
                        <span className="hidden sm:inline">Kitap</span>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowEngineSettings((v) => !v)}
                      className={`h-full px-3.5 flex items-center justify-center transition-colors ${
                        showEngineSettings
                          ? 'bg-[#1b78d0] text-white'
                          : 'bg-[#262421] hover:bg-[#302e2c] text-[#bababa] border-l border-[#3c3934]'
                      }`}
                      title="Stockfish Analiz Motoru Ayarları (Arama Süresi, Derinlik, Çoklu Varyant 1-5, Hafıza)"
                    >
                      <Settings className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* LICHESS BİREBİR ÖZELLEŞTİRİLEBİLİR MOTOR AYARLARI MENÜSÜ */}
                {showEngineSettings && (
                  <div className="p-4 bg-[#22201d] border-b-2 border-[#3692e7] flex flex-col gap-3.5 text-xs shadow-inner">
                    {/* Motor Seçimi */}
                    <div className="grid grid-cols-12 items-center gap-2">
                      <span className="col-span-4 text-[#bababa] font-medium">
                        Motor
                      </span>
                      <div className="col-span-8">
                        <select
                          value={engineVariantName}
                          onChange={(e) => setEngineVariantName(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded bg-[#161512] border border-[#3692e7] text-white text-xs font-medium outline-none"
                        >
                          <option value="Stockfish 19 · 1MB NNUE">
                            Stockfish 19 · 1MB NNUE
                          </option>
                          <option value="Stockfish 16 · 7MB NNUE">
                            Stockfish 16 · 7MB NNUE (Derin)
                          </option>
                          <option value="Stockfish ASM · Hızlı">
                            Stockfish ASM · Hızlı Tarayıcı
                          </option>
                        </select>
                      </div>
                    </div>

                    {/* Arama Süresi (Search Time: 1s .. 15s) */}
                    <div className="grid grid-cols-12 items-center gap-2">
                      <span className="col-span-4 text-[#bababa] font-medium">
                        Arama süresi
                      </span>
                      <div className="col-span-6 flex items-center">
                        <input
                          type="range"
                          min={1}
                          max={15}
                          step={1}
                          value={analysisSearchTimeSec}
                          onChange={(e) =>
                            setAnalysisSearchTimeSec(Number(e.target.value))
                          }
                          className="w-full accent-[#1b78d0] cursor-pointer h-1.5 bg-[#161512] rounded-lg"
                        />
                      </div>
                      <span className="col-span-2 text-right font-mono font-bold text-white">
                        {analysisSearchTimeSec}s
                      </span>
                    </div>

                    {/* Maksimum Derinlik (Depth: 8 .. 25) */}
                    <div className="grid grid-cols-12 items-center gap-2">
                      <span className="col-span-4 text-[#bababa] font-medium">
                        Derinlik (Depth)
                      </span>
                      <div className="col-span-6 flex items-center">
                        <input
                          type="range"
                          min={8}
                          max={25}
                          step={1}
                          value={analysisMaxDepth}
                          onChange={(e) =>
                            setAnalysisMaxDepth(Number(e.target.value))
                          }
                          className="w-full accent-[#1b78d0] cursor-pointer h-1.5 bg-[#161512] rounded-lg"
                        />
                      </div>
                      <span className="col-span-2 text-right font-mono font-bold text-white">
                        {analysisMaxDepth}
                      </span>
                    </div>

                    {/* Çoklu Varyantlar (Multi-PV: 1 / 5 .. 5 / 5) */}
                    <div className="grid grid-cols-12 items-center gap-2">
                      <span className="col-span-4 text-[#bababa] font-medium">
                        Çoklu varyantlar
                      </span>
                      <div className="col-span-6 flex items-center">
                        <input
                          type="range"
                          min={1}
                          max={5}
                          step={1}
                          value={analysisMultiPV}
                          onChange={(e) =>
                            setAnalysisMultiPV(Number(e.target.value))
                          }
                          className="w-full accent-[#1b78d0] cursor-pointer h-1.5 bg-[#161512] rounded-lg"
                        />
                      </div>
                      <span className="col-span-2 text-right font-mono font-bold text-white">
                        {analysisMultiPV} / 5
                      </span>
                    </div>

                    {/* İş Parçacığı / Motor Gücü (1 / 20 .. 20 / 20) */}
                    <div className="grid grid-cols-12 items-center gap-2">
                      <span className="col-span-4 text-[#bababa] font-medium">
                        İş parçacığı
                      </span>
                      <div className="col-span-6 flex items-center">
                        <input
                          type="range"
                          min={1}
                          max={20}
                          step={1}
                          value={analysisThreadsSkill}
                          onChange={(e) =>
                            setAnalysisThreadsSkill(Number(e.target.value))
                          }
                          className="w-full accent-[#1b78d0] cursor-pointer h-1.5 bg-[#161512] rounded-lg"
                        />
                      </div>
                      <span className="col-span-2 text-right font-mono font-bold text-white">
                        {analysisThreadsSkill} / 20
                      </span>
                    </div>

                    {/* Hafıza (Hash: 16MB .. 128MB) */}
                    <div className="grid grid-cols-12 items-center gap-2">
                      <span className="col-span-4 text-[#bababa] font-medium">
                        Hafıza
                      </span>
                      <div className="col-span-6 flex items-center">
                        <input
                          type="range"
                          min={16}
                          max={128}
                          step={16}
                          value={analysisHashMb}
                          onChange={(e) =>
                            setAnalysisHashMb(Number(e.target.value))
                          }
                          className="w-full accent-[#1b78d0] cursor-pointer h-1.5 bg-[#161512] rounded-lg"
                        />
                      </div>
                      <span className="col-span-2 text-right font-mono font-bold text-white">
                        {analysisHashMb}MB
                      </span>
                    </div>
                  </div>
                )}

                {/* Stockfish En İyi Devam Yolları (Seçilen Çoklu Varyant 1..5 Sayısına Göre) */}
                {!isBoardEditorOpen && (
                  <div className="p-3 bg-[#1a1816] border-b border-[#3c3934] space-y-1.5">
                    <div className="text-[11px] font-semibold text-[#999] flex items-center justify-between">
                      <span>
                        Stockfish Devam Yolları ({analysisMultiPV} Varyant • Tıkla & Oyna):
                      </span>
                      <span className="font-mono text-[#8cd936]">
                        Derinlik: {evalScore?.depth || analysisMaxDepth} / {analysisMaxDepth}
                      </span>
                    </div>

                    {!engineEnabled ? (
                      <div className="text-xs text-[#777] py-2">
                        Stockfish motoru kapalı. Sol üstteki anahtardan açabilirsiniz.
                      </div>
                    ) : liveAnalysisLines.length === 0 ? (
                      <div className="text-xs text-[#777] py-2">
                        Stockfish varyantları hesaplıyor...
                      </div>
                    ) : (
                      liveAnalysisLines.slice(0, analysisMultiPV).map((line, idx) => {
                        const scoreStr =
                          line.type === 'mate'
                            ? `M${Math.abs(line.value)}`
                            : `${line.value > 0 ? '+' : ''}${line.value.toFixed(
                                2
                              )}`;
                        const firstUci = line.bestMove;
                        return (
                          <div
                            key={line.multipv || idx}
                            onClick={() => {
                              if (firstUci && firstUci.length >= 4) {
                                attemptAnalysisMove(
                                  firstUci.slice(0, 2),
                                  firstUci.slice(2, 4),
                                  firstUci[4]
                                );
                              }
                            }}
                            className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-[#262421] hover:bg-[#302e2c] border border-[#3c3934] cursor-pointer transition-colors"
                          >
                            <span className="text-[10px] font-mono text-[#888] w-4">
                              #{idx + 1}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[11px] font-extrabold font-mono ${
                                idx === 0
                                  ? 'bg-[#629924] text-white'
                                  : 'bg-[#3692e7]/30 text-[#72b8ff]'
                              }`}
                            >
                              {scoreStr}
                            </span>
                            <span className="text-xs font-mono text-[#e0e0e0] truncate">
                              {(line.pv || []).slice(0, 7).join(' ')}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {/* Açılış Kitabı Önerileri (GM2600.bin + Canlı Lichess Masters 2600+ GM Veritabanı) */}
                {!isBoardEditorOpen && (
                  <div className="p-3 bg-[#22201d] border-b border-[#3c3934] space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-xs font-bold text-[#f5d07e] flex items-center gap-1.5 truncate">
                          <BookOpen className="w-3.5 h-3.5 shrink-0" />
                          {activeAnalysisOpeningInfo.eco} •{' '}
                          {activeAnalysisOpeningInfo.name}
                        </span>
                        {activeAnalysisOpeningInfo.variation && (
                          <span className="text-[11px] text-[#bababa] block truncate">
                            Varyant: {activeAnalysisOpeningInfo.variation}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#f0c15c]/20 text-[#f5d07e] font-bold shrink-0">
                        GM2600 Book
                      </span>
                    </div>

                    {currentOpeningBookMatch &&
                      currentOpeningBookMatch.continuations &&
                      currentOpeningBookMatch.continuations.length > 0 && (
                        <div className="grid grid-cols-2 gap-1.5">
                          {currentOpeningBookMatch.continuations.map((cont) => (
                            <button
                              key={cont.san}
                              type="button"
                              onClick={() =>
                                attemptAnalysisMove(cont.from, cont.to)
                              }
                              className="px-2.5 py-1.5 rounded bg-[#1a1816] hover:bg-[#302e2c] border border-[#3c3934] text-left flex items-center justify-between transition-colors"
                            >
                              <div className="min-w-0">
                                <span className="text-xs font-bold text-[#f5d07e] font-mono">
                                  {cont.san}
                                </span>
                                <div className="text-[10px] text-[#999] truncate">
                                  {cont.note}
                                </div>
                              </div>
                              <span className="text-[10px] font-bold text-[#8cd936] ml-1 shrink-0">
                                {cont.games || cont.winRate}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                  </div>
                )}

                {/* Analiz Hamle Geçmişi (Tıklanabilir) */}
                <div className="grid grid-cols-4 bg-[#1a1816] border-b border-[#3c3934] divide-x divide-[#2e2b27]">
                  <button
                    type="button"
                    onClick={() => jumpToAnalysisPly(0)}
                    disabled={analysisPly === 0}
                    className="py-1.5 flex items-center justify-center text-[#bababa] hover:text-white disabled:opacity-35"
                  >
                    <ChevronsLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => jumpToAnalysisPly(analysisPly - 1)}
                    disabled={analysisPly === 0}
                    className="py-1.5 flex items-center justify-center text-[#bababa] hover:text-white disabled:opacity-35"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => jumpToAnalysisPly(analysisPly + 1)}
                    disabled={analysisPly >= analysisTimeline.length - 1}
                    className="py-1.5 flex items-center justify-center text-[#bababa] hover:text-white disabled:opacity-35"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      jumpToAnalysisPly(analysisTimeline.length - 1)
                    }
                    disabled={analysisPly >= analysisTimeline.length - 1}
                    className="py-1.5 flex items-center justify-center text-[#bababa] hover:text-white disabled:opacity-35"
                  >
                    <ChevronsRight className="w-4 h-4" />
                  </button>
                </div>

                <div className="h-36 overflow-y-auto divide-y divide-[#2e2b27] text-xs font-mono">
                  {analysisMovePairs.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-[#777] px-4 text-center font-sans">
                      Analiz tahtasında hem Beyaz hem Siyah taşları serbestçe
                      oynatarak veya aşağıdaki açılışları seçerek devam yollarını
                      inceleyebilirsiniz.
                    </div>
                  ) : (
                    analysisMovePairs.map((pair) => (
                      <div
                        key={pair.moveNumber}
                        className="grid grid-cols-7 items-center px-3 py-1"
                      >
                        <span className="col-span-1 text-[#777]">
                          {pair.moveNumber}.
                        </span>
                        <button
                          type="button"
                          onClick={() => jumpToAnalysisPly(pair.whitePly)}
                          className={`col-span-3 text-left px-2 py-0.5 rounded ${
                            analysisPly === pair.whitePly
                              ? 'bg-[#3692e7] text-white font-bold'
                              : 'text-[#e0e0e0] hover:bg-[#36332e]'
                          }`}
                        >
                          {pair.white.san}
                        </button>
                        {pair.black ? (
                          <button
                            type="button"
                            onClick={() => jumpToAnalysisPly(pair.blackPly)}
                            className={`col-span-3 text-left px-2 py-0.5 rounded ${
                              analysisPly === pair.blackPly
                                ? 'bg-[#3692e7] text-white font-bold'
                                : 'text-[#e0e0e0] hover:bg-[#36332e]'
                            }`}
                          >
                            {pair.black.san}
                          </button>
                        ) : (
                          <span className="col-span-3" />
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* KART 2: TAHTA YAPICI (BOARD EDITOR) VE HAZIR AÇILIŞ ÇALIŞMA KÜTÜPHANESİ */}
              <div className="bg-[#262421] border border-[#3c3934] rounded-md p-4 shadow-lg flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
                    <Wrench className="w-4 h-4 text-[#629924]" />
                    Tahta Yapıcı & Açılış Çalışma
                  </span>

                  <button
                    type="button"
                    onClick={() => {
                      if (!isBoardEditorOpen) {
                        setEditorMatrix(parseFenToBoardMatrix(analysisFen));
                        setEditorError('');
                        setIsBoardEditorOpen(true);
                      } else {
                        applyEditorPositionToAnalysis();
                      }
                    }}
                    className={`px-3 py-1 rounded text-xs font-bold transition-colors ${
                      isBoardEditorOpen
                        ? 'bg-[#629924] text-white'
                        : 'bg-[#3692e7] text-white hover:bg-[#48a1f2]'
                    }`}
                  >
                    {isBoardEditorOpen
                      ? '✓ Konumu Analiz Et'
                      : 'Tahta Yapıcıyı Aç'}
                  </button>
                </div>

                {/* Hızlı Tahta Sıfırlama / Boş Tahta Butonları */}
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (isBoardEditorOpen) {
                        setEditorMatrix(parseFenToBoardMatrix(STARTING_FEN));
                        setEditorError('');
                      } else {
                        loadFamousOpening(FAMOUS_OPENINGS[0]);
                      }
                    }}
                    className="py-1.5 px-2 rounded bg-[#302e2c] hover:bg-[#3c3934] text-white text-xs font-medium border border-[#3c3934] flex items-center justify-center gap-1"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Başlangıç
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setEditorMatrix(parseFenToBoardMatrix(EMPTY_BOARD_FEN));
                      setEditorError('');
                      setIsBoardEditorOpen(true);
                    }}
                    className="py-1.5 px-2 rounded bg-[#302e2c] hover:bg-[#3c3934] text-white text-xs font-medium border border-[#3c3934] flex items-center justify-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    Boş Tahta
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setOrientation((prev) => (prev === 'w' ? 'b' : 'w'))
                    }
                    className="py-1.5 px-2 rounded bg-[#302e2c] hover:bg-[#3c3934] text-white text-xs font-medium border border-[#3c3934] flex items-center justify-center gap-1"
                  >
                    <FlipHorizontal className="w-3.5 h-3.5" />
                    Çevir
                  </button>
                </div>

                {isBoardEditorOpen && (
                  <div className="p-2.5 rounded bg-[#1e1c19] border border-[#3c3934] flex flex-col gap-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[#bababa]">Hamle Sırası Kimde?</span>
                      <div className="inline-flex rounded bg-[#262421] p-0.5 border border-[#3c3934]">
                        <button
                          type="button"
                          onClick={() => setEditorTurn('w')}
                          className={`px-2.5 py-0.5 rounded text-xs font-bold ${
                            editorTurn === 'w'
                              ? 'bg-[#629924] text-white'
                              : 'text-[#888]'
                          }`}
                        >
                          Beyaz
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditorTurn('b')}
                          className={`px-2.5 py-0.5 rounded text-xs font-bold ${
                            editorTurn === 'b'
                              ? 'bg-[#629924] text-white'
                              : 'text-[#888]'
                          }`}
                        >
                          Siyah
                        </button>
                      </div>
                    </div>

                    {editorError && (
                      <div className="text-[11px] text-red-300 bg-red-950/60 border border-red-700/50 rounded p-2">
                        {editorError}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={applyEditorPositionToAnalysis}
                      className="w-full py-2 rounded bg-[#629924] hover:bg-[#73b32b] text-white text-xs font-bold shadow"
                    >
                      Kurulan Tahtayı Stockfish İle Analiz Et
                    </button>
                  </div>
                )}

                {/* Popüler Açılışlar Çalışma Seçici */}
                <div className="pt-2 border-t border-[#3c3934]">
                  <label className="block text-[11px] font-bold uppercase text-[#999] mb-1.5">
                    Hazır Açılış Çalış (Devam Yollarını Oklarla Gösterir):
                  </label>
                  <div className="grid grid-cols-1 gap-1.5 max-h-48 overflow-y-auto pr-1">
                    {FAMOUS_OPENINGS.map((op) => (
                      <button
                        key={op.id}
                        type="button"
                        onClick={() => loadFamousOpening(op)}
                        className="px-3 py-2 rounded bg-[#1e1c19] hover:bg-[#302e2c] border border-[#3c3934] text-left transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white">
                            {op.name}
                          </span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#3692e7]/20 text-[#72b8ff]">
                            {op.eco}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#888] mt-0.5 truncate">
                          {op.description}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
      )}

      {/* YENİ MAÇ MODALI */}
      {showNewGameModal && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowNewGameModal(false);
          }}
        >
          <div className="bg-[#262421] border border-[#3c3934] rounded-lg max-w-md w-full p-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#3c3934]">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Cpu className="w-5 h-5 text-[#629924]" />
                Stockfish Botuna Karşı Yeni Maç
              </h2>
              <button
                type="button"
                onClick={() => setShowNewGameModal(false)}
                className="text-sm text-[#888] hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="py-4 flex flex-col gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-[#bababa] mb-2">
                  Taraf Seçimi
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'w', title: 'Beyaz', pieceColor: 'w' },
                    { id: 'random', title: 'Rastgele', pieceColor: 'w' },
                    { id: 'b', title: 'Siyah', pieceColor: 'b' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setSideChoice(opt.id)}
                      className={`p-2.5 rounded border flex flex-col items-center gap-1.5 transition-colors ${
                        sideChoice === opt.id
                          ? 'bg-[#629924]/20 border-[#629924] text-white'
                          : 'bg-[#1e1c19] border-[#3c3934] text-[#999] hover:text-white'
                      }`}
                    >
                      <div className="w-8 h-8">
                        <ChessPiece color={opt.pieceColor} type="k" />
                      </div>
                      <span className="text-xs font-semibold">{opt.title}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold uppercase text-[#bababa]">
                    Bot Gücü (UCI_Elo + Skill Level)
                  </label>
                  <span className="text-sm font-bold text-[#629924]">
                    {botElo} ELO
                  </span>
                </div>
                <input
                  type="range"
                  min={800}
                  max={2800}
                  step={50}
                  value={botElo}
                  onChange={(e) => setBotElo(Number(e.target.value))}
                  className="w-full accent-[#629924] cursor-pointer"
                />
                <div className="text-[11px] text-[#999] mt-1">
                  Aktif Motor Parametreleri:{' '}
                  <span className="text-white font-mono">
                    Skill={getEngineParamsForElo(botElo).skillLevel}/20, Depth=
                    {getEngineParamsForElo(botElo).depth}
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-[#3c3934] flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewGameModal(false)}
                className="px-4 py-2 rounded bg-[#302e2c] text-xs font-medium text-[#bababa] hover:text-white"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={() => startNewGame(sideChoice, botElo)}
                className="px-5 py-2 rounded bg-[#629924] hover:bg-[#73b32b] text-white text-xs font-bold shadow"
              >
                Maçı Başlat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* KULLANICI GİRİŞ & KAYIT MODALI */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        client={multiplayerClient}
      />
    </div>
  );
}
