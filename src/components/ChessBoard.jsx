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

export function ChessBoard({
  board,
  orientation = 'w',
  themeKey = 'brown',
  selectedSquare,
  legalMovesForSelected = [],
  lastMove,
  kingInCheckSquare,
  pendingPromotion,
  onSquareClick,
  onPieceDrop,
  onCompletePromotion,
  onCancelPromotion,
  disabled = false,
}) {
  const theme = BOARD_THEMES[themeKey] || BOARD_THEMES.brown;
  const boardRef = useRef(null);

  // Sürükle-bırak (Pointer tabanlı: hem fare hem dokunmatik ekranlarla %100 uyumlu)
  const [dragState, setDragState] = useState(null);

  const displayedRanks = orientation === 'w' ? RANKS : [...RANKS].reverse();
  const displayedFiles = orientation === 'w' ? FILES : [...FILES].reverse();

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
      const moved = dragState.hasMoved;
      setDragState(null);

      if (targetSquare && targetSquare !== fromSquare) {
        onPieceDrop(fromSquare, targetSquare);
      } else if (!moved && targetSquare === fromSquare) {
        // Sadece tıklandı, sürüklenmedi
        // İlk pointerDown'da zaten seçildiği için gerekirse tıklama davranışı korunur
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [dragState, orientation]);

  const handleSquarePointerDown = (e, square, piece) => {
    if (disabled || pendingPromotion) return;
    if (e.button !== undefined && e.button !== 0) return;

    // Önce tıklama mantığını tetikle (eğer zaten bir taş seçiliyse ve bu kare yasal hedefse hamleyi yap)
    const isTargetOfSelected = legalMovesForSelected.some((m) => m.to === square);
    if (selectedSquare && isTargetOfSelected) {
      onSquareClick(square);
      return;
    }

    onSquareClick(square);

    // Eğer karede taş varsa sürüklemeyi başlat
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

  // Terfi menüsü için hedef sütun ve yön hesaplaması
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

  return (
    <div
      ref={boardRef}
      className="relative aspect-square w-full max-w-[min(86vw,560px)] sm:max-w-[560px] lg:max-w-[600px] rounded-[3px] shadow-[0_8px_28px_rgba(0,0,0,0.65)] overflow-hidden select-none touch-none border border-[#3c3934]"
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

            const isSelected = selectedSquare === square;
            const isLastMove =
              lastMove && (lastMove.from === square || lastMove.to === square);
            const isKingInCheck = kingInCheckSquare === square;
            const legalMove = legalMovesForSelected.find((m) => m.to === square);
            const isDragHover =
              dragState && dragState.hoverSquare === square && legalMove;

            let bgColor = isLight ? theme.light : theme.dark;
            if (isLastMove) {
              bgColor = isLight ? theme.lastMoveLight : theme.lastMoveDark;
            }

            const isBeingDragged =
              dragState && dragState.fromSquare === square && dragState.hasMoved;

            // Lichess tarzı en passant dahil taş yakalama kontrolü
            const isCaptureMove =
              legalMove && (Boolean(piece) || legalMove.flags.includes('e'));

            return (
              <div
                key={square}
                onPointerDown={(e) => handleSquarePointerDown(e, square, piece)}
                className="relative w-full h-full flex items-center justify-center cursor-pointer"
                style={{ backgroundColor: bgColor }}
              >
                {/* Seçili Kare Vurgusu */}
                {isSelected && (
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{ backgroundColor: theme.selected }}
                  />
                )}

                {/* Sürükleme Hedef Kare Vurgusu */}
                {isDragHover && (
                  <div
                    className="absolute inset-0 pointer-events-none ring-2 ring-inset ring-[#14551e]/70"
                    style={{ backgroundColor: 'rgba(20, 85, 30, 0.35)' }}
                  />
                )}

                {/* Şah Çekildiğinde Lichess Kırmızı Radyal Parlama */}
                {isKingInCheck && (
                  <div className="absolute inset-0 pointer-events-none lichess-check-glow animate-pulse" />
                )}

                {/* Lichess Koordinat Etiketleri (Sağ kenarda 1-8, alt kenarda a-h) */}
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

                {/* Satranç Taşı (cburnett SVG) */}
                {piece && (
                  <div
                    className={`w-[88%] h-[88%] z-10 transition-transform duration-75 ${
                      isBeingDragged ? 'opacity-25 scale-95' : 'opacity-100'
                    }`}
                  >
                    <ChessPiece color={piece.color} type={piece.type} />
                  </div>
                )}

                {/* Yasal Hamle Göstergeleri (Boş karede şeffaf yeşil nokta, taş yenebilecek karede Lichess köşe üçgenleri) */}
                {legalMove && !isCaptureMove && (
                  <div className="w-[26%] h-[26%] rounded-full bg-[#14551e]/45 z-20 pointer-events-none transition-transform group-hover:scale-125" />
                )}

                {legalMove && isCaptureMove && (
                  <div className="absolute inset-0 pointer-events-none z-20 lichess-capture-ring">
                    {/* Lichess karakteristik 4 köşe vurgusu */}
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

      {/* Sürüklenen Taşın İmleci Takip Eden Hayaleti */}
      {dragState && dragState.hasMoved && (
        <div
          className="pointer-events-none absolute z-40 w-[12.5%] h-[12.5%] -translate-x-1/2 -translate-y-1/2 scale-110"
          style={{
            left: `${dragState.x}px`,
            top: `${dragState.y}px`,
          }}
        >
          <ChessPiece color={dragState.piece.color} type={dragState.piece.type} />
        </div>
      )}

      {/* LICHESS STİLİ TERFİ (PROMOTION) SEÇİM MENÜSÜ */}
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
