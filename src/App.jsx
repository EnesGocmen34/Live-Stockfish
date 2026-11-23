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
  AlertTriangle,
  Activity,
  Sliders,
  Sparkles,
  ShieldAlert,
} from 'lucide-react';
import ChessBoard, { BOARD_THEMES } from './components/ChessBoard.jsx';
import ChessPiece from './components/ChessPieces.jsx';
import EvalBar from './components/EvalBar.jsx';
import { soundEngine } from './utils/soundEngine.js';
import {
  StockfishController,
  ELO_PRESETS,
  getEngineParamsForElo,
} from './utils/stockfishEngine.js';

const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function calculateCapturedAndAdvantage(fen) {
  const startCounts = {
    w: { p: 8, n: 2, b: 2, r: 2, q: 1 },
    b: { p: 8, n: 2, b: 2, r: 2, q: 1 },
  };
  const currentCounts = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0 },
  };

  const boardPart = fen.split(' ')[0];
  for (const ch of boardPart) {
    if (/[pnbrqPNBRQ]/.test(ch)) {
      const color = ch === ch.toUpperCase() ? 'w' : 'b';
      const type = ch.toLowerCase();
      currentCounts[color][type]++;
    }
  }

  // Beyazın yediği siyah taşlar & Siyahın yediği beyaz taşlar
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

