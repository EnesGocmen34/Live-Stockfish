// Chess.com ve Lichess.org Resmi Açık API Entegrasyonu & Hafif Toplu Analiz Motoru
// %100 Tarayıcı (Client-Side) üzerinde çalışır -> Render.com (512 MB RAM / 0.1 CPU) sunucusuna SIFIR yük bindirir.

import { Chess } from 'chess.js';
import { evalToWinPercentWhite, classifyMoveFromEvalDrop } from './stockfishEngine.js';
import { detectOpeningAndVariation } from './openingBook.js';

// İlk hamlelerden hızlı ECO & Açılış İsmi Tespit Sözlüğü (API'den açılış adı gelmezse yedek olarak kullanılır)
const QUICK_OPENING_PREFIXES = [
  { prefix: '1. e4 c5', eco: 'B20', name: 'Sicilya Savunması' },
  { prefix: '1. e4 e5 2. Nf3 Nc6 3. Bb5', eco: 'C60', name: 'İspanyol Açılışı (Ruy Lopez)' },
  { prefix: '1. e4 e5 2. Nf3 Nc6 3. Bc4', eco: 'C50', name: 'İtalyan Açılışı' },
  { prefix: '1. e4 e5 2. Nf3 Nc6 3. d4', eco: 'C45', name: 'İskoç Açılışı' },
  { prefix: '1. e4 e5 2. Nf3 Nf6', eco: 'C42', name: 'Petrov (Rus) Savunması' },
  { prefix: '1. e4 e5 2. f4', eco: 'C30', name: 'Şah Gambiti' },
  { prefix: '1. e4 e5', eco: 'C20', name: 'Açık Oyun (1.e4 e5)' },
  { prefix: '1. e4 e6', eco: 'C00', name: 'Fransız Savunması' },
  { prefix: '1. e4 c6', eco: 'B10', name: 'Caro-Kann Savunması' },
  { prefix: '1. e4 d5', eco: 'B01', name: 'İskandinav Savunması' },
  { prefix: '1. e4 d6', eco: 'B07', name: 'Pirc Savunması' },
  { prefix: '1. e4 g6', eco: 'B06', name: 'Modern Savunma' },
  { prefix: '1. e4 Nf6', eco: 'B02', name: 'Alekhine Savunması' },
  { prefix: '1. d4 d5 2. c4 e6', eco: 'D30', name: 'Kabul Edilmeyen Vezir Gambiti (QGD)' },
  { prefix: '1. d4 d5 2. c4 c6', eco: 'D10', name: 'Slav Savunması' },
  { prefix: '1. d4 d5 2. c4 dxc4', eco: 'D20', name: 'Kabul Edilen Vezir Gambiti (QGA)' },
  { prefix: '1. d4 d5 2. Bf4', eco: 'D02', name: 'Londra Sistemi (London System)' },
  { prefix: '1. d4 Nf6 2. c4 g6', eco: 'E60', name: 'Şah Hint Savunması (KID)' },
  { prefix: '1. d4 Nf6 2. c4 e6', eco: 'E00', name: 'Nimzo / Vezir Hint Savunması' },
  { prefix: '1. d4 Nf6 2. Bf4', eco: 'A45', name: 'Londra Sistemi' },
  { prefix: '1. d4 f5', eco: 'A80', name: 'Hollanda Savunması (Dutch)' },
  { prefix: '1. d4 d5', eco: 'D00', name: 'Kapalı Vezir Piyonu Oyunu' },
  { prefix: '1. d4 Nf6', eco: 'A45', name: 'Hint Savunmaları' },
  { prefix: '1. c4', eco: 'A10', name: 'İngiliz Açılışı' },
  { prefix: '1. Nf3', eco: 'A04', name: 'Reti / Zukertort Açılışı' },
];

