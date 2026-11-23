import React from 'react';

export function EvalBar({ evalScore, orientation = 'w', visible = true }) {
  if (!visible) return null;

  // Beyazın yüzdelik üstünlüğünü hesapla (50% = eşit)
  let whitePercent = 50;
  let label = '0.0';

  if (evalScore) {
    if (evalScore.type === 'mate') {
      const m = evalScore.value;
      label = `M${Math.abs(m)}`;
      whitePercent = m > 0 ? 100 : 0;
    } else {
      const cp = evalScore.value;
      const sign = cp > 0 ? '+' : '';
      label = `${sign}${cp.toFixed(1)}`;
      // Sigmoid benzeri yumuşak Lichess ölçeklemesi (-10..+10 piyon aralığı)
      const clamped = Math.max(-10, Math.min(10, cp));
      whitePercent = 50 + (clamped / 10) * 46;
    }
  }

  const isWhiteWinning = whitePercent >= 50;
  const isFlipped = orientation === 'b';

  return (
    <div
      className="relative w-6 sm:w-7 self-stretch rounded overflow-hidden border border-[#3c3934] bg-[#262421] flex flex-col select-none shadow-inner"
      title={`Stockfish Değerlendirmesi: ${label}`}
    >
      {/* Üst ve alt dolgu: orientation === 'w' ise üstte Siyah, altta Beyaz */}
      <div
        className="w-full transition-all duration-300 ease-out"
        style={{
          height: isFlipped ? `${whitePercent}%` : `${100 - whitePercent}%`,
          backgroundColor: isFlipped ? '#e8e6e3' : '#2b2926',
        }}
      />
      <div
        className="w-full transition-all duration-300 ease-out"
        style={{
          height: isFlipped ? `${100 - whitePercent}%` : `${whitePercent}%`,
          backgroundColor: isFlipped ? '#2b2926' : '#e8e6e3',
        }}
      />

      {/* Orta denge çizgisi */}
      <div className="absolute inset-x-0 top-1/2 h-[1.5px] bg-[#629924]/70 pointer-events-none" />

      {/* Skor metni */}
      <span
        className={`absolute inset-x-0 text-[10px] font-bold text-center leading-tight px-0.5 pointer-events-none ${
          (isWhiteWinning && !isFlipped) || (!isWhiteWinning && isFlipped)
            ? 'bottom-1 text-[#161512]'
            : 'top-1 text-[#e8e6e3]'
        }`}
      >
        {label}
      </span>
    </div>
  );
}

export default EvalBar;