export default function App() {
  // Chess.js kural motoru referansı
  const gameRef = useRef(new Chess());
  const engineRef = useRef(null);
  const botTimeoutRef = useRef(null);
  const moveListEndRef = useRef(null);

  // Oyun Durumu State'leri
  const [fen, setFen] = useState(gameRef.current.fen());
  const [moveHistory, setMoveHistory] = useState([]);
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [lastMove, setLastMove] = useState(null);
  const [pendingPromotion, setPendingPromotion] = useState(null);

  // Bot & Oyuncu Ayarları
  const [playerColor, setPlayerColor] = useState('w');
  const [sideChoice, setSideChoice] = useState('w'); // 'w' | 'b' | 'random'
  const [orientation, setOrientation] = useState('w');
  const [botElo, setBotElo] = useState(1500);
  const [isBotThinking, setIsBotThinking] = useState(false);
  const [engineReady, setEngineReady] = useState(false);

  // Görsel & Yardımcı Ayarlar
  const [boardTheme, setBoardTheme] = useState('brown');
  const [muted, setMuted] = useState(false);
  const [showEvalBar, setShowEvalBar] = useState(true);
  const [evalScore, setEvalScore] = useState({ type: 'cp', value: 0.2, depth: 10 });

  // Modallar ve Bildirimler
  const [resignWinner, setResignWinner] = useState(null);
  const [showResignConfirm, setShowResignConfirm] = useState(false);
  const [showNewGameModal, setShowNewGameModal] = useState(false);
  const [ dismissGameOverModal, setDismissGameOverModal ] = useState(false);
  const [copiedType, setCopiedType] = useState(null); // 'pgn' | 'fen' | null

  // Stockfish Web Worker Başlatma
  useEffect(() => {
    const controller = new StockfishController();
    controller.onEvalUpdate = (score) => {
      setEvalScore(score);
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

  // Hamle listesi güncellendiğinde en alta kaydır
  useEffect(() => {
    if (moveListEndRef.current) {
      moveListEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [moveHistory.length]);

  const game = gameRef.current;
  const board = useMemo(() => game.board(), [fen]);
  const turn = game.turn();
  const inCheck = game.inCheck();
  const gameOverState = useMemo(() => inspectGameOver(game, resignWinner), [fen, resignWinner]);

  // Şah çekildiğinde şahın bulunduğu kareyi tespit et
  const kingInCheckSquare = useMemo(() => {
    if (!inCheck) return null;
    const b = game.board();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = b[r][c];
        if (p && p.type === 'k' && p.color === turn) {
          return p.square;
        }
      }
    }
    return null;
  }, [fen, inCheck, turn]);

  // Seçili taş için yasal hamleleri hesapla (%100 FIDE / chess.js doğrulaması)
  const legalMovesForSelected = useMemo(() => {
    if (!selectedSquare || gameOverState.isOver) return [];
    try {
      return game.moves({ square: selectedSquare, verbose: true });
    } catch {
      return [];
    }
  }, [selectedSquare, fen, gameOverState.isOver]);

  // Hamle sesini oynat
  const triggerSoundForMove = useCallback((moveObj) => {
    if (!moveObj) return;
    if (gameRef.current.isGameOver()) {
      const overInfo = inspectGameOver(gameRef.current, null);
      soundEngine.playGameEnd(overInfo.winner === playerColor);
      return;
    }
    if (gameRef.current.inCheck()) {
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
  }, [playerColor]);

  // Bot Hamlesini Tetikle
  const triggerBotMove = useCallback(
    async (currentFen, currentElo, botColor) => {
      if (!engineRef.current) return;
      if (gameRef.current.isGameOver()) return;

      setIsBotThinking(true);
      const startTime = performance.now();

      const bestMoveUci = await engineRef.current.getBestMove(
        currentFen,
        currentElo,
        botColor
      );

      // Eğer kullanıcı bu sırada yeni oyun açtıysa, hamle geri aldıysa veya sıra değiştiyse iptal et (%0 race condition)
      if (
        !bestMoveUci ||
        gameRef.current.fen() !== currentFen ||
        gameRef.current.turn() !== botColor
      ) {
        setIsBotThinking(false);
        return;
      }

      // Doğal oynayış: 350ms - 680ms arası yapay düşünme gecikmesi
      const elapsed = performance.now() - startTime;
      const targetDelay = 360 + Math.floor(Math.random() * 320);
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
        const promotion = bestMoveUci.length >= 5 ? bestMoveUci[4].toLowerCase() : undefined;

        try {
          const moveObj = gameRef.current.move({
            from,
            to,
            promotion: promotion || 'q',
          });

          if (moveObj) {
            const nextFen = gameRef.current.fen();
            setFen(nextFen);
            setMoveHistory(gameRef.current.history({ verbose: true }));
            setLastMove({ from: moveObj.from, to: moveObj.to });
            setSelectedSquare(null);
            setIsBotThinking(false);
            triggerSoundForMove(moveObj);

            // Pozisyon değerlendirmesini güncelle
            if (!gameRef.current.isGameOver() && engineRef.current) {
              engineRef.current.evaluatePosition(nextFen, gameRef.current.turn());
            } else if (gameRef.current.isCheckmate()) {
              setEvalScore({
                type: 'mate',
                value: gameRef.current.turn() === 'w' ? -1 : 1,
                depth: 20,
              });
            }
          } else {
            setIsBotThinking(false);
          }
        } catch (err) {
          console.error('Bot hamlesi uygulanamadı:', err);
          setIsBotThinking(false);
        }
      }, remainingDelay);
    },
    [triggerSoundForMove]
  );

  // Sıra Botta ise Otomatik Oynat
  useEffect(() => {
    if (gameOverState.isOver) {
      setIsBotThinking(false);
      return;
    }
    const currentTurn = gameRef.current.turn();
    if (currentTurn !== playerColor) {
      triggerBotMove(fen, botElo, currentTurn);
    }
  }, [fen, playerColor, botElo, gameOverState.isOver, triggerBotMove]);

  // Oyuncu Hamlesini Uygula (Terfi Kontrolü + Kalenin Üzerine Bırakarak Rok Desteği)
  const attemptPlayerMove = (fromSquare, toSquare, explicitPromotion = null) => {
    if (gameOverState.isOver || isBotThinking) return false;
    if (game.turn() !== playerColor) return false;

    const pieceOnFrom = game.get(fromSquare);
    if (!pieceOnFrom || pieceOnFrom.color !== playerColor) return false;

    let actualTarget = toSquare;

    // Lichess Rok Kolaylığı: Oyuncu şahı kendi kalesinin üzerine sürükler veya tıklarsa rok karesine dönüştür
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

    if (matchingMoves.length === 0) {
      return false;
    }

    // Terfi hamlesi mi kontrol et (Piyon 8. veya 1. yataya ulaşıyorsa)
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
        setFen(nextFen);
        setMoveHistory(game.history({ verbose: true }));
        setLastMove({ from: moveObj.from, to: moveObj.to });
        setSelectedSquare(null);
        setPendingPromotion(null);
        triggerSoundForMove(moveObj);

        if (game.isCheckmate()) {
          setEvalScore({
            type: 'mate',
            value: game.turn() === 'w' ? -1 : 1,
            depth: 20,
          });
        }
        return true;
      }
    } catch {
      return false;
    }
    return false;
  };

  // Kareye Tıklama (Click-to-Move)
  const handleSquareClick = (square) => {
    if (gameOverState.isOver || isBotThinking) return;
    if (game.turn() !== playerColor) return;

    if (selectedSquare) {
      if (selectedSquare === square) {
        setSelectedSquare(null);
        return;
      }

      const moved = attemptPlayerMove(selectedSquare, square);
      if (moved) return;
    }

    const clickedPiece = game.get(square);
    if (clickedPiece && clickedPiece.color === playerColor) {
      setSelectedSquare(square);
    } else {
      setSelectedSquare(null);
    }
  };

  // Taşı Sürükleyip Bırakma (Drag & Drop)
  const handlePieceDrop = (fromSquare, toSquare) => {
    if (gameOverState.isOver || isBotThinking) return;
    if (game.turn() !== playerColor) return;

    const moved = attemptPlayerMove(fromSquare, toSquare);
    if (!moved) {
      const piece = game.get(fromSquare);
      if (piece && piece.color === playerColor) {
        setSelectedSquare(fromSquare);
      }
    }
  };

  // Terfi Seçimi Tamamlama
  const handleCompletePromotion = (pieceType) => {
    if (!pendingPromotion) return;
    attemptPlayerMove(pendingPromotion.from, pendingPromotion.to, pieceType);
  };

  const handleCancelPromotion = () => {
    setPendingPromotion(null);
    setSelectedSquare(null);
  };

  // Yeni Oyun Başlat
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

    setPlayerColor(resolvedColor);
    setOrientation(resolvedColor);
    setBotElo(customElo);
    setFen(freshGame.fen());
    setMoveHistory([]);
    setSelectedSquare(null);
    setLastMove(null);
    setPendingPromotion(null);
    setResignWinner(null);
    setShowResignConfirm(false);
    setShowNewGameModal(false);
    setDismissGameOverModal(false);
    setIsBotThinking(false);
    setEvalScore({ type: 'cp', value: 0.2, depth: 10 });
    soundEngine.playMove();
  };

  // Hamle Geri Al (Takeback - Hem botun hem oyuncunun son hamlesini geri alır)
  const handleTakeback = () => {
    if (moveHistory.length === 0 || gameOverState.isOver) return;

    if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);
    if (engineRef.current) engineRef.current.stop();
    setIsBotThinking(false);
    setPendingPromotion(null);

    // Eğer sıra oyuncudaysa (bot hamlesini yapmışsa) 2 yarım hamle geri al; bot düşünürken basıldıysa 1 yarım hamle geri al
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
    setMoveHistory(updatedHistory);
    setLastMove(prevMove ? { from: prevMove.from, to: prevMove.to } : null);
    setSelectedSquare(null);
    soundEngine.playMove();

    if (engineRef.current) {
      engineRef.current.evaluatePosition(nextFen, game.turn());
    }
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
      const text = type === 'pgn' ? game.pgn() || '1. ' : fen;
      await navigator.clipboard.writeText(text);
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 2000);
    } catch {
      // Clipboard fallback
    }
  };

  // Ses Aç/Kapa
  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    soundEngine.setMuted(next);
  };

  // Materyal ve Yenen Taş Bilgileri
  const materialInfo = useMemo(() => calculateCapturedAndAdvantage(fen), [fen]);

  // Hamle Geçmişini Çiftler Halinde Grupla (1. e4 e5)
  const movePairs = useMemo(() => {
    const pairs = [];
    for (let i = 0; i < moveHistory.length; i += 2) {
      pairs.push({
        moveNumber: Math.floor(i / 2) + 1,
        white: moveHistory[i],
        black: moveHistory[i + 1] || null,
      });
    }
    return pairs;
  }, [moveHistory]);

  const currentBotPreset = useMemo(() => {
    let closest = ELO_PRESETS[0];
    for (const p of ELO_PRESETS) {
      if (Math.abs(p.elo - botElo) <= Math.abs(closest.elo - botElo)) {
        closest = p;
      }
    }
    return closest;
  }, [botElo]);

  const topBarColor = orientation === 'w' ? 'b' : 'w';
  const bottomBarColor = orientation === 'w' ? 'w' : 'b';

  const renderPlayerBar = (barColor) => {
    const isBot = barColor !== playerColor;
    const capturedList =
      barColor === 'w' ? materialInfo.capturedByWhite : materialInfo.capturedByBlack;
    const capturedPieceColor = barColor === 'w' ? 'b' : 'w';
    const advantage =
      barColor === 'w' ? materialInfo.whiteAdvantage : materialInfo.blackAdvantage;
    const isActiveTurn = turn === barColor && !gameOverState.isOver;

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
                {isBot ? `Stockfish Bot` : 'Sen (Oyuncu)'}
              </span>
              {isBot && (
                <span className="px-1.5 py-0.5 text-[11px] font-bold rounded bg-[#3692e7]/20 text-[#3692e7] border border-[#3692e7]/40">
                  {botElo} ELO
                </span>
              )}
              {!isBot && (
                <span className="px-1.5 py-0.5 text-[11px] font-medium rounded bg-[#3c3934] text-[#bababa]">
                  {barColor === 'w' ? 'Beyaz' : 'Siyah'}
                </span>
              )}
            </div>

            {/* Yenen Taşlar ve Materyal Farkı */}
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

        {/* Sağ Durum Göstergesi */}
        <div className="flex items-center gap-2 shrink-0">
          {isBot && isBotThinking && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#629924]/20 border border-[#629924]/50 text-[#8cd936] text-xs font-medium animate-pulse">
              <span className="w-2 h-2 rounded-full bg-[#8cd936] animate-ping" />
              Bot düşünüyor...
            </div>
          )}
          {!isBot && isActiveTurn && (
            <span className="px-2 py-0.5 rounded bg-[#629924]/20 text-[#8cd936] text-xs font-semibold">
              Hamle Sırası Sende
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#161512] text-[#bababa] flex flex-col">
      {/* ÜST LICHESS HEADER */}
      <header className="border-b border-[#2e2b27] bg-[#1e1c18]/90 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 h-13 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-[#262421] border border-[#3c3934] p-1 flex items-center justify-center">
              <ChessPiece color="w" type="n" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-white tracking-tight text-base sm:text-lg">
                  lichess<span className="text-[#629924] font-normal">.arena</span>
                </span>
                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-full bg-[#262421] border border-[#3c3934] text-[#bababa]">
                  <Sparkles className="w-3 h-3 text-[#629924]" />
                  cburnett SVG • Stockfish WASM
                </span>
              </div>
            </div>
          </div>

          {/* Üst Hızlı Kontroller */}
          <div className="flex items-center gap-2">
            {/* Tahta Teması Seçici */}
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

            {/* Eval Bar Aç/Kapa */}
            <button
              type="button"
              onClick={() => setShowEvalBar((v) => !v)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium border transition-colors ${
                showEvalBar
                  ? 'bg-[#629924]/20 border-[#629924] text-white'
                  : 'bg-[#262421] border-[#3c3934] text-[#bababa] hover:text-white'
              }`}
              title="Canlı Stockfish Değerlendirme Çubuğu"
            >
              <Activity className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Eval Bar</span>
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

            {/* Yeni Oyun Modalı Aç */}
            <button
              type="button"
              onClick={() => setShowNewGameModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#629924] hover:bg-[#73b32b] text-white text-xs sm:text-sm font-semibold shadow transition-colors"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              Yeni Oyun
            </button>
          </div>
        </div>
      </header>

      {/* ANA İÇERİK: SOLDA TAHTA + EVAL BAR, SAĞDA KONTROL VE NOTASYON PANELİ */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-2 sm:px-6 py-4 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* SOL BÖLÜM: OYUNCU BARLARI + EVAL BAR + LICHESS TAHTA */}
        <div className="lg:col-span-7 xl:col-span-8 flex flex-col items-center w-full">
          <div className="w-full max-w-[600px] flex flex-col gap-2">
            {/* Üst Oyuncu Barı */}
            {renderPlayerBar(topBarColor)}

            {/* Orta: EvalBar + 8x8 Satranç Tahtası */}
            <div className="relative flex items-center justify-center gap-2 w-full">
              <EvalBar
                evalScore={evalScore}
                orientation={orientation}
                visible={showEvalBar}
              />

              <div className="relative flex-1 flex justify-center">
                <ChessBoard
                  board={board}
                  orientation={orientation}
                  themeKey={boardTheme}
                  selectedSquare={selectedSquare}
                  legalMovesForSelected={legalMovesForSelected}
                  lastMove={lastMove}
                  kingInCheckSquare={kingInCheckSquare}
                  pendingPromotion={pendingPromotion}
                  onSquareClick={handleSquareClick}
                  onPieceDrop={handlePieceDrop}
                  onCompletePromotion={handleCompletePromotion}
                  onCancelPromotion={handleCancelPromotion}
                  disabled={gameOverState.isOver}
                />

                {/* OYUN SONU (CHECKMATE / STALEMATE / REPETITION / 50-MOVE / INSUFFICIENT) MODAL */}
                {gameOverState.isOver && !dismissGameOverModal && (
                  <div className="absolute inset-0 z-40 bg-black/70 backdrop-blur-[2px] flex items-center justify-center p-4">
                    <div className="bg-[#262421] border-2 border-[#629924] rounded-lg max-w-sm w-full p-5 shadow-2xl text-center animate-in fade-in zoom-in-95 duration-150">
                      <div className="w-12 h-12 rounded-full bg-[#629924]/20 border border-[#629924] text-[#8cd936] mx-auto flex items-center justify-center mb-3">
                        <Trophy className="w-6 h-6" />
                      </div>
                      <h2 className="text-lg sm:text-xl font-bold text-white mb-1">
                        {gameOverState.title}
                      </h2>
                      <p className="text-xs sm:text-sm text-[#bababa] mb-5">
                        {gameOverState.reason}
                      </p>

                      <div className="flex items-center gap-2.5 justify-center">
                        <button
                          type="button"
                          onClick={() => setDismissGameOverModal(true)}
                          className="px-3.5 py-2 rounded bg-[#36332e] hover:bg-[#44403a] text-white text-xs sm:text-sm font-medium transition-colors"
                        >
                          Tahtayı İncele
                        </button>
                        <button
                          type="button"
                          onClick={() => startNewGame(sideChoice, botElo)}
                          className="flex items-center gap-1.5 px-4 py-2 rounded bg-[#629924] hover:bg-[#73b32b] text-white text-xs sm:text-sm font-semibold shadow transition-colors"
                        >
                          <Play className="w-4 h-4 fill-current" />
                          Tekrar Oyna
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Alt Oyuncu Barı */}
            {renderPlayerBar(bottomBarColor)}
          </div>
        </div>

        {/* SAĞ BÖLÜM: HAMLE GEÇMİŞİ, ELO AYARLARI VE OYUN KONTROLLERİ */}
        <div className="lg:col-span-5 xl:col-span-4 w-full max-w-[600px] mx-auto lg:max-w-none flex flex-col gap-4">
          {/* KART 1: HAMLE LİSTESİ (SAN NOTASYONU) VE KONTROL BUTONLARI */}
          <div className="bg-[#262421] border border-[#3c3934] rounded-md overflow-hidden shadow-lg flex flex-col">
            {/* Üst Bilgi Başlığı */}
            <div className="px-4 py-2.5 bg-[#1e1c19] border-b border-[#3c3934] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    engineReady ? 'bg-[#629924]' : 'bg-yellow-500 animate-ping'
                  }`}
                />
                <span className="text-xs font-bold uppercase tracking-wider text-white">
                  Maç Notasyonu (SAN)
                </span>
              </div>
              <span className="text-xs text-[#999]">
                {moveHistory.length} yarım hamle
              </span>
            </div>

            {/* Şah veya Oyun Sonu Durum Bandı */}
            {(inCheck || gameOverState.isOver) && (
              <div
                className={`px-3 py-1.5 text-xs font-semibold flex items-center justify-between ${
                  gameOverState.isOver
                    ? 'bg-[#629924]/25 text-white border-b border-[#629924]/40'
                    : 'bg-red-900/40 text-red-200 border-b border-red-700/40'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  {gameOverState.isOver
                    ? `${gameOverState.title} • ${gameOverState.reason}`
                    : `${turn === 'w' ? 'Beyaz' : 'Siyah'} Şah Tehdit Altında (ŞAH!)`}
                </span>
                {gameOverState.isOver && dismissGameOverModal && (
                  <button
                    type="button"
                    onClick={() => setDismissGameOverModal(false)}
                    className="underline text-[11px] hover:text-white"
                  >
                    Sonucu Göster
                  </button>
                )}
              </div>
            )}

            {/* SAN Hamle Geçmişi Tablosu */}
            <div className="h-52 sm:h-64 overflow-y-auto divide-y divide-[#2e2b27] text-xs sm:text-sm font-mono">
              {movePairs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-[#777] px-4 text-center">
                  <p className="font-sans text-xs">
                    Henüz hamle yapılmadı. Taşı sürükleyerek veya kareye tıklayarak
                    oynayabilirsiniz.
                  </p>
                </div>
              ) : (
                movePairs.map((pair, idx) => (
                  <div
                    key={pair.moveNumber}
                    className={`grid grid-cols-7 items-center px-3 py-1.5 ${
                      idx % 2 === 0 ? 'bg-[#262421]' : 'bg-[#22201d]'
                    }`}
                  >
                    <span className="col-span-1 text-[#777] select-none">
                      {pair.moveNumber}.
                    </span>
                    <span
                      className={`col-span-3 font-medium px-1.5 py-0.5 rounded ${
                        idx === movePairs.length - 1 && !pair.black
                          ? 'bg-[#629924]/30 text-white font-bold'
                          : 'text-[#e0e0e0]'
                      }`}
                    >
                      {pair.white.san}
                    </span>
                    <span
                      className={`col-span-3 font-medium px-1.5 py-0.5 rounded ${
                        idx === movePairs.length - 1 && pair.black
                          ? 'bg-[#629924]/30 text-white font-bold'
                          : 'text-[#e0e0e0]'
                      }`}
                    >
                      {pair.black ? pair.black.san : ''}
                    </span>
                  </div>
                ))
              )}
              <div ref={moveListEndRef} />
            </div>

            {/* Oyun Kontrol Araç Çubuğu */}
            <div className="p-3 bg-[#1e1c19] border-t border-[#3c3934] flex flex-col gap-2">
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setOrientation((prev) => (prev === 'w' ? 'b' : 'w'))
                  }
                  className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded bg-[#302e2c] hover:bg-[#3c3934] text-white text-xs font-medium border border-[#3c3934] transition-colors"
                  title="Tahtayı 180 Derece Çevir"
                >
                  <FlipHorizontal className="w-3.5 h-3.5" />
                  Tahtayı Çevir
                </button>

                <button
                  type="button"
                  onClick={handleTakeback}
                  disabled={moveHistory.length === 0 || gameOverState.isOver}
                  className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded bg-[#302e2c] hover:bg-[#3c3934] disabled:opacity-40 disabled:pointer-events-none text-white text-xs font-medium border border-[#3c3934] transition-colors"
                  title="Son Hamleyi Geri Al (Takeback)"
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
                    title="Oyundan Çekil (Pes Et)"
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

              {/* PGN ve FEN Kopyalama Butonları */}
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

          {/* KART 2: HIZLI STOCKFISH ELO & TARAF AYARLARI */}
          <div className="bg-[#262421] border border-[#3c3934] rounded-md p-4 shadow-lg flex flex-col gap-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-[#629924]" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                  Stockfish Elo & Maç Ayarları
                </h3>
              </div>
              <span className="text-xs font-bold text-[#3692e7]">
                {botElo} ELO ({currentBotPreset.label})
              </span>
            </div>

            {/* Özel Elo Kaydırıcısı (800 - 2800) */}
            <div>
              <input
                type="range"
                min={800}
                max={2800}
                step={50}
                value={botElo}
                onChange={(e) => setBotElo(Number(e.target.value))}
                className="w-full accent-[#629924] cursor-pointer h-1.5 bg-[#161512] rounded-lg"
              />
              <div className="flex justify-between text-[10px] text-[#888] mt-1">
                <span>800 (Başlangıç)</span>
                <span>1500 (Kulüp)</span>
                <span>2200 (Usta)</span>
                <span>2800+ (Max)</span>
              </div>
            </div>

            {/* Hazır Elo Seviye Butonları */}
            <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-3 gap-1.5">
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

            {/* Taraf Seçimi (Beyaz / Rastgele / Siyah) + Başlat */}
            <div className="pt-1 border-t border-[#3c3934] flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
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

              {/* Mobil için Tema Seçici */}
              <div className="flex md:hidden items-center justify-between">
                <span className="text-xs font-medium text-[#bababa]">
                  Tahta Teması:
                </span>
                <div className="flex items-center gap-1">
                  {Object.values(BOARD_THEMES).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setBoardTheme(t.id)}
                      className={`px-2 py-1 rounded text-xs border ${
                        boardTheme === t.id
                          ? 'border-[#629924] text-white bg-[#302e2c]'
                          : 'border-[#3c3934] text-[#888]'
                      }`}
                    >
                      {t.name.split(' ')[1]}
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
          </div>
        </div>
      </main>

      {/* YENİ OYUN KURULUM MODALI */}
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
              {/* Taraf Seçimi */}
              <div>
                <label className="block text-xs font-semibold uppercase text-[#bababa] mb-2">
                  Hangi Tarafla Oynamak İstersin?
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

              {/* Bot Gücü */}
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