function cleanChessComOpeningUrl(ecoUrl, pgnText = '') {
  // Önce PGN içerisindeki hamlelerden GM2600 açılış & alt varyant ağacını kontrol et
  if (pgnText) {
    try {
      const bodyOnly = pgnText.replace(/\[[^\]]*\]/g, ' ').trim();
      const sanTokens = bodyOnly
        .replace(/\{[^}]*\}/g, ' ')
        .replace(/\d+\.(\.\.)?/g, ' ')
        .replace(/(1-0|0-1|1\/2-1\/2|\*)/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 18);

      if (sanTokens.length >= 2) {
        const gmDetected = detectOpeningAndVariation(sanTokens);
        if (
          gmDetected &&
          gmDetected.name !== 'Şah Piyonu Açılışı (1. e4)' &&
          gmDetected.name !== 'Vezir Piyonu Açılışı (1. d4)' &&
          gmDetected.name !== 'Kanat / Hipermodern Açılış'
        ) {
          return `${gmDetected.eco} • ${gmDetected.name}: ${gmDetected.variation}`;
        }
      }
    } catch {
      // fallback
    }
  }

  if (ecoUrl && typeof ecoUrl === 'string' && ecoUrl.includes('/openings/')) {
    const rawSlug = ecoUrl.split('/openings/')[1] || '';
    const cleaned = decodeURIComponent(rawSlug)
      .replace(/-/g, ' ')
      .replace(/\s+\d+.*$/, '')
      .trim();
    if (cleaned) return cleaned;
  }

  const openingHeader = pgnText.match(/\[Opening\s+"([^"]+)"\]/);
  if (openingHeader && openingHeader[1] && openingHeader[1] !== '?') {
    return openingHeader[1];
  }

  for (const item of QUICK_OPENING_PREFIXES) {
    if (pgnText.includes(item.prefix)) {
      return `${item.eco} • ${item.name}`;
    }
  }
  return 'Standart / Diğer Açılış';
}

function extractPgnHeader(pgn, tag) {
  if (!pgn) return '';
  const regex = new RegExp(`\\[${tag}\\s+"([^"]*)"\\]`);
  const match = pgn.match(regex);
  return match ? match[1] : '';
}

// Chess.com sonuç kodlarını ('win', 'checkmated', 'stalemate', 'repetition', vb.) normalize eder
function normalizeChessComOutcome(resultStr) {
  if (resultStr === 'win') return 'win';
  const drawCodes = [
    'agreed',
    'repetition',
    'stalemate',
    'insufficient',
    '50move',
    'timevsinsufficient',
  ];
  if (drawCodes.includes(resultStr)) return 'draw';
  return 'loss';
}

// PGN metninden hamle listesini (SAN) ve oyun sonu durumunu hafif şekilde çıkarır
export function parseGameMovesAndTimeline(pgn) {
  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
    const history = chess.history({ verbose: true });
    const replay = new Chess();
    const fens = [replay.fen()];
    for (const m of history) {
      replay.move(m);
      fens.push(replay.fen());
    }
    return { history, fens };
  } catch {
    return { history: [], fens: [new Chess().fen()] };
  }
}

