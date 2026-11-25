// Chess.com ve Lichess.org Resmi Açık API Entegrasyonu & Hafif Toplu Analiz Motoru
// %100 Tarayıcı (Client-Side) üzerinde çalışır -> Render.com (512 MB RAM / 0.1 CPU) sunucusuna SIFIR yük bindirir.

import { Chess } from 'chess.js';
import { evalToWinPercentWhite, classifyMoveFromEvalDrop } from './stockfishEngine.js';
import { detectOpeningAndVariation } from './openingBook.js';

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

export function extractPgnHeader(pgn, tag) {
  if (!pgn) return '';
  const regex = new RegExp(`\\[${tag}\\s+"([^"]*)"\\]`, 'i');
  const match = pgn.match(regex);
  return match ? match[1].trim() : '';
}

function cleanChessComOpeningUrl(ecoUrl, pgnText = '', movesArray = []) {
  if (movesArray && movesArray.length >= 2) {
    const gmDetected = detectOpeningAndVariation(movesArray.slice(0, 18));
    if (
      gmDetected &&
      gmDetected.name !== 'Şah Piyonu Açılışı (1. e4)' &&
      gmDetected.name !== 'Vezir Piyonu Açılışı (1. d4)' &&
      gmDetected.name !== 'Kanat / Hipermodern Açılış'
    ) {
      return `${gmDetected.eco} • ${gmDetected.name}: ${gmDetected.variation}`;
    }
  }

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

  const openingHeader = extractPgnHeader(pgnText, 'Opening');
  if (openingHeader && openingHeader !== '?') {
    return openingHeader;
  }

  for (const item of QUICK_OPENING_PREFIXES) {
    if (pgnText.includes(item.prefix)) {
      return `${item.eco} • ${item.name}`;
    }
  }
  return 'Standart / Diğer Açılış';
}

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

// Hem PGN hem de ham SAN dizisini (%100 hata toleranslı, saat yorumlarını {[%clk ...]} temizleyerek) ayrıştırır
export function parseGameMovesAndTimeline(pgnOrGame, fallbackMovesStr = '') {
  const pgn =
    typeof pgnOrGame === 'string' ? pgnOrGame : pgnOrGame?.pgn || '';
  const rawMovesStr =
    fallbackMovesStr ||
    (typeof pgnOrGame === 'object' ? pgnOrGame?.movesStr || '' : '');

  // 1. Yöntem: Doğrudan chess.js loadPgn
  if (pgn) {
    try {
      const chess = new Chess();
      chess.loadPgn(pgn);
      const history = chess.history({ verbose: true });
      if (history.length > 0) {
        const replay = new Chess();
        const fens = [replay.fen()];
        for (const m of history) {
          replay.move(m);
          fens.push(replay.fen());
        }
        return { history, fens };
      }
    } catch {
      // 2. Yönteme geç
    }

    // 2. Yöntem: Saat/Eval yorumlarını ({[%clk ...]}), NAG işaretlerini ($1) ve başlıkları soyup manuel SAN oynat
    try {
      const bodyOnly = pgn
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/\{[^}]*\}/g, ' ')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\$\d+/g, ' ')
        .replace(/\d+\.(\.\.)?/g, ' ')
        .replace(/(1-0|0-1|1\/2-1\/2|\*)/g, ' ')
        .trim();

      const tokens = bodyOnly.split(/\s+/).filter(Boolean);
      const replay = new Chess();
      const fens = [replay.fen()];
      for (const tok of tokens) {
        const cleanTok = tok.replace(/[?!+#]+$/g, '');
        try {
          const m = replay.move(tok) || replay.move(cleanTok);
          if (m) fens.push(replay.fen());
        } catch {
          break;
        }
      }
      const history = replay.history({ verbose: true });
      if (history.length > 0) {
        return { history, fens };
      }
    } catch {
      // 3. Yönteme geç
    }
  }

  // 3. Yöntem: Lichess'in düz "moves" string'i ("e4 e5 Nf3 Nc6 ...") üzerinden oynat
  if (rawMovesStr) {
    try {
      const tokens = rawMovesStr.trim().split(/\s+/).filter(Boolean);
      const replay = new Chess();
      const fens = [replay.fen()];
      for (const tok of tokens) {
        const m = replay.move(tok);
        if (m) fens.push(replay.fen());
      }
      const history = replay.history({ verbose: true });
      if (history.length > 0) {
        return { history, fens };
      }
    } catch {
      // fallback
    }
  }

  return { history: [], fens: [new Chess().fen()] };
}

