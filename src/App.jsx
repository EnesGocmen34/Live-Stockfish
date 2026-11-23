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
} from 'lucide-react';
import ChessBoard, { BOARD_THEMES } from './components/ChessBoard.jsx';
import ChessPiece from './components/ChessPieces.jsx';
import EvalBar from './components/EvalBar.jsx';
import AccountScout from './components/AccountScout.jsx';
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
  const [showNewGameModal, setShowNewGameModal] = useState(false);
  const [dismissGameOverModal, setDismissGameOverModal] = useState(false);
  const [copiedType, setCopiedType] = useState(null);

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

  // Analiz modunda veya Maç Sonu İnceleme modunda ilgili konumu Stockfish ile canlı analiz et
  useEffect(() => {
    if (!engineRef.current || !engineReady) return;

    if (appMode === 'analysis' && !isBoardEditorOpen) {
      const turnColor = analysisFen.split(' ')[1] || 'w';
      engineRef.current.analyzePosition(analysisFen, turnColor, {
        depth: 15,
        multiPV: 3,
        movetime: 650,
      });
    } else if (appMode === 'play' && (gameOverState.isOver || isReviewingGame) && !isAnalyzingFullGame) {
      const turnColor = displayedPlayFen.split(' ')[1] || 'w';
      engineRef.current.analyzePosition(displayedPlayFen, turnColor, {
        depth: 14,
        multiPV: 2,
        movetime: 500,
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

  // --- MAÇ SONU TAM DOĞRULUK ANALİZİ (GAME REVIEW) ---
  const runFullGameAccuracyReview = useCallback(async () => {
    if (!engineRef.current || moveHistory.length === 0 || isAnalyzingFullGame) return;

    setIsReviewingGame(true);
    setDismissGameOverModal(true);
    setIsAnalyzingFullGame(true);
    setReviewProgress(0);

    const fens = [...fenTimeline];
    const moves = [...moveHistory];
    const posEvals = [];

    // Her pozisyonu hızlıca değerlendir
    for (let i = 0; i < fens.length; i++) {
      const f = fens[i];
      const turnColor = f.split(' ')[1] || 'w';
      const res = await engineRef.current.analyzePosition(f, turnColor, {
        depth: 10,
        multiPV: 1,
        movetime: 170,
      });

      const primary = res && res.lines && res.lines[0]
        ? res.lines[0]
        : { type: 'cp', value: 0, bestMove: res?.bestMove || null };

      posEvals.push({
        type: primary.type || 'cp',
        value: primary.value ?? 0,
        bestMove: res?.bestMove || primary.bestMove || null,
      });

      setReviewProgress(Math.round(((i + 1) / fens.length) * 100));
    }

    // Her hamleyi sınıflandır ve Beyaz/Siyah doğruluk ortalamalarını çıkar
    const moveAnalyses = [];
    const whiteAccList = [];
    const blackAccList = [];
    const counts = {
      w: { best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 },
      b: { best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 },
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
      if (m.color === 'w') whiteAccList.push(result.accuracy);
      else blackAccList.push(result.accuracy);

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
        evalAfter: nextEval,
      });
    }

    const avg = (arr) =>
      arr.length === 0
        ? 100
        : Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10;

    setGameReviewData({
      whiteAccuracy: avg(whiteAccList),
      blackAccuracy: avg(blackAccList),
      counts,
      moveAnalyses,
      posEvals,
    });

    setIsAnalyzingFullGame(false);
    // Analiz bitince kullanıcıyı son hamleye veya ilk hataya odakla
    setViewingPly(moves.length);
  }, [fenTimeline, moveHistory, isAnalyzingFullGame]);

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

  // Sıra Botta ise Otomatik Oynat
  useEffect(() => {
    if (appMode !== 'play') return;
    if (gameOverState.isOver) {
      setIsBotThinking(false);
      return;
    }
    const currentTurn = gameRef.current.turn();
    if (currentTurn !== playerColor) {
      triggerBotMove(fen, botElo, currentTurn);
    }
  }, [appMode, fen, playerColor, botElo, gameOverState.isOver, triggerBotMove]);

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
      setPendingPromotion({
        from: fromSquare,
        to: actualTarget,
        color: playerColor,
      });
      return true;
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
    if (!gameItem || !gameItem.pgn) return;
    const { history, fens } = parseGameMovesAndTimeline(gameItem.pgn);
    if (fens.length === 0) return;

    const loaded = new Chess();
    try {
      loaded.load(fens[fens.length - 1]);
    } catch {
      // ignore
    }

    analysisGameRef.current = loaded;
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

  // Chess.com / Lichess Hesap Analizinden Seçilen Bir Maçı Hamle Hamle Doğruluk İnceleme (Game Review) Modunda Aç
  const handleOpenImportedGameInFullReview = (gameItem) => {
    if (!gameItem || !gameItem.pgn) return;
    if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);
    if (engineRef.current) engineRef.current.stop();
    setIsBotThinking(false);

    const { history, fens } = parseGameMovesAndTimeline(gameItem.pgn);
    if (history.length === 0) return;

    const loaded = new Chess();
    try {
      loaded.loadPgn(gameItem.pgn);
    } catch {
      // ignore
    }

    gameRef.current = loaded;
    const finalFen = fens[fens.length - 1];
    const lastM = history[history.length - 1];

    setPlayerColor(gameItem.userColor || 'w');
    setOrientation(gameItem.userColor || 'w');
    setFen(finalFen);
    setFenTimeline(fens);
    setMoveHistory(history);
    setViewingPly(0);
    setLastMove(lastM ? { from: lastM.from, to: lastM.to } : null);
    setResignWinner(null);
    setIsReviewingGame(true);
    setDismissGameOverModal(true);
    setGameReviewData(null);
    setAppMode('play');
    soundEngine.playMove();
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
      const activeFenStr = appMode === 'analysis' ? analysisFen : displayedPlayFen;
      const text =
        type === 'pgn'
          ? (appMode === 'analysis'
              ? analysisGameRef.current.pgn()
              : game.pgn()) || '1. '
          : activeFenStr;
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
    if (appMode === 'analysis') {
      if (isBoardEditorOpen) return editorMatrix;
      return parseFenToBoardMatrix(analysisFen);
    }
    return parseFenToBoardMatrix(displayedPlayFen);
  }, [appMode, isBoardEditorOpen, editorMatrix, analysisFen, displayedPlayFen]);

  // Görüntülenen konumdaki son hamle vurgusu
  const displayedLastMove = useMemo(() => {
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
    isBoardEditorOpen,
    analysisPly,
    analysisHistory,
    activePlayPly,
    moveHistory,
    lastMove,
  ]);

  // Görüntülenen konumda şah tehdit altında mı?
  const displayedKingInCheckSquare = useMemo(() => {
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
  }, [appMode, isBoardEditorOpen, analysisFen, displayedPlayFen]);

  // Seçili kare için yasal hamleler
  const activeLegalMoves = useMemo(() => {
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
    return detectOpeningAndVariation(moveHistory.slice(0, activePlayPly));
  }, [moveHistory, activePlayPly]);

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

      // Canlı motor okları (maç sonu serbest incelemede)
      liveAnalysisLines.slice(0, 2).forEach((line, idx) => {
        if (line.bestMove && line.bestMove.length >= 4) {
          list.push({
            from: line.bestMove.slice(0, 2),
            to: line.bestMove.slice(2, 4),
            color: idx === 0 ? '#629924' : '#3692e7',
            opacity: idx === 0 ? 0.9 : 0.65,
            strokeWidth: idx === 0 ? 2.5 : 1.9,
          });
        }
      });
      return list;
    }

    // 2) Analiz Stüdyosu Modu
    if (appMode === 'analysis' && !isBoardEditorOpen) {
      if (showAnalysisArrows) {
        liveAnalysisLines.slice(0, 3).forEach((line, idx) => {
          if (line.bestMove && line.bestMove.length >= 4) {
            const scoreText =
              line.type === 'mate'
                ? `M${Math.abs(line.value)}`
                : `${line.value > 0 ? '+' : ''}${line.value.toFixed(1)}`;
            list.push({
              from: line.bestMove.slice(0, 2),
              to: line.bestMove.slice(2, 4),
              color: idx === 0 ? '#629924' : idx === 1 ? '#3692e7' : '#8ca2ad',
              opacity: idx === 0 ? 0.92 : idx === 1 ? 0.72 : 0.55,
              strokeWidth: idx === 0 ? 2.6 : 1.9,
              label: idx === 0 ? scoreText : undefined,
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

  const materialInfo = useMemo(
    () =>
      calculateCapturedAndAdvantage(
        appMode === 'analysis' ? analysisFen : displayedPlayFen
      ),
    [appMode, analysisFen, displayedPlayFen]
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

  const topBarColor = orientation === 'w' ? 'b' : 'w';
  const bottomBarColor = orientation === 'w' ? 'w' : 'b';

  const renderPlayerBar = (barColor) => {
    const isBot = barColor !== playerColor;
    const capturedList =
      barColor === 'w' ? materialInfo.capturedByWhite : materialInfo.capturedByBlack;
    const capturedPieceColor = barColor === 'w' ? 'b' : 'w';
    const advantage =
      barColor === 'w' ? materialInfo.whiteAdvantage : materialInfo.blackAdvantage;
    const currentTurn = (displayedPlayFen.split(' ')[1] || 'w');
    const isActiveTurn = currentTurn === barColor && !gameOverState.isOver;

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
              isBot
                ? 'bg-[#302e2c] border-[#629924]/60 text-[#629924]'
                : 'bg-[#302e2c] border-[#3692e7]/60 text-[#3692e7]'
            }`}
          >
            {isBot ? <Cpu className="w-4 h-4" /> : <Trophy className="w-4 h-4" />}
          </div>

          <div className="truncate">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white truncate">
                {appMode === 'analysis'
                  ? barColor === 'w'
                    ? 'Beyaz (Analiz)'
                    : 'Siyah (Analiz)'
                  : isBot
                  ? 'Stockfish Bot'
                  : 'Sen (Oyuncu)'}
              </span>
              {appMode === 'play' && isBot && (
                <span className="px-1.5 py-0.5 text-[11px] font-bold rounded bg-[#3692e7]/20 text-[#3692e7] border border-[#3692e7]/40">
                  {botElo} ELO
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
          {appMode === 'play' && isBot && isBotThinking && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#629924]/20 border border-[#629924]/50 text-[#8cd936] text-xs font-medium animate-pulse">
              <span className="w-2 h-2 rounded-full bg-[#8cd936] animate-ping" />
              Bot düşünüyor...
            </div>
          )}
          {appMode === 'play' && !isBot && isActiveTurn && !isViewingPastMove && (
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
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-[#262421] border border-[#3c3934] p-1 flex items-center justify-center">
              <ChessPiece color="w" type="n" />
            </div>
            <span className="font-bold text-white tracking-tight text-base sm:text-lg">
              lichess<span className="text-[#629924] font-normal">.arena</span>
            </span>

            {/* ANA MOD SEÇİCİ: BOTLA MAÇ vs STOCKFISH ANALİZ & TAHTA YAPICI vs CHESS.COM/LICHESS HESAP ANALİZİ */}
            <div className="flex flex-wrap items-center bg-[#262421] p-0.5 rounded-md border border-[#3c3934] ml-1 sm:ml-3">
              <button
                type="button"
                onClick={() => setAppMode('play')}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded text-xs font-bold transition-colors ${
                  appMode === 'play'
                    ? 'bg-[#629924] text-white shadow'
                    : 'text-[#bababa] hover:text-white'
                }`}
              >
                <Swords className="w-3.5 h-3.5" />
                Botla Maç
              </button>
              <button
                type="button"
                onClick={() => {
                  if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);
                  if (engineRef.current) engineRef.current.stop();
                  setIsBotThinking(false);
                  setAppMode('analysis');
                }}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded text-xs font-bold transition-colors ${
                  appMode === 'analysis'
                    ? 'bg-[#3692e7] text-white shadow'
                    : 'text-[#bababa] hover:text-white'
                }`}
              >
                <Compass className="w-3.5 h-3.5" />
                Analiz & Tahta Yapıcı
              </button>
              <button
                type="button"
                onClick={() => {
                  if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);
                  if (engineRef.current) engineRef.current.stop();
                  setIsBotThinking(false);
                  setAppMode('scout');
                }}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded text-xs font-bold transition-colors ${
                  appMode === 'scout'
                    ? 'bg-[#e68a2e] text-black shadow'
                    : 'text-[#bababa] hover:text-white'
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5" />
                Chess.com / Lichess Hesap Analizi
              </button>
            </div>
          </div>

          {/* Sağ Üst Kontroller */}
          <div className="flex items-center gap-2">
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

              <div className="relative flex-1 flex justify-center">
                <ChessBoard
                  board={activeBoardMatrix}
                  orientation={orientation}
                  themeKey={boardTheme}
                  selectedSquare={
                    appMode === 'analysis' ? analysisSelectedSq : selectedSquare
                  }
                  legalMovesForSelected={activeLegalMoves}
                  lastMove={displayedLastMove}
                  kingInCheckSquare={displayedKingInCheckSquare}
                  pendingPromotion={
                    appMode === 'analysis' ? analysisPendingPromo : pendingPromotion
                  }
                  arrows={boardArrows}
                  moveBadge={activeMoveBadge}
                  editorMode={appMode === 'analysis' && isBoardEditorOpen}
                  onEditorSquareClick={handleEditorSquareClick}
                  onSquareClick={(sq) => {
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
                      if (gameOverState.isOver || isBotThinking) return;
                      if (isViewingPastMove) {
                        setViewingPly(null);
                        return;
                      }
                      if (game.turn() !== playerColor) return;
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
                    }
                  }}
                  onPieceDrop={(fromSq, toSq) => {
                    if (appMode === 'analysis') {
                      if (isBoardEditorOpen) return;
                      attemptAnalysisMove(fromSq, toSq);
                    } else {
                      if (gameOverState.isOver || isBotThinking || isViewingPastMove)
                        return;
                      attemptPlayerMove(fromSq, toSq);
                    }
                  }}
                  onCompletePromotion={(pieceType) => {
                    if (appMode === 'analysis' && analysisPendingPromo) {
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
                  }}
                  disabled={
                    appMode === 'play' &&
                    (gameOverState.isOver || isViewingPastMove)
                  }
                />

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
                            onClick={runFullGameAccuracyReview}
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
          {appMode === 'play' ? (
            <>
              {/* MAÇ SONU DOĞRULUK RAPORU KARTI (GAME REVIEW) */}
              {(gameOverState.isOver || isReviewingGame) && (
                <div className="bg-[#262421] border-2 border-[#3692e7] rounded-md p-4 shadow-xl flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Award className="w-4 h-4 text-[#3692e7]" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                        Stockfish Maç Sonu Analizi
                      </h3>
                    </div>

                    {/* Maç Sonu Okları Aç / Kapa */}
                    <button
                      type="button"
                      onClick={() => setShowReviewArrows((v) => !v)}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold border transition-colors ${
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
                      <span>Oklar {showReviewArrows ? 'Açık' : 'Kapalı'}</span>
                    </button>
                  </div>

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
                          onClick={runFullGameAccuracyReview}
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
                      {/* Beyaz vs Siyah Doğruluk Kutuları */}
                      <div className="grid grid-cols-2 gap-2.5">
                        <div className="p-2.5 rounded bg-[#1e1c19] border border-[#3c3934] flex flex-col items-center">
                          <span className="text-[11px] text-[#999] font-medium">
                            Beyaz Doğruluk
                          </span>
                          <span className="text-xl font-extrabold text-white mt-0.5">
                            %{gameReviewData.whiteAccuracy}
                          </span>
                        </div>
                        <div className="p-2.5 rounded bg-[#1e1c19] border border-[#3c3934] flex flex-col items-center">
                          <span className="text-[11px] text-[#999] font-medium">
                            Siyah Doğruluk
                          </span>
                          <span className="text-xl font-extrabold text-white mt-0.5">
                            %{gameReviewData.blackAccuracy}
                          </span>
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
              {/* KART 1: STOCKFISH CANLI ÇOKLU VARYANT (MULTI-PV) & OK KONTROLLERİ */}
              <div className="bg-[#262421] border border-[#3692e7] rounded-md overflow-hidden shadow-lg flex flex-col">
                <div className="px-4 py-2.5 bg-[#1e1c19] border-b border-[#3c3934] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Compass className="w-4 h-4 text-[#3692e7]" />
                    <span className="text-xs font-bold uppercase tracking-wider text-white">
                      Stockfish 20. Seviye Analiz Stüdyosu
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
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
                      Motor Okları
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowOpeningArrows((v) => !v)}
                      className={`px-2 py-1 rounded text-[11px] font-bold border flex items-center gap-1 ${
                        showOpeningArrows
                          ? 'bg-[#f0c15c]/25 border-[#f0c15c] text-[#f5d07e]'
                          : 'bg-[#262421] border-[#3c3934] text-[#888]'
                      }`}
                      title="Açılış Kitabı Devam Yolu Oklarını Aç/Kapat"
                    >
                      <BookOpen className="w-3 h-3" />
                      Açılış Okları
                    </button>
                  </div>
                </div>

                {/* Stockfish En İyi 3 Devam Yolu (Multi-PV) */}
                {!isBoardEditorOpen && (
                  <div className="p-3 bg-[#1a1816] border-b border-[#3c3934] space-y-1.5">
                    <div className="text-[11px] font-semibold text-[#999] flex items-center justify-between">
                      <span>Stockfish Önerilen Devam Yolları (Tıkla & Oyna):</span>
                      <span className="font-mono text-[#8cd936]">
                        Derinlik: {evalScore?.depth || 12}
                      </span>
                    </div>

                    {liveAnalysisLines.length === 0 ? (
                      <div className="text-xs text-[#777] py-2">
                        Stockfish varyantları hesaplıyor...
                      </div>
                    ) : (
                      liveAnalysisLines.slice(0, 3).map((line, idx) => {
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
                              {(line.pv || []).slice(0, 6).join(' ')}
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
    </div>
  );
}