// ============================================================================
// 1. CHESS.COM TÜM ARŞİVLERİNDEN MAÇ ÇEKİCİ
// ============================================================================
export async function fetchChessComGames(username, maxGames = 150, onProgress = null) {
  const cleanUser = username.trim().toLowerCase();
  if (!cleanUser) throw new Error('Lütfen geçerli bir Chess.com kullanıcı adı girin.');

  const archivesRes = await fetch(
    `https://api.chess.com/pub/player/${encodeURIComponent(cleanUser)}/games/archives`
  );

  if (!archivesRes.ok) {
    if (archivesRes.status === 404) {
      throw new Error(`Chess.com üzerinde "${username}" adlı kullanıcı bulunamadı.`);
    }
    throw new Error(`Chess.com API bağlantı hatası (Kod: ${archivesRes.status})`);
  }

  const archivesData = await archivesRes.json();
  const archives = (archivesData.archives || []).slice().reverse(); // En yeni aydan geriye doğru

  if (archives.length === 0) {
    throw new Error('Bu Chess.com hesabında henüz tamamlanmış maç arşivi bulunamadı.');
  }

  const collectedGames = [];

  for (let i = 0; i < archives.length; i++) {
    if (collectedGames.length >= maxGames) break;
    const archiveUrl = archives[i];
    if (onProgress) {
      onProgress({
        stage: 'fetch',
        loaded: collectedGames.length,
        totalTarget: maxGames,
        message: `Chess.com arşivi taranıyor (${ archiveUrl.split('/').slice(-2).join('/') })...`,
      });
    }

    try {
      const monthRes = await fetch(archiveUrl);
      if (!monthRes.ok) continue;
      const monthData = await monthRes.json();
      const games = (monthData.games || []).slice().reverse();

      for (const g of games) {
        if (collectedGames.length >= maxGames) break;
        if (g.rules && g.rules !== 'chess') continue; // Sadece standart 8x8 satranç
        if (!g.pgn) continue;

        const isWhite =
          g.white?.username?.toLowerCase() === cleanUser;
        const userSide = isWhite ? 'w' : 'b';
        const userObj = isWhite ? g.white : g.black;
        const oppObj = isWhite ? g.black : g.white;

        const outcome = normalizeChessComOutcome(userObj?.result);
        const ecoCode = extractPgnHeader(g.pgn, 'ECO') || 'A00';
        const openingName = cleanChessComOpeningUrl(g.eco || extractPgnHeader(g.pgn, 'ECOUrl'), g.pgn);
        const endTimeMs = (g.end_time || 0) * 1000;
        const dateStr = endTimeMs
          ? new Date(endTimeMs).toLocaleDateString('tr-TR')
          : extractPgnHeader(g.pgn, 'Date') || '-';

        // Hamle sayısını PGN'den hızlıca tahmin et (bellek dostu)
        const moveNums = g.pgn.match(/\b(\d+)\.\s+[a-zA-Z]/g);
        const totalMoves = moveNums ? moveNums.length : 0;
        if (totalMoves < 2) continue;

        collectedGames.push({
          id: g.url || `chesscom-${endTimeMs}-${collectedGames.length}`,
          platform: 'chesscom',
          url: g.url,
          date: dateStr,
          timestamp: endTimeMs,
          timeClass: g.time_class || 'blitz',
          userColor: userSide,
          userRating: userObj?.rating || '-',
          opponentName: oppObj?.username || 'Rakip',
          opponentRating: oppObj?.rating || '-',
          outcome, // 'win' | 'draw' | 'loss'
          termination: userObj?.result || '',
          eco: ecoCode,
          openingName,
          totalMoves,
          reachedEndgame: totalMoves >= 32,
          pgn: g.pgn,
          deepAnalysis: null, // Stockfish derin analiz yapıldığında doldurulur
        });
      }
    } catch {
      // Tek bir ay hata verirse diğer aylara devam et
    }
  }

  if (collectedGames.length === 0) {
    throw new Error('Bu hesapta analiz edilebilecek standart satranç maçı bulunamadı.');
  }

  return collectedGames;
}

