import React, { useState, useRef, useEffect } from 'react';
import ChessPiece from './ChessPieces.jsx';

export const BOARD_THEMES = {
  brown: {
    id: 'brown',
    name: 'Lichess Kahve',
    light: '#f0d9b5',
    dark: '#b58863',
    lastMoveLight: '#cdd26a',
    lastMoveDark: '#aaa23a',
    selected: 'rgba(20, 85, 30, 0.5)',
  },
  green: {
    id: 'green',
    name: 'Turnuva Yeşil',
    light: '#eeeed2',
    dark: '#769656',
    lastMoveLight: '#f6f669',
    lastMoveDark: '#baca2b',
    selected: 'rgba(20, 85, 30, 0.55)',
  },
  blue: {
    id: 'blue',
    name: 'Lichess Mavi',
    light: '#dee3e6',
    dark: '#8ca2ad',
    lastMoveLight: '#c3d888',
    lastMoveDark: '#92b166',
    selected: 'rgba(20, 85, 110, 0.5)',
  },
};

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

const PROMOTION_PIECES = [
  { type: 'q', name: 'Vezir' },
  { type: 'n', name: 'At' },
  { type: 'r', name: 'Kale' },
  { type: 'b', name: 'Fil' },
];

// Kare adını (örn. "e4") 0..100 SVG koordinat merkezine dönüştürür
function squareToSvgCoords(square, orientation = 'w') {
  if (!square || square.length < 2) return null;
  const fileIdx = FILES.indexOf(square[0]);
  const rankIdx = RANKS.indexOf(square[1]);
  if (fileIdx === -1 || rankIdx === -1) return null;

  const col = orientation === 'w' ? fileIdx : 7 - fileIdx;
  const row = orientation === 'w' ? rankIdx : 7 - rankIdx;

  return {
    x: (col + 0.5) * 12.5,
    y: (row + 0.5) * 12.5,
  };
}

