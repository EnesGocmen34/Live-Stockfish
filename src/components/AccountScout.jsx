import React, { useState, useMemo, useRef } from 'react';
import {
  Search,
  Cpu,
  Trophy,
  Target,
  Zap,
  Shield,
  BookOpen,
  Play,
  ExternalLink,
  Filter,
  AlertCircle,
  CheckCircle2,
  Square,
  Compass,
  Award,
  BarChart3,
} from 'lucide-react';
import {
  fetchChessComGames,
  fetchLichessGames,
  aggregateAccountStats,
  analyzeSingleGamePhasesWithStockfish,
} from '../utils/accountAnalyzer.js';

export function AccountScout({
  stockfishController,
  onOpenGameInAnalysis,
  onOpenGameInFullReview,
}) {
  const [platform, setPlatform] = useState('chesscom'); // 'chesscom' | 'lichess'
  const [username, setUsername] = useState('');
  const [maxGamesToFetch, setMaxGamesToFetch] = useState(100);
  const [loading, setLoading] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [error, setError] = useState('');

  // Çekilen maçlar listesi
  const [games, setGames] = useState([]);

  // Filtreler
  const [colorFilter, setColorFilter] = useState('all'); // 'all' | 'w' | 'b'
  const [openingFilter, setOpeningFilter] = useState(null); // null veya açılış adı
  const [outcomeFilter, setOutcomeFilter] = useState('all'); // 'all' | 'win' | 'draw' | 'loss'

  // Toplu Stockfish Derin Analiz Durumu (Tarayıcı Web Worker Kuyruğu)
  const [isBatchAnalyzing, setIsBatchAnalyzing] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [batchCountTarget, setBatchCountTarget] = useState(15);
  const abortBatchRef = useRef(false);

  // İstatistikleri hesapla
  const stats = useMemo(() => aggregateAccountStats(games), [games]);

  // Filtrelenmiş maç listesi
  const filteredGames = useMemo(() => {
    return games.filter((g) => {
      if (colorFilter !== 'all' && g.userColor !== colorFilter) return false;
      if (openingFilter && g.openingName !== openingFilter) return false;
      if (outcomeFilter !== 'all' && g.outcome !== outcomeFilter) return false;
      return true;
    });
  }, [games, colorFilter, openingFilter, outcomeFilter]);

  // Hesap Maçlarını Çek
  const handleFetchAccount = async (e) => {
    if (e) e.preventDefault();
    if (!username.trim()) {
      setError('Lütfen Chess.com veya Lichess kullanıcı adınızı yazın.');
      return;
    }

    abortBatchRef.current = true;
    setIsBatchAnalyzing(false);
    setLoading(true);
    setError('');
    setOpeningFilter(null);
    setProgressMsg('Hesap arşivine bağlanılıyor...');

    try {
      const fetched =
        platform === 'chesscom'
          ? await fetchChessComGames(username, maxGamesToFetch, (p) =>
              setProgressMsg(p.message)
            )
          : await fetchLichessGames(username, maxGamesToFetch, (p) =>
              setProgressMsg(p.message)
            );

      setGames(fetched);
      setProgressMsg('');
    } catch (err) {
      setError(err.message || 'Maçlar çekilirken bir hata oluştu.');
    } finally {
      setLoading(false);
    }
  };

  // Tarayıcıdaki Stockfish Web Worker ile Toplu Faz Analizi (Açılış / Taktik / Oyun Sonu Doğruluğu)
  const startStockfishBatchScan = async (count = batchCountTarget) => {
    if (!stockfishController || games.length === 0 || isBatchAnalyzing) return;

    // Öncelikle henüz analiz edilmemiş (veya filtrelenmiş) maçları seç
    const pool = filteredGames.filter((g) => !g.deepAnalysis);
    const targets = pool.slice(0, count);
    if (targets.length === 0) return;

    abortBatchRef.current = false;
    setIsBatchAnalyzing(true);
    setBatchProgress({ current: 0, total: targets.length });

    for (let i = 0; i < targets.length; i++) {
      if (abortBatchRef.current) break;
      const targetGame = targets[i];
      setBatchProgress({ current: i + 1, total: targets.length });

      try {
        const result = await analyzeSingleGamePhasesWithStockfish(
          targetGame,
          stockfishController
        );

        if (result && !abortBatchRef.current) {
          setGames((prev) =>
            prev.map((item) =>
              item.id === targetGame.id
                ? { ...item, deepAnalysis: result }
                : item
            )
          );
        }
      } catch {
        // Tek maçta hata olursa sıradakine geç
      }
    }

    setIsBatchAnalyzing(false);
  };

  const stopStockfishBatchScan = () => {
    abortBatchRef.current = true;
    if (stockfishController) stockfishController.stop();
    setIsBatchAnalyzing(false);
  };

  // Tek bir maçı hemen Stockfish ile analiz edip detay sayfasına veya tabloya yaz
  const analyzeOneGameNow = async (gameItem) => {
    if (!stockfishController || isBatchAnalyzing) return;
    setIsBatchAnalyzing(true);
    setBatchProgress({ current: 1, total: 1 });
    try {
      const res = await analyzeSingleGamePhasesWithStockfish(
        gameItem,
        stockfishController
      );
      if (res) {
        setGames((prev) =>
          prev.map((g) =>
            g.id === gameItem.id ? { ...g, deepAnalysis: res } : g
          )
        );
      }
    } finally {
      setIsBatchAnalyzing(false);
    }
  };

  return (
    <div className="max-w-7xl w-full mx-auto px-3 sm:px-6 py-5 flex flex-col gap-6">
      {/* ÜST ARAMA & PLATFORM SEÇİM KARTI */}
      <div className="bg-[#262421] border border-[#3c3934] rounded-lg p-4 sm:p-5 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-[#629924]" />
              <h1 className="text-base sm:text-lg font-bold text-white">
                Chess.com & Lichess Hesap Röntgeni + Stockfish Repertuvar Analizi
              </h1>
            </div>
            <p className="text-xs text-[#999] mt-1">
              Tüm analizler doğrudan tarayıcınızdaki Stockfish Web Worker üzerinde
              çalışır; sunucuyu yormadan Beyaz/Siyah açılış kazanma yüzdelerinizi,
              taktik keskinliğinizi ve oyun sonu doğruluğunuzu çıkarır.
            </p>
          </div>

          {/* Platform Seçici */}
          <div className="inline-flex rounded-md bg-[#161512] p-1 border border-[#3c3934] self-start">
            <button
              type="button"
              onClick={() => setPlatform('chesscom')}
              className={`px-3.5 py-1.5 rounded text-xs font-bold transition-colors ${
                platform === 'chesscom'
                  ? 'bg-[#629924] text-white shadow'
                  : 'text-[#999] hover:text-white'
              }`}
            >
              Chess.com
            </button>
            <button
              type="button"
              onClick={() => setPlatform('lichess')}
              className={`px-3.5 py-1.5 rounded text-xs font-bold transition-colors ${
                platform === 'lichess'
                  ? 'bg-[#3692e7] text-white shadow'
                  : 'text-[#999] hover:text-white'
              }`}
            >
              Lichess.org
            </button>
          </div>
        </div>

        {/* Kullanıcı Adı Giriş Formu */}
        <form
          onSubmit={handleFetchAccount}
          className="mt-4 grid grid-cols-1 sm:grid-cols-12 gap-2.5"
        >
          <div className="sm:col-span-6 relative">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={
                platform === 'chesscom'
                  ? 'Chess.com kullanıcı adı (örn: Hikaru, MagnusCarlsen)'
                  : 'Lichess kullanıcı adı (örn: DrNykterstein, EricRosen)'
              }
              className="w-full px-3.5 py-2.5 rounded bg-[#161512] border border-[#3c3934] focus:border-[#629924] text-sm text-white placeholder-[#666] outline-none"
            />
          </div>

          <div className="sm:col-span-3">
            <select
              value={maxGamesToFetch}
              onChange={(e) => setMaxGamesToFetch(Number(e.target.value))}
              className="w-full px-3 py-2.5 rounded bg-[#161512] border border-[#3c3934] text-xs sm:text-sm text-white outline-none"
            >
              <option value={50}>Son 50 Maçı Çek</option>
              <option value={100}>Son 100 Maçı Çek</option>
              <option value={200}>Son 200 Maçı Çek</option>
              <option value={350}>Son 350 Maçı Çek</option>
            </select>
          </div>

          <div className="sm:col-span-3">
            <button
              type="submit"
              disabled={loading}
              className="w-full h-full py-2.5 px-4 rounded bg-[#629924] hover:bg-[#73b32b] disabled:opacity-50 text-white text-xs sm:text-sm font-bold shadow flex items-center justify-center gap-2 transition-colors"
            >
              <Search className="w-4 h-4" />
              {loading ? 'Maçlar Çekiliyor...' : 'Tüm Maçları Çek & İncele'}
            </button>
          </div>
        </form>

        {progressMsg && (
          <div className="mt-3 text-xs text-[#8cd936] font-medium flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#8cd936] animate-ping" />
            {progressMsg}
          </div>
        )}

        {error && (
          <div className="mt-3 p-3 rounded bg-red-950/60 border border-red-700/60 text-xs text-red-200 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* EĞER MAÇLAR ÇEKİLDİYSE DETAYLI RAPOR EKRANI */}
      {games.length > 0 && (
        <>
          {/* 1. STOCKFISH TOPLU FAZ ANALİZİ KONTROL BARI (AÇILIŞ / TAKTİK / OYUN SONU DOĞRULUĞU) */}
          <div className="bg-[#262421] border-2 border-[#3692e7] rounded-lg p-4 shadow-xl flex flex-col gap-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Cpu className="w-5 h-5 text-[#3692e7]" />
                  <h2 className="text-sm sm:text-base font-bold text-white">
                    Stockfish Derin Faz Analizi (Açılış • Taktik / Oyun Ortası • Oyun Sonu)
                  </h2>
                  <span className="px-2 py-0.5 text-[11px] font-bold rounded bg-[#3692e7]/20 text-[#72b8ff] border border-[#3692e7]/40">
                    {stats.stockfishAggregate.analyzedCount} / {games.length} Maç
                    Analiz Edildi
                  </span>
                </div>
                <p className="text-xs text-[#bababa] mt-1">
                  Seçtiğiniz sayıda maçı sıra ile Stockfish motoruna taratarak
                  Beyazda/Siyahta açılış doğruluğunuzu, oyun ortası taktik
                  keskinliğinizi ve oyun sonu tekniğinizi hesaplayın.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <select
                  value={batchCountTarget}
                  onChange={(e) => setBatchCountTarget(Number(e.target.value))}
                  disabled={isBatchAnalyzing}
                  className="px-2.5 py-2 rounded bg-[#161512] border border-[#3c3934] text-xs text-white"
                >
                  <option value={10}>10 Maçı Stockfish İle Tara</option>
                  <option value={25}>25 Maçı Stockfish İle Tara</option>
                  <option value={50}>50 Maçı Stockfish İle Tara</option>
                  <option value={games.length}>
                    Tümünü Tara ({games.length} Maç)
                  </option>
                </select>

                {!isBatchAnalyzing ? (
                  <button
                    type="button"
                    onClick={() => startStockfishBatchScan(batchCountTarget)}
                    className="px-4 py-2 rounded bg-[#3692e7] hover:bg-[#48a1f2] text-white text-xs font-bold shadow flex items-center gap-1.5"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    Stockfish Toplu Analizi Başlat
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={stopStockfishBatchScan}
                    className="px-4 py-2 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-bold shadow flex items-center gap-1.5"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    Durdur ({batchProgress.current}/{batchProgress.total})
                  </button>
                )}
              </div>
            </div>

            {isBatchAnalyzing && (
              <div className="w-full bg-[#161512] rounded-full h-2.5 overflow-hidden border border-[#3c3934]">
                <div
                  className="h-full bg-[#3692e7] transition-all duration-200"
                  style={{
                    width: `${Math.round(
                      (batchProgress.current / Math.max(1, batchProgress.total)) *
                        100
                    )}%`,
                  }}
                />
              </div>
            )}

            {/* FAZ VE BECERİ KARNESİ KARTLARI */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
              <div className="p-3 rounded bg-[#1a1816] border border-[#3c3934]">
                <div className="text-[11px] text-[#999] flex items-center gap-1">
                  <Trophy className="w-3.5 h-3.5 text-[#629924]" />
                  Beyaz Kazanma
                </div>
                <div className="text-lg font-extrabold text-white mt-0.5">
                  %{stats.white.winRate}
                </div>
                <div className="text-[10px] text-[#888]">
                  {stats.white.wins}G / {stats.white.draws}B / {stats.white.losses}M
                  {stats.stockfishAggregate.whiteAccuracy !== null &&
                    ` • Doğruluk: %${stats.stockfishAggregate.whiteAccuracy}`}
                </div>
              </div>

              <div className="p-3 rounded bg-[#1a1816] border border-[#3c3934]">
                <div className="text-[11px] text-[#999] flex items-center gap-1">
                  <Shield className="w-3.5 h-3.5 text-[#3692e7]" />
                  Siyah Kazanma
                </div>
                <div className="text-lg font-extrabold text-white mt-0.5">
                  %{stats.black.winRate}
                </div>
                <div className="text-[10px] text-[#888]">
                  {stats.black.wins}G / {stats.black.draws}B / {stats.black.losses}M
                  {stats.stockfishAggregate.blackAccuracy !== null &&
                    ` • Doğruluk: %${stats.stockfishAggregate.blackAccuracy}`}
                </div>
              </div>

              <div className="p-3 rounded bg-[#1a1816] border border-[#3c3934]">
                <div className="text-[11px] text-[#999] flex items-center gap-1">
                  <BookOpen className="w-3.5 h-3.5 text-[#f0c15c]" />
                  Açılış Doğruluğu
                </div>
                <div className="text-lg font-extrabold text-[#f5d07e] mt-0.5">
                  {stats.stockfishAggregate.openingAccuracy !== null
                    ? `%${stats.stockfishAggregate.openingAccuracy}`
                    : 'Analiz Bekliyor'}
                </div>
                <div className="text-[10px] text-[#888]">
                  İlk 10 Hamle Teori Uyumu
                </div>
              </div>

              <div className="p-3 rounded bg-[#1a1816] border border-[#3c3934]">
                <div className="text-[11px] text-[#999] flex items-center gap-1">
                  <Zap className="w-3.5 h-3.5 text-[#8cd936]" />
                  Taktik & Oyun Ortası
                </div>
                <div className="text-lg font-extrabold text-[#8cd936] mt-0.5">
                  {stats.stockfishAggregate.middlegameAccuracy !== null
                    ? `%${stats.stockfishAggregate.middlegameAccuracy}`
                    : `%${stats.shortTacticalGames.winRate} Galibiyet`}
                </div>
                <div className="text-[10px] text-[#888]">
                  {stats.stockfishAggregate.tacticalSharpnessScore !== null
                    ? `Taktik Puanı: ${stats.stockfishAggregate.tacticalSharpnessScore}/100`
                    : `${stats.shortTacticalGames.totalShort} Kısa Taktik Maç`}
                </div>
              </div>

              <div className="p-3 rounded bg-[#1a1816] border border-[#3c3934]">
                <div className="text-[11px] text-[#999] flex items-center gap-1">
                  <Target className="w-3.5 h-3.5 text-[#72b8ff]" />
                  Oyun Sonu Başarısı
                </div>
                <div className="text-lg font-extrabold text-[#72b8ff] mt-0.5">
                  {stats.stockfishAggregate.endgameAccuracy !== null
                    ? `%${stats.stockfishAggregate.endgameAccuracy}`
                    : `%${stats.endgameStats.winRate}`}
                </div>
                <div className="text-[10px] text-[#888]">
                  {stats.endgameStats.totalEndgames} Oyun Sonu ({stats.endgameStats.wins}G /{' '}
                  {stats.endgameStats.losses}M)
                </div>
              </div>

              <div className="p-3 rounded bg-[#1a1816] border border-[#3c3934]">
                <div className="text-[11px] text-[#999] flex items-center gap-1">
                  <Award className="w-3.5 h-3.5 text-[#e68a2e]" />
                  Maç Başı Büyük Hata
                </div>
                <div className="text-lg font-extrabold text-white mt-0.5">
                  {stats.stockfishAggregate.blundersPerGame !== null
                    ? `${stats.stockfishAggregate.blundersPerGame} ??`
                    : '-'}
                </div>
                <div className="text-[10px] text-[#888]">
                  Genel Doğruluk:{' '}
                  {stats.stockfishAggregate.overallAccuracy !== null
                    ? `%${stats.stockfishAggregate.overallAccuracy}`
                    : '-'}
                </div>
              </div>
            </div>
          </div>

          {/* 2. BEYAZ VE SİYAH AÇILIŞ REPERTUVARI (HANGİ AÇILIŞTA KAZANMA YÜZDEN YÜKSEK?) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* BEYAZ AÇILIŞLAR */}
            <div className="bg-[#262421] border border-[#3c3934] rounded-lg overflow-hidden shadow-lg flex flex-col">
              <div className="px-4 py-3 bg-[#1e1c19] border-b border-[#3c3934] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 rounded-sm bg-white border border-black inline-block" />
                  <h3 className="text-xs sm:text-sm font-bold uppercase text-white">
                    Beyazlarla Tercih Ettiğin Açılışlar ({stats.white.total} Maç)
                  </h3>
                </div>
                <span className="text-xs font-bold text-[#8cd936]">
                  Genel: %{stats.white.winRate} Galibiyet
                </span>
              </div>

              <div className="divide-y divide-[#2e2b27] max-h-80 overflow-y-auto">
                {stats.white.openingsList.map((op) => {
                  const isActive =
                    colorFilter === 'w' && openingFilter === op.name;
                  return (
                    <div
                      key={op.name}
                      onClick={() => {
                        if (isActive) {
                          setColorFilter('all');
                          setOpeningFilter(null);
                        } else {
                          setColorFilter('w');
                          setOpeningFilter(op.name);
                        }
                      }}
                      className={`p-3 cursor-pointer transition-colors ${
                        isActive
                          ? 'bg-[#629924]/25 border-l-4 border-[#629924]'
                          : 'hover:bg-[#302e2c]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <span className="text-xs font-bold text-white truncate block">
                            {op.name}
                          </span>
                          <span className="text-[11px] text-[#999]">
                            {op.total} maç • {op.wins}G {op.draws}B {op.losses}M
                            {op.avgAccuracy !== null && (
                              <span className="text-[#8cd936] font-bold ml-1.5">
                                • Doğruluk: %{op.avgAccuracy}
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="text-right shrink-0">
                          <span
                            className={`text-sm font-extrabold ${
                              op.winRate >= 55
                                ? 'text-[#8cd936]'
                                : op.winRate >= 45
                                ? 'text-[#f5d07e]'
                                : 'text-[#ff7373]'
                            }`}
                          >
                            %{op.winRate}
                          </span>
                          <div className="text-[10px] text-[#888]">Kazanma</div>
                        </div>
                      </div>

                      {/* Galibiyet / Beraberlik / Mağlubiyet Barı */}
                      <div className="w-full h-1.5 rounded-full overflow-hidden bg-[#161512] flex mt-2">
                        <div
                          style={{ width: `${op.winRate}%` }}
                          className="bg-[#629924]"
                        />
                        <div
                          style={{ width: `${op.drawRate}%` }}
                          className="bg-[#888]"
                        />
                        <div
                          style={{ width: `${op.lossRate}%` }}
                          className="bg-[#db3b3b]"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* SİYAH AÇILIŞLAR */}
            <div className="bg-[#262421] border border-[#3c3934] rounded-lg overflow-hidden shadow-lg flex flex-col">
              <div className="px-4 py-3 bg-[#1e1c19] border-b border-[#3c3934] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 rounded-sm bg-[#161512] border border-[#888] inline-block" />
                  <h3 className="text-xs sm:text-sm font-bold uppercase text-white">
                    Siyahlarla Tercih Ettiğin Açılışlar ({stats.black.total} Maç)
                  </h3>
                </div>
                <span className="text-xs font-bold text-[#72b8ff]">
                  Genel: %{stats.black.winRate} Galibiyet
                </span>
              </div>

              <div className="divide-y divide-[#2e2b27] max-h-80 overflow-y-auto">
                {stats.black.openingsList.map((op) => {
                  const isActive =
                    colorFilter === 'b' && openingFilter === op.name;
                  return (
                    <div
                      key={op.name}
                      onClick={() => {
                        if (isActive) {
                          setColorFilter('all');
                          setOpeningFilter(null);
                        } else {
                          setColorFilter('b');
                          setOpeningFilter(op.name);
                        }
                      }}
                      className={`p-3 cursor-pointer transition-colors ${
                        isActive
                          ? 'bg-[#3692e7]/25 border-l-4 border-[#3692e7]'
                          : 'hover:bg-[#302e2c]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <span className="text-xs font-bold text-white truncate block">
                            {op.name}
                          </span>
                          <span className="text-[11px] text-[#999]">
                            {op.total} maç • {op.wins}G {op.draws}B {op.losses}M
                            {op.avgAccuracy !== null && (
                              <span className="text-[#8cd936] font-bold ml-1.5">
                                • Doğruluk: %{op.avgAccuracy}
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="text-right shrink-0">
                          <span
                            className={`text-sm font-extrabold ${
                              op.winRate >= 55
                                ? 'text-[#8cd936]'
                                : op.winRate >= 45
                                ? 'text-[#f5d07e]'
                                : 'text-[#ff7373]'
                            }`}
                          >
                            %{op.winRate}
                          </span>
                          <div className="text-[10px] text-[#888]">Kazanma</div>
                        </div>
                      </div>

                      <div className="w-full h-1.5 rounded-full overflow-hidden bg-[#161512] flex mt-2">
                        <div
                          style={{ width: `${op.winRate}%` }}
                          className="bg-[#629924]"
                        />
                        <div
                          style={{ width: `${op.drawRate}%` }}
                          className="bg-[#888]"
                        />
                        <div
                          style={{ width: `${op.lossRate}%` }}
                          className="bg-[#db3b3b]"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 3. FİLTRELENMİŞ MAÇ LİSTESİ & TEK TIKLA TAHTADA ANALİZ ETME */}
          <div className="bg-[#262421] border border-[#3c3934] rounded-lg overflow-hidden shadow-xl">
            <div className="px-4 py-3 bg-[#1e1c19] border-b border-[#3c3934] flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-[#629924]" />
                <h3 className="text-xs sm:text-sm font-bold uppercase text-white">
                  Maç Arşivi ({filteredGames.length} Maç Gösteriliyor)
                </h3>
                {openingFilter && (
                  <span className="px-2 py-0.5 rounded bg-[#629924]/25 border border-[#629924] text-[#8cd936] text-xs font-bold flex items-center gap-1.5">
                    {openingFilter}
                    <button
                      type="button"
                      onClick={() => {
                        setOpeningFilter(null);
                        setColorFilter('all');
                      }}
                      className="hover:text-white"
                    >
                      ✕
                    </button>
                  </span>
                )}
              </div>

              {/* Hızlı Renk ve Sonuç Filtreleri */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded bg-[#161512] p-0.5 border border-[#3c3934] text-xs">
                  {[
                    { id: 'all', label: 'Tüm Renkler' },
                    { id: 'w', label: 'Beyaz' },
                    { id: 'b', label: 'Siyah' },
                  ].map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setColorFilter(c.id)}
                      className={`px-2.5 py-1 rounded font-medium ${
                        colorFilter === c.id
                          ? 'bg-[#3c3934] text-white'
                          : 'text-[#888] hover:text-white'
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>

                <div className="inline-flex rounded bg-[#161512] p-0.5 border border-[#3c3934] text-xs">
                  {[
                    { id: 'all', label: 'Tüm Sonuçlar' },
                    { id: 'win', label: 'Galibiyet' },
                    { id: 'draw', label: 'Berabere' },
                    { id: 'loss', label: 'Mağlubiyet' },
                  ].map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => setOutcomeFilter(o.id)}
                      className={`px-2.5 py-1 rounded font-medium ${
                        outcomeFilter === o.id
                          ? 'bg-[#3c3934] text-white'
                          : 'text-[#888] hover:text-white'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Maç Satırları */}
            <div className="divide-y divide-[#2e2b27] max-h-[460px] overflow-y-auto">
              {filteredGames.map((g) => (
                <div
                  key={g.id}
                  className="p-3 sm:px-4 hover:bg-[#2c2a27] flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors"
                >
                  <div className="flex items-start sm:items-center gap-3 min-w-0">
                    {/* Sonuç Rozeti */}
                    <div
                      className={`w-9 h-9 rounded flex flex-col items-center justify-center font-extrabold text-xs shrink-0 border ${
                        g.outcome === 'win'
                          ? 'bg-[#629924]/25 border-[#629924] text-[#8cd936]'
                          : g.outcome === 'draw'
                          ? 'bg-[#888]/20 border-[#888] text-[#ccc]'
                          : 'bg-[#db3b3b]/25 border-[#db3b3b] text-[#ff7373]'
                      }`}
                    >
                      <span>
                        {g.outcome === 'win'
                          ? 'G'
                          : g.outcome === 'draw'
                          ? 'B'
                          : 'M'}
                      </span>
                      <span className="text-[9px] font-normal opacity-80">
                        {g.userColor === 'w' ? 'Beyaz' : 'Siyah'}
                      </span>
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs sm:text-sm font-bold text-white">
                          {g.userName || username} ({g.userRating})
                        </span>
                        <span className="text-xs font-extrabold text-[#e68a2e]">
                          vs.
                        </span>
                        <span className="text-xs sm:text-sm font-bold text-[#8cd936]">
                          {g.opponentName || 'Rakip'} ({g.opponentRating})
                        </span>
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-[#161512] border border-[#3c3934] text-[#f5d07e] font-semibold">
                          {g.openingName}
                        </span>
                        <span className="text-[11px] text-[#888]">
                          • {g.totalMoves} hamle • {g.date}
                        </span>
                      </div>

                      {/* Eğer Stockfish Faz Analizi Yapıldıysa Faz Doğruluklarını Göster */}
                      {g.deepAnalysis && (
                        <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px]">
                          <span className="px-1.5 py-0.5 rounded bg-[#629924]/25 text-[#8cd936] font-bold">
                            Genel Doğruluk: %{g.deepAnalysis.userAccuracy}
                          </span>
                          {g.deepAnalysis.openingAccuracy !== null && (
                            <span className="text-[#f5d07e]">
                              Açılış: %{g.deepAnalysis.openingAccuracy}
                            </span>
                          )}
                          {g.deepAnalysis.middlegameAccuracy !== null && (
                            <span className="text-[#8cd936]">
                              Taktik/Orta: %{g.deepAnalysis.middlegameAccuracy}
                            </span>
                          )}
                          {g.deepAnalysis.endgameAccuracy !== null && (
                            <span className="text-[#72b8ff]">
                              Oyun Sonu: %{g.deepAnalysis.endgameAccuracy}
                            </span>
                          )}
                          <span className="text-[#f4a456]">
                            ({g.deepAnalysis.mistakes || 0} Hata ?
                          </span>
                          <span className="text-[#ff7373]">
                            • {g.deepAnalysis.blunders || 0} Büyük Hata ??)
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Aksiyon Butonları: Tahtada İncele / Tam Doğruluk Raporu / Hızlı Faz Tara */}
                  <div className="flex items-center gap-2 shrink-0">
                    {!g.deepAnalysis && (
                      <button
                        type="button"
                        disabled={isBatchAnalyzing}
                        onClick={() => analyzeOneGameNow(g)}
                        className="px-2.5 py-1.5 rounded bg-[#1e1c19] hover:bg-[#36332e] border border-[#3c3934] text-[#bababa] hover:text-white text-xs font-medium transition-colors"
                        title="Bu maçın Açılış/Taktik/Oyun Sonu doğruluğunu hemen hesapla"
                      >
                        Hızlı Faz Analizi
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onOpenGameInFullReview(g)}
                      className="px-2.5 py-1.5 rounded bg-[#3692e7] hover:bg-[#48a1f2] text-white text-xs font-bold flex items-center gap-1 shadow transition-colors"
                      title="Maçı Tahtaya Yükle ve Hamle Hamle Doğruluk / Ok İncelemesi Yap"
                    >
                      <Award className="w-3.5 h-3.5" />
                      Maçı İncele
                    </button>

                    <button
                      type="button"
                      onClick={() => onOpenGameInAnalysis(g)}
                      className="px-2.5 py-1.5 rounded bg-[#629924] hover:bg-[#73b32b] text-white text-xs font-bold flex items-center gap-1 shadow transition-colors"
                      title="Serbest Analiz Stüdyosu ve Varyant Oklarıyla Aç"
                    >
                      <Compass className="w-3.5 h-3.5" />
                      Analiz Tahtası
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default AccountScout;