// ============================================================================
// 2. LICHESS.ORG NDJSON STREAM API MAÇ ÇEKİCİ
// ============================================================================
export async function fetchLichessGames(username, maxGames = 150, onProgress = null) {
  const cleanUser = username.trim();
  if (!cleanUser) throw new Error('Lütfen geçerli bir Lichess kullanıcı adı girin.');

  const url = `https://lichess.org/api/games/user/${encodeURIComponent(
    cleanUser
  )}?max=${maxGames}&opening=true&pgnInJson=true&perfType=ultraBullet,bullet,blitz,rapid,classical,correspondence`;

  if (onProgress) {
    onProgress({
      stage: 'fetch',
      loaded: 0,
      totalTarget: maxGames,
      message: `Lichess.org sunucusundan son ${maxGames} maç çekiliyor...`,
    });
  }

  const res = await fetch(url, {
    headers: {
      Accept: 'application/x-ndjson',
    },
  });

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`Lichess.org üzerinde "${username}" adlı kullanıcı bulunamadı.`);
    }
    throw new Error(`Lichess API bağlantı hatası (Kod: ${res.status})`);
  }

  const text = await res.text();
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const collectedGames = [];
  const lowerUser = cleanUser.toLowerCase();

  for (const line of lines) {
    try {
      const g = JSON.parse(line);
      if (g.variant && g.variant !== 'standard') continue;
      if (!g.pgn && !g.moves) continue;

      const whiteUser = g.players?.white?.user?.name || g.players?.white?.user?.id || 'Beyaz';
      const blackUser = g.players?.black?.user?.name || g.players?.black?.user?.id || 'Siyah';
      const isWhite = whiteUser.toLowerCase() === lowerUser;
      const userSide = isWhite ? 'w' : 'b';

      let outcome = 'draw';
      if (g.winner) {
        outcome =
          (g.winner === 'white' && isWhite) || (g.winner === 'black' && !isWhite)
            ? 'win'
            : 'loss';
      }

      const movesArr = (g.moves || '').trim().split(/\s+/).filter(Boolean);
      const totalMoves = Math.ceil(movesArr.length / 2);
      if (totalMoves < 2) continue;

      const ecoCode = g.opening?.eco || extractPgnHeader(g.pgn, 'ECO') || 'A00';
      const gmDetected = detectOpeningAndVariation(movesArr.slice(0, 18));
      const openingName =
        g.opening?.name
          ? `${ecoCode} • ${g.opening.name}`
          : gmDetected
          ? gmDetected.fullTitle
          : cleanChessComOpeningUrl('', g.pgn || '');

      const createdAt = g.createdAt || Date.now();
      const dateStr = new Date(createdAt).toLocaleDateString('tr-TR');

      collectedGames.push({
        id: g.id || `lichess-${createdAt}-${collectedGames.length}`,
        platform: 'lichess',
        url: g.id ? `https://lichess.org/${g.id}` : '',
        date: dateStr,
        timestamp: createdAt,
        timeClass: g.speed || 'blitz',
        userColor: userSide,
        userRating: isWhite
          ? g.players?.white?.rating || '-'
          : g.players?.black?.rating || '-',
        opponentName: isWhite ? blackUser : whiteUser,
        opponentRating: isWhite
          ? g.players?.black?.rating || '-'
          : g.players?.white?.rating || '-',
        outcome,
        termination: g.status || '',
        eco: ecoCode,
        openingName,
        totalMoves,
        reachedEndgame: totalMoves >= 32,
        pgn: g.pgn || '',
        deepAnalysis: null,
      });
    } catch {
      // Bozuk satırı atla
    }
  }

  if (collectedGames.length === 0) {
    throw new Error('Bu Lichess hesabında standart satranç maçı bulunamadı.');
  }

  return collectedGames;
}