export function ChessBoard({
  board,
  orientation = 'w',
  themeKey = 'brown',
  selectedSquare,
  legalMovesForSelected = [],
  lastMove,
  kingInCheckSquare,
  pendingPromotion,
  arrows = [], // [{ from: 'e2', to: 'e4', color: '#629924', opacity: 0.85, label: 'e4' }]
  moveBadge = null, // { square: 'e4', symbol: '★', color: '#629924' }
  editorMode = false,
  onEditorSquareClick,
  onSquareClick,
  onPieceDrop,
  onCompletePromotion,
  onCancelPromotion,
  disabled = false,
}) {
  const theme = BOARD_THEMES[themeKey] || BOARD_THEMES.brown;
  const boardRef = useRef(null);
  const [dragState, setDragState] = useState(null);
  const [userArrows, setUserArrows] = useState([]);
  const [rightDragStart, setRightDragStart] = useState(null);

  const displayedRanks = orientation === 'w' ? RANKS : [...RANKS].reverse();
  const displayedFiles = orientation === 'w' ? FILES : [...FILES].reverse();

  // Konum değiştiğinde kullanıcının sağ tıkla çizdiği geçici okları temizle
  useEffect(() => {
    setUserArrows([]);
  }, [board]);

  const getSquareFromPointer = (clientX, clientY) => {
    if (!boardRef.current) return null;
    const rect = boardRef.current.getBoundingClientRect();
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      return null;
    }
    const relX = clientX - rect.left;
    const relY = clientY - rect.top;
    const colIdx = Math.min(7, Math.max(0, Math.floor((relX / rect.width) * 8)));
    const rowIdx = Math.min(7, Math.max(0, Math.floor((relY / rect.height) * 8)));
    const file = displayedFiles[colIdx];
    const rank = displayedRanks[rowIdx];
    return `${file}${rank}`;
  };

  useEffect(() => {
    if (!dragState) return;

    const handlePointerMove = (e) => {
      if (!boardRef.current) return;
      const rect = boardRef.current.getBoundingClientRect();
      const hoverSq = getSquareFromPointer(e.clientX, e.clientY);
      setDragState((prev) =>
        prev
          ? {
              ...prev,
              x: e.clientX - rect.left,
              y: e.clientY - rect.top,
              hoverSquare: hoverSq,
              hasMoved:
                prev.hasMoved ||
                Math.hypot(e.clientX - prev.startX, e.clientY - prev.startY) > 5,
            }
          : null
      );
    };

    const handlePointerUp = (e) => {
      const targetSquare = getSquareFromPointer(e.clientX, e.clientY);
      const fromSquare = dragState.fromSquare;
      setDragState(null);

      if (targetSquare && targetSquare !== fromSquare) {
        onPieceDrop(fromSquare, targetSquare);
      }
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [dragState, orientation]);

  const handleSquarePointerDown = (e, square, piece) => {
    // Sağ tık ile Lichess tarzı özel ok çizimi başlatma
    if (e.button === 2) {
      e.preventDefault();
      setRightDragStart(square);
      return;
    }

    if (userArrows.length > 0) {
      setUserArrows([]);
    }

    // Tahta Yapıcı (Board Editor) modundaysa doğrudan taşı koy/sil
    if (editorMode && onEditorSquareClick) {
      onEditorSquareClick(square);
      return;
    }

    if (disabled || pendingPromotion) return;
    if (e.button !== undefined && e.button !== 0) return;

    const isTargetOfSelected = legalMovesForSelected.some((m) => m.to === square);
    if (selectedSquare && isTargetOfSelected) {
      onSquareClick(square);
      return;
    }

    onSquareClick(square);

    if (piece && boardRef.current) {
      const rect = boardRef.current.getBoundingClientRect();
      setDragState({
        fromSquare: square,
        piece,
        startX: e.clientX,
        startY: e.clientY,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        hoverSquare: square,
        hasMoved: false,
      });
    }
  };

  const handleBoardPointerUp = (e) => {
    if (e.button === 2 && rightDragStart) {
      const targetSq = getSquareFromPointer(e.clientX, e.clientY);
      if (targetSq && targetSq !== rightDragStart) {
        setUserArrows((prev) => {
          const exists = prev.some(
            (a) => a.from === rightDragStart && a.to === targetSq
          );
          if (exists) {
            return prev.filter(
              (a) => !(a.from === rightDragStart && a.to === targetSq)
            );
          }
          return [
            ...prev,
            {
              from: rightDragStart,
              to: targetSq,
              color: '#e68a2e',
              opacity: 0.85,
            },
          ];
        });
      }
      setRightDragStart(null);
    }
  };

  const getPromotionPosition = () => {
    if (!pendingPromotion) return null;
    const targetFile = pendingPromotion.to[0];
    const targetRank = pendingPromotion.to[1];
    const colIdx = displayedFiles.indexOf(targetFile);
    const isTop =
      (orientation === 'w' && targetRank === '8') ||
      (orientation === 'b' && targetRank === '1');
    return {
      colIdx: colIdx >= 0 ? colIdx : 0,
      isTop,
    };
  };

  const promoPos = getPromotionPosition();
  const combinedArrows = [...arrows, ...userArrows];

  return (
    <div
      ref={boardRef}
      onContextMenu={(e) => e.preventDefault()}
      onPointerUp={handleBoardPointerUp}
      className="relative aspect-square w-full max-w-[min(94vw,560px)] sm:max-w-[560px] lg:max-w-[600px] rounded-[3px] shadow-[0_8px_28px_rgba(0,0,0,0.65)] overflow-hidden select-none touch-none border border-[#3c3934]"
    >
      {/* 8x8 Satranç Kareleri */}
      <div className="grid grid-cols-8 grid-rows-8 w-full h-full">
        {displayedRanks.map((rank, rIdx) =>
          displayedFiles.map((file, fIdx) => {
            const square = `${file}${rank}`;
            const fileNum = FILES.indexOf(file);
            const rankNum = RANKS.indexOf(rank);
            const isLight = (fileNum + rankNum) % 2 === 0;
            const piece = board[rankNum][fileNum];

            const isSelected = selectedSquare === square && !editorMode;
            const isLastMove =
              !editorMode &&
              lastMove &&
              (lastMove.from === square || lastMove.to === square);
            const isKingInCheck = !editorMode && kingInCheckSquare === square;
            const legalMove = !editorMode
              ? legalMovesForSelected.find((m) => m.to === square)
              : null;
            const isDragHover =
              dragState && dragState.hoverSquare === square && legalMove;

            let bgColor = isLight ? theme.light : theme.dark;
            if (isLastMove) {
              bgColor = isLight ? theme.lastMoveLight : theme.lastMoveDark;
            }

            const isBeingDragged =
              dragState && dragState.fromSquare === square && dragState.hasMoved;

            const isCaptureMove =
              legalMove && (Boolean(piece) || legalMove.flags.includes('e'));

            const hasBadge = moveBadge && moveBadge.square === square;

            return (
              <div
                key={square}
                onPointerDown={(e) => handleSquarePointerDown(e, square, piece)}
                className="relative w-full h-full flex items-center justify-center cursor-pointer"
                style={{ backgroundColor: bgColor }}
              >
                {isSelected && (
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{ backgroundColor: theme.selected }}
                  />
                )}

                {isDragHover && (
                  <div
                    className="absolute inset-0 pointer-events-none ring-2 ring-inset ring-[#14551e]/70"
                    style={{ backgroundColor: 'rgba(20, 85, 30, 0.35)' }}
                  />
                )}

                {isKingInCheck && (
                  <div className="absolute inset-0 pointer-events-none lichess-check-glow animate-pulse" />
                )}

                {/* Koordinat Etiketleri */}
                {fIdx === 7 && (
                  <span
                    className="absolute top-0.5 right-1 text-[10px] sm:text-[11px] font-bold leading-none pointer-events-none"
                    style={{ color: isLight ? theme.dark : theme.light }}
                  >
                    {rank}
                  </span>
                )}
                {rIdx === 7 && (
                  <span
                    className="absolute bottom-0.5 left-1 text-[10px] sm:text-[11px] font-bold leading-none pointer-events-none"
                    style={{ color: isLight ? theme.dark : theme.light }}
                  >
                    {file}
                  </span>
                )}

                {/* Satranç Taşı */}
                {piece && (
                  <div
                    className={`w-[88%] h-[88%] z-10 transition-transform duration-75 ${
                      isBeingDragged ? 'opacity-25 scale-95' : 'opacity-100'
                    }`}
                  >
                    <ChessPiece color={piece.color} type={piece.type} />
                  </div>
                )}

                {/* Hamle Kalitesi Rozeti (★, !, ?!, ?, ??) */}
                {hasBadge && (
                  <div
                    className="absolute -top-0.5 -right-0.5 z-30 w-5 h-5 sm:w-5.5 sm:h-5.5 rounded-full flex items-center justify-center text-[10px] sm:text-[11px] font-extrabold text-white shadow-md border border-black/40 pointer-events-none"
                    style={{ backgroundColor: moveBadge.color }}
                    title={moveBadge.label}
                  >
                    {moveBadge.symbol}
                  </div>
                )}

                {/* Yasal Hamle Noktaları */}
                {legalMove && !isCaptureMove && (
                  <div className="w-[26%] h-[26%] rounded-full bg-[#14551e]/45 z-20 pointer-events-none" />
                )}

                {legalMove && isCaptureMove && (
                  <div className="absolute inset-0 pointer-events-none z-20 lichess-capture-ring">
                    <span className="absolute top-0 left-0 w-2.5 h-2.5 border-t-[3px] border-l-[3px] border-[#14551e]/60" />
                    <span className="absolute top-0 right-0 w-2.5 h-2.5 border-t-[3px] border-r-[3px] border-[#14551e]/60" />
                    <span className="absolute bottom-0 left-0 w-2.5 h-2.5 border-b-[3px] border-l-[3px] border-[#14551e]/60" />
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 border-b-[3px] border-r-[3px] border-[#14551e]/60" />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* LICHESS STİLİ SVG OK KATMANI (Stockfish En İyi Hamle & Açılış Devam Yolu Okları) */}
      {combinedArrows.length > 0 && (
        <svg
          viewBox="0 0 100 100"
          className="absolute inset-0 w-full h-full pointer-events-none z-25"
        >
          {combinedArrows.map((arrow, idx) => {
            const start = squareToSvgCoords(arrow.from, orientation);
            const end = squareToSvgCoords(arrow.to, orientation);
            if (!start || !end) return null;

            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const len = Math.hypot(dx, dy);
            if (len < 1) return null;

            const ux = dx / len;
            const uy = dy / len;

            // Ok başı ve gövde koordinatları
            const headLen = 4.4;
            const headWidth = 4.2;
            const strokeW = arrow.strokeWidth || 2.35;

            const startX = start.x + ux * 2.2;
            const startY = start.y + uy * 2.2;
            const lineEndX = end.x - ux * headLen;
            const lineEndY = end.y - uy * headLen;

            const perpX = -uy;
            const perpY = ux;

            const p1x = end.x;
            const p1y = end.y;
            const p2x = lineEndX + perpX * (headWidth / 2);
            const p2y = lineEndY + perpY * (headWidth / 2);
            const p3x = lineEndX - perpX * (headWidth / 2);
            const p3y = lineEndY - perpY * (headWidth / 2);

            const color = arrow.color || '#629924';
            const opacity = arrow.opacity ?? 0.85;

            return (
              <g key={`${arrow.from}-${arrow.to}-${idx}`} opacity={opacity}>
                <line
                  x1={startX}
                  y1={startY}
                  x2={lineEndX}
                  y2={lineEndY}
                  stroke={color}
                  strokeWidth={strokeW}
                  strokeLinecap="round"
                />
                <polygon
                  points={`${p1x},${p1y} ${p2x},${p2y} ${p3x},${p3y}`}
                  fill={color}
                />
                {arrow.label && (
                  <g
                    transform={`translate(${(startX + lineEndX) / 2}, ${
                      (startY + lineEndY) / 2
                    })`}
                  >
                    <rect
                      x="-4.2"
                      y="-2.4"
                      width="8.4"
                      height="4.8"
                      rx="1.2"
                      fill="#161512"
                      stroke={color}
                      strokeWidth="0.45"
                    />
                    <text
                      x="0"
                      y="0.9"
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize="2.6"
                      fontWeight="bold"
                    >
                      {arrow.label}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      )}

      {/* Sürüklenen Taşın Hayaleti (Mobilde parmak altında kalmaması için hafif yukarı/büyük gösterim) */}
      {dragState && dragState.hasMoved && (
        <div
          className="pointer-events-none absolute z-40 w-[13.5%] h-[13.5%] sm:w-[12.5%] sm:h-[12.5%] -translate-x-1/2 -translate-y-[65%] sm:-translate-y-1/2 scale-115 sm:scale-110"
          style={{
            left: `${dragState.x}px`,
            top: `${dragState.y}px`,
          }}
        >
          <ChessPiece color={dragState.piece.color} type={dragState.piece.type} />
        </div>
      )}

      {/* TERFİ (PROMOTION) SEÇİM MENÜSÜ */}
      {pendingPromotion && promoPos && (
        <div
          className="absolute inset-0 z-50 bg-black/55 backdrop-blur-[1px]"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) {
              onCancelPromotion();
            }
          }}
        >
          <div
            className="absolute w-[12.5%] flex flex-col bg-[#262421] border border-[#629924] shadow-[0_8px_30px_rgba(0,0,0,0.85)] rounded-sm overflow-hidden"
            style={{
              left: `${promoPos.colIdx * 12.5}%`,
              top: promoPos.isTop ? '0%' : 'auto',
              bottom: promoPos.isTop ? 'auto' : '0%',
              height: '50%',
            }}
          >
            {(promoPos.isTop ? PROMOTION_PIECES : [...PROMOTION_PIECES].reverse()).map(
              (item) => (
                <button
                  key={item.type}
                  type="button"
                  title={item.name}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onCompletePromotion(item.type);
                  }}
                  className="flex-1 w-full flex items-center justify-center bg-[#f0d9b5] hover:bg-[#cdd26a] active:bg-[#629924] transition-colors border-b border-black/15 last:border-b-0 p-1.5"
                >
                  <ChessPiece color={pendingPromotion.color} type={item.type} />
                </button>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ChessBoard;