// ============================================================================
// 1. CHESS.COM TÜM ARŞİVLERİNDEN MAÇ ÇEKİCİ (Rakip İsmi + PGN Başlık Yedekli)
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
  const archives = (archivesData.archives || []).slice().reverse();

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
        message: `Chess.com arşivi taranıyor (${archiveUrl.split('/').slice(-2).join('/')})...`,
      });
    }

    try {
      const monthRes = await fetch(archiveUrl);
      if (!monthRes.ok) continue;
      const monthData = await monthRes.json();
      const games = (monthData.games || []).slice().reverse();

      for (const g of games) {
        if (collectedGames.length >= maxGames) break;
        if (g.rules && g.rules !== 'chess') continue;
        if (!g.pgn) continue;

        // Beyaz ve Siyah kullanıcı adlarını hem JSON objesinden hem PGN [White "..."] / [Black "..."] etiketinden çıkar
        const whiteName =
          g.white?.username ||
          extractPgnHeader(g.pgn, 'White') ||
          (g.white?.['@id'] ? g.white['@id'].split('/').pop() : '') ||
          'Beyaz Oyuncu';
        const blackName =
          g.black?.username ||
          extractPgnHeader(g.pgn, 'Black') ||
          (g.black?.['@id'] ? g.black['@id'].split('/').pop() : '') ||
          'Siyah Oyuncu';

        const whiteRating =
          g.white?.rating || extractPgnHeader(g.pgn, 'WhiteElo') || '-';
        const blackRating =
          g.black?.rating || extractPgnHeader(g.pgn, 'BlackElo') || '-';

        const isWhite = whiteName.toLowerCase() === cleanUser;
        const userSide = isWhite ? 'w' : 'b';
        const userObj = isWhite ? g.white : g.black;

        const userDisplayName = isWhite ? whiteName : blackName;
        const opponentDisplayName = isWhite ? blackName : whiteName;
        const userElo = isWhite ? whiteRating : blackRating;
        const opponentElo = isWhite ? blackRating : whiteRating;

        const outcome = normalizeChessComOutcome(userObj?.result);
        const ecoCode = extractPgnHeader(g.pgn, 'ECO') || 'A00';
        const openingName = cleanChessComOpeningUrl(
          g.eco || extractPgnHeader(g.pgn, 'ECOUrl'),
          g.pgn
        );
        const endTimeMs = (g.end_time || 0) * 1000;
        const dateStr = endTimeMs
          ? new Date(endTimeMs).toLocaleDateString('tr-TR')
          : extractPgnHeader(g.pgn, 'Date') || '-';

        const moveNums = g.pgn.match(/\b(\d+)\.\s*[^\s]/g);
        const totalMoves = moveNums ? moveNums.length : 10;
        if (totalMoves < 2) continue;

        collectedGames.push({
          id: g.url || `chesscom-${endTimeMs}-${collectedGames.length}`,
          platform: 'chesscom',
          url: g.url,
          date: dateStr,
          timestamp: endTimeMs,
          timeClass: g.time_class || 'blitz',
          userColor: userSide,
          userName: userDisplayName,
          userRating: userElo,
          whiteName,
          whiteRating,
          blackName,
          blackRating,
          opponentName: opponentDisplayName,
          opponentRating: opponentElo,
          outcome,
          termination: userObj?.result || '',
          eco: ecoCode,
          openingName,
          totalMoves,
          reachedEndgame: totalMoves >= 32,
          pgn: g.pgn,
          movesStr: '',
          deepAnalysis: null,
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
// 2. LICHESS.ORG NDJSON STREAM API MAÇ ÇEKİCİ (Rakip İsmi + Bot/Anonim + PGN Yedekli)
// ============================================================================
export async function fetchLichessGames(username, maxGames = 150, onProgress = null) {
  const cleanUser = username.trim();
  if (!cleanUser) throw new Error('Lütfen geçerli bir Lichess kullanıcı adı girin.');

  const url = `https://lichess.org/api/games/user/${encodeURIComponent(
    cleanUser
  )}?max=${maxGames}&opening=true&pgnInJson=true`;

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

      const pgnWhite = extractPgnHeader(g.pgn, 'White');
      const pgnBlack = extractPgnHeader(g.pgn, 'Black');

      const whiteName =
        g.players?.white?.user?.name ||
        g.players?.white?.user?.id ||
        (g.players?.white?.aiLevel
          ? `Stockfish Seviye ${g.players.white.aiLevel}`
          : '') ||
        (pgnWhite && pgnWhite !== '?' ? pgnWhite : '') ||
        'Anonim (Beyaz)';

      const blackName =
        g.players?.black?.user?.name ||
        g.players?.black?.user?.id ||
        (g.players?.black?.aiLevel
          ? `Stockfish Seviye ${g.players.black.aiLevel}`
          : '') ||
        (pgnBlack && pgnBlack !== '?' ? pgnBlack : '') ||
        'Anonim (Siyah)';

      const whiteRating =
        g.players?.white?.rating ||
        extractPgnHeader(g.pgn, 'WhiteElo') ||
        '-';
      const blackRating =
        g.players?.black?.rating ||
        extractPgnHeader(g.pgn, 'BlackElo') ||
        '-';

      const isWhite =
        whiteName.toLowerCase() === lowerUser ||
        g.players?.white?.user?.id?.toLowerCase() === lowerUser;
      const userSide = isWhite ? 'w' : 'b';

      const userDisplayName = isWhite ? whiteName : blackName;
      const opponentDisplayName = isWhite ? blackName : whiteName;
      const userElo = isWhite ? whiteRating : blackRating;
      const opponentElo = isWhite ? blackRating : whiteRating;

      let outcome = 'draw';
      if (g.winner) {
        outcome =
          (g.winner === 'white' && isWhite) || (g.winner === 'black' && !isWhite)
            ? 'win'
            : 'loss';
      }

      const movesArr = (g.moves || '').trim().split(/\s+/).filter(Boolean);
      const totalMoves =
        movesArr.length > 0
          ? Math.ceil(movesArr.length / 2)
          : (g.pgn?.match(/\b(\d+)\.\s*[^\s]/g) || []).length;
      if (totalMoves < 2) continue;

      const ecoCode = g.opening?.eco || extractPgnHeader(g.pgn, 'ECO') || 'A00';
      const gmDetected = detectOpeningAndVariation(movesArr.slice(0, 18));
      const openingName = g.opening?.name
        ? `${ecoCode} • ${g.opening.name}`
        : gmDetected
        ? gmDetected.fullTitle
        : cleanChessComOpeningUrl('', g.pgn || '', movesArr);

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
        userName: userDisplayName,
        userRating: userElo,
        whiteName,
        whiteRating,
        blackName,
        blackRating,
        opponentName: opponentDisplayName,
        opponentRating: opponentElo,
        outcome,
        termination: g.status || '',
        eco: ecoCode,
        openingName,
        totalMoves,
        reachedEndgame: totalMoves >= 32,
        pgn: g.pgn || '',
        movesStr: g.moves || '',
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
      openingAccuracy: null,
      middlegameAccuracy: null,
      endgameAccuracy: null,
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
    if (g.outcome === 'win') summary.overall.wins++;
    else if (g.outcome === 'draw') summary.overall.draws++;
    else summary.overall.losses++;

    const sideBucket = g.userColor === 'w' ? summary.white : summary.black;
    sideBucket.total++;
    if (g.outcome === 'win') sideBucket.wins++;
    else if (g.outcome === 'draw') sideBucket.draws++;
    else sideBucket.losses++;

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

  const pct = (part, total) =>
    total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
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
      Math.round(
        (totalBlunders / summary.stockfishAggregate.analyzedCount) * 10
      ) / 10;

    const mgBase =
      summary.stockfishAggregate.middlegameAccuracy ??
      summary.stockfishAggregate.overallAccuracy ??
      75;
    summary.stockfishAggregate.tacticalSharpnessScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(mgBase - summary.stockfishAggregate.blundersPerGame * 3.5)
      )
    );
  }

  return summary;
}

// ============================================================================
// 4. TEK BİR MAÇ İÇİN HIZLI STOCKFISH FAZ ANALİZÖRÜ (AÇILIŞ / TAKTİK / OYUN SONU)
// ============================================================================
export async function analyzeSingleGamePhasesWithStockfish(
  gameItem,
  stockfishController
) {
  if (!gameItem || !stockfishController) return null;

  const { history, fens } = parseGameMovesAndTimeline(
    gameItem.pgn,
    gameItem.movesStr
  );
  if (history.length < 4) return null;

  const userColor = gameItem.userColor || 'w';
  const openingAccs = []; // Hamle 1..10
  const middlegameAccs = []; // Hamle 11..28
  const endgameAccs = []; // Hamle 29+
  const allUserAccs = [];

  let blunders = 0;
  let mistakes = 0;
  let inaccuracies = 0;
  let bestMoves = 0;

  const evalCache = {};

  const getQuickEval = async (plyIdx) => {
    if (evalCache[plyIdx]) return evalCache[plyIdx];
    const fenStr = fens[plyIdx];
    const turnColor = fenStr.split(' ')[1] || 'w';

    // Mat veya pat olmuş son konum kontrolü
    const tempCheck = new Chess(fenStr);
    if (tempCheck.isCheckmate()) {
      const matedColor = tempCheck.turn();
      const mateObj = {
        type: 'mate',
        value: matedColor === 'w' ? -1 : 1,
        bestMove: null,
      };
      evalCache[plyIdx] = mateObj;
      return mateObj;
    }
    if (tempCheck.isDraw() || tempCheck.isStalemate()) {
      const drawObj = { type: 'cp', value: 0, bestMove: null };
      evalCache[plyIdx] = drawObj;
      return drawObj;
    }

    // movetime koymadan doğrudan depth 7 ile bekle ki her pozisyonda %100 gerçek cp skoru ve bestMove dönsün
    const res = await stockfishController.analyzePosition(fenStr, turnColor, {
      depth: 7,
      multiPV: 1,
      movetime: 0,
    });
    const line = res?.lines?.[0];
    const evalObj = {
      type: line?.type || 'cp',
      value: typeof line?.value === 'number' ? line.value : 0,
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
    else if (clsResult.classification === 'inaccuracy') inaccuracies++;
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
    inaccuracies,
    mistakes,
    blunders,
  };
}