// ============================================================================
// 3. REPERTUVAR, RENK, OYUN SONU VE AÇILIŞ İSTATİSTİK ÖZETLEYİCİ
// ============================================================================
export function aggregateAccountStats(games = []) {
  const summary = {
    totalGames: games.length,
    overall: { wins: 0, draws: 0, losses: 0, winRate: 0 },
    white: {
      total: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      winRate: 0,
      openingsMap: {},
      openingsList: [],
    },
    black: {
      total: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      winRate: 0,
      openingsMap: {},
      openingsList: [],
    },
    endgameStats: {
      totalEndgames: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      winRate: 0,
    },
    shortTacticalGames: {
      totalShort: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
    },
    stockfishAggregate: {
      analyzedCount: 0,
      overallAccuracy: null,
      whiteAccuracy: null,
      blackAccuracy: null,
      openingAccuracy: null, // Hamle 1-10
      middlegameAccuracy: null, // Hamle 11-28 (Taktik & Oyun Ortası)
      endgameAccuracy: null, // Hamle 29+ (Oyun Sonu)
      tacticalSharpnessScore: null,
      blundersPerGame: null,
    },
  };

  if (games.length === 0) return summary;

  const accAll = [];
  const accWhite = [];
  const accBlack = [];
  const accOpening = [];
  const accMiddlegame = [];
  const accEndgame = [];
  let totalBlunders = 0;

  for (const g of games) {
    // Genel sonuç
    if (g.outcome === 'win') summary.overall.wins++;
    else if (g.outcome === 'draw') summary.overall.draws++;
    else summary.overall.losses++;

    const sideBucket = g.userColor === 'w' ? summary.white : summary.black;
    sideBucket.total++;
    if (g.outcome === 'win') sideBucket.wins++;
    else if (g.outcome === 'draw') sideBucket.draws++;
    else sideBucket.losses++;

    // Açılış istatistiği (Renk bazlı)
    const opKey = g.openingName || 'Diğer Açılış';
    if (!sideBucket.openingsMap[opKey]) {
      sideBucket.openingsMap[opKey] = {
        name: opKey,
        eco: g.eco || 'A00',
        total: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        winRate: 0,
        lossRate: 0,
        accList: [],
        avgAccuracy: null,
        gameIds: [],
      };
    }
    const opEntry = sideBucket.openingsMap[opKey];
    opEntry.total++;
    if (g.outcome === 'win') opEntry.wins++;
    else if (g.outcome === 'draw') opEntry.draws++;
    else opEntry.losses++;
    opEntry.gameIds.push(g.id);

    // Oyun Sonu (32+ hamle süren maçlardaki dönüşüm başarısı)
    if (g.reachedEndgame) {
      summary.endgameStats.totalEndgames++;
      if (g.outcome === 'win') summary.endgameStats.wins++;
      else if (g.outcome === 'draw') summary.endgameStats.draws++;
      else summary.endgameStats.losses++;
    } else if (g.totalMoves <= 24) {
      summary.shortTacticalGames.totalShort++;
      if (g.outcome === 'win') summary.shortTacticalGames.wins++;
      else if (g.outcome === 'loss') summary.shortTacticalGames.losses++;
    }

    // Eğer bu maça Stockfish derin faz analizi yapıldıysa
    if (g.deepAnalysis) {
      summary.stockfishAggregate.analyzedCount++;
      accAll.push(g.deepAnalysis.userAccuracy);
      if (g.userColor === 'w') accWhite.push(g.deepAnalysis.userAccuracy);
      else accBlack.push(g.deepAnalysis.userAccuracy);

      opEntry.accList.push(g.deepAnalysis.userAccuracy);

      if (g.deepAnalysis.openingAccuracy !== null) {
        accOpening.push(g.deepAnalysis.openingAccuracy);
      }
      if (g.deepAnalysis.middlegameAccuracy !== null) {
        accMiddlegame.push(g.deepAnalysis.middlegameAccuracy);
      }
      if (g.deepAnalysis.endgameAccuracy !== null) {
        accEndgame.push(g.deepAnalysis.endgameAccuracy);
      }
      totalBlunders += g.deepAnalysis.blunders || 0;
    }
  }

  const pct = (part, total) => (total > 0 ? Math.round((part / total) * 1000) / 10 : 0);
  const avg = (arr) =>
    arr.length > 0
      ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10
      : null;

  summary.overall.winRate = pct(summary.overall.wins, summary.totalGames);
  summary.white.winRate = pct(summary.white.wins, summary.white.total);
  summary.black.winRate = pct(summary.black.wins, summary.black.total);
  summary.endgameStats.winRate = pct(
    summary.endgameStats.wins,
    summary.endgameStats.totalEndgames
  );
  summary.shortTacticalGames.winRate = pct(
    summary.shortTacticalGames.wins,
    summary.shortTacticalGames.totalShort
  );

  for (const sideBucket of [summary.white, summary.black]) {
    sideBucket.openingsList = Object.values(sideBucket.openingsMap)
      .map((op) => ({
        ...op,
        winRate: pct(op.wins, op.total),
        drawRate: pct(op.draws, op.total),
        lossRate: pct(op.losses, op.total),
        avgAccuracy: avg(op.accList),
      }))
      .sort((a, b) => b.total - a.total);
  }

  if (summary.stockfishAggregate.analyzedCount > 0) {
    summary.stockfishAggregate.overallAccuracy = avg(accAll);
    summary.stockfishAggregate.whiteAccuracy = avg(accWhite);
    summary.stockfishAggregate.blackAccuracy = avg(accBlack);
    summary.stockfishAggregate.openingAccuracy = avg(accOpening);
    summary.stockfishAggregate.middlegameAccuracy = avg(accMiddlegame);
    summary.stockfishAggregate.endgameAccuracy = avg(accEndgame);
    summary.stockfishAggregate.blundersPerGame =
      Math.round((totalBlunders / summary.stockfishAggregate.analyzedCount) * 10) / 10;

    // Taktik keskinlik puanı: oyun ortası doğruluğu ve düşük büyük hata oranının birleşimi
    const mgBase = summary.stockfishAggregate.middlegameAccuracy ?? summary.stockfishAggregate.overallAccuracy ?? 75;
    summary.stockfishAggregate.tacticalSharpnessScore = Math.max(
      0,
      Math.min(100, Math.round(mgBase - summary.stockfishAggregate.blundersPerGame * 3.5))
    );
  }

  return summary;
}

// ============================================================================
// 4. TEK BİR MAÇ İÇİN HIZLI STOCKFISH FAZ ANALİZÖRÜ (AÇILIŞ / TAKTİK / OYUN SONU)
// ============================================================================
export async function analyzeSingleGamePhasesWithStockfish(gameItem, stockfishController) {
  if (!gameItem || !gameItem.pgn || !stockfishController) return null;

  const { history, fens } = parseGameMovesAndTimeline(gameItem.pgn);
  if (history.length < 4) return null;

  // Bellek ve hız optimizasyonu: kullanıcının oynadığı hamlelerin öncesi ve sonrası konumları değerlendir
  const userColor = gameItem.userColor;
  const openingAccs = []; // Hamle 1..10 (ply 0..19)
  const middlegameAccs = []; // Hamle 11..28 (ply 20..55)
  const endgameAccs = []; // Hamle 29+ (ply 56+)
  const allUserAccs = [];

  let blunders = 0;
  let mistakes = 0;
  let bestMoves = 0;

  // Hızlı toplu tarama için kullanıcının hamlelerini örnekle (uzun maçlarda her kullanıcı hamlesini hızlı depth 8 / 65ms ile tara)
  const evalCache = {};

  const getQuickEval = async (plyIdx) => {
    if (evalCache[plyIdx]) return evalCache[plyIdx];
    const fenStr = fens[plyIdx];
    const turnColor = fenStr.split(' ')[1] || 'w';
    const res = await stockfishController.analyzePosition(fenStr, turnColor, {
      depth: 8,
      multiPV: 1,
      movetime: 55,
    });
    const line = res?.lines?.[0];
    const evalObj = {
      type: line?.type || 'cp',
      value: line?.value ?? 0,
      bestMove: res?.bestMove || line?.bestMove || null,
    };
    evalCache[plyIdx] = evalObj;
    return evalObj;
  };

  for (let i = 0; i < history.length; i++) {
    const move = history[i];
    if (move.color !== userColor) continue;

    const prevEval = await getQuickEval(i);
    const nextEval = await getQuickEval(i + 1);
    const playedUci = `${move.from}${move.to}${move.promotion || ''}`;

    const clsResult = classifyMoveFromEvalDrop(
      prevEval,
      nextEval,
      userColor,
      playedUci,
      prevEval.bestMove
    );

    allUserAccs.push(clsResult.accuracy);
    if (clsResult.classification === 'best') bestMoves++;
    else if (clsResult.classification === 'mistake') mistakes++;
    else if (clsResult.classification === 'blunder') blunders++;

    const moveNum = Math.floor(i / 2) + 1;
    if (moveNum <= 10) {
      openingAccs.push(clsResult.accuracy);
    } else if (moveNum <= 28) {
      middlegameAccs.push(clsResult.accuracy);
    } else {
      endgameAccs.push(clsResult.accuracy);
    }
  }

  const avg = (arr) =>
    arr.length > 0
      ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10
      : null;

  return {
    userAccuracy: avg(allUserAccs) ?? 75,
    openingAccuracy: avg(openingAccs),
    middlegameAccuracy: avg(middlegameAccs),
    endgameAccuracy: avg(endgameAccs),
    bestMoves,
    mistakes,
    blunders,
  };
}
