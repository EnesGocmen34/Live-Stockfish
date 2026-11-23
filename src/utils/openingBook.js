// Lichess Açılış Kitabı (Opening Explorer) ve En İyi Devam Yolları Veritabanı
// Analiz tahtasında "Açılış Çalış" modunda konum eşleşmesi ve oklarla devam yolları göstermek için kullanılır.

export const FAMOUS_OPENINGS = [
  {
    id: 'starting',
    name: 'Başlangıç Konumu (Standart)',
    eco: 'A00',
    moves: [],
    description: 'Merkez kontrolü için en popüler ilk hamleler: 1.e4, 1.d4, 1.Nf3 ve 1.c4.',
  },
  {
    id: 'italian',
    name: 'İtalyan Açılışı (Giuoco Piano)',
    eco: 'C50',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'],
    description: 'c3-d4 merkez piyon sürüşü veya d3 ile sağlam gelişim hedeflenir.',
  },
  {
    id: 'ruy_lopez',
    name: 'İspanyol Açılışı (Ruy Lopez)',
    eco: 'C60',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'],
    description: 'e5 piyonunu koruyan c6 atına baskı kurarak uzun vadeli merkez üstünlüğü arar.',
  },
  {
    id: 'sicilian_najdorf',
    name: 'Sicilya Savunması (Açık / Najdorf)',
    eco: 'B90',
    moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'],
    description: 'Dinamik ve asimetrik mücadele; Siyah vezir kanadından karşı oyun arar.',
  },
  {
    id: 'french',
    name: 'Fransız Savunması',
    eco: 'C00',
    moves: ['e4', 'e6', 'd4', 'd5'],
    description: 'Siyah d5 ile merkeze hemen meydan okur; Nc3, Nd2 veya e5 devam yolları popülerdir.',
  },
  {
    id: 'caro_kann',
    name: 'Caro-Kann Savunması',
    eco: 'B10',
    moves: ['e4', 'c6', 'd4', 'd5'],
    description: 'Sağlam piyon yapısı ve c8 filinin açık kalmasıyla bilinen üst düzey savunma.',
  },
  {
    id: 'queens_gambit',
    name: 'Vezir Gambiti (QGD)',
    eco: 'D30',
    moves: ['d4', 'd5', 'c4', 'e6'],
    description: 'Beyaz c4 ile d5 merkez piyonuna baskı kurar, Nc3 ve Nf3 ile gelişir.',
  },
  {
    id: 'kings_indian',
    name: 'Şah Hint Savunması (KID)',
    eco: 'E60',
    moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6'],
    description: 'Siyah merkezi Beyaza bırakıp e5 veya c5 sürüşleriyle şah kanadı atağı hazırlar.',
  },
  {
    id: 'london',
    name: 'Londra Sistemi (London System)',
    eco: 'D02',
    moves: ['d4', 'd5', 'Bf4', 'Nf6', 'e3', 'c5', 'c3'],
    description: 'Her siyah kurulumuna karşı sağlam piramit piyon yapısı kuran popüler sistem.',
  },
];

// Konum bazlı açılış devam önerileri (FEN'in ilk 3 alanı -> önerilen devam hamleleri ve istatistikleri)
export const OPENING_BOOK_BY_FEN_KEY = {
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq': {
    name: 'Başlangıç Konumu',
    eco: 'A00',
    continuations: [
      { san: 'e4', from: 'e2', to: 'e4', winRate: '54%', games: '1.8M', note: 'Şah Piyonu Açılışı' },
      { san: 'd4', from: 'd2', to: 'd4', winRate: '55%', games: '1.4M', note: 'Vezir Piyonu Açılışı' },
      { san: 'Nf3', from: 'g1', to: 'f3', winRate: '55%', games: '420K', note: 'Zukertort / Reti' },
      { san: 'c4', from: 'c2', to: 'c4', winRate: '54%', games: '310K', note: 'İngiliz Açılışı' },
    ],
  },
  'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq': {
    name: 'Şah Piyonu Açılışı (1. e4)',
    eco: 'B00',
    continuations: [
      { san: 'c5', from: 'c7', to: 'c5', winRate: '49%', games: '820K', note: 'Sicilya Savunması' },
      { san: 'e5', from: 'e7', to: 'e5', winRate: '48%', games: '690K', note: 'Açık Oyunlar' },
      { san: 'e6', from: 'e7', to: 'e6', winRate: '47%', games: '240K', note: 'Fransız Savunması' },
      { san: 'c6', from: 'c7', to: 'c6', winRate: '48%', games: '190K', note: 'Caro-Kann Savunması' },
    ],
  },
  'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq': {
    name: 'Açık Oyun (1. e4 e5)',
    eco: 'C20',
    continuations: [
      { san: 'Nf3', from: 'g1', to: 'f3', winRate: '54%', games: '590K', note: 'Şah Atı Açılışı' },
      { san: 'Nc3', from: 'b1', to: 'c3', winRate: '52%', games: '52K', note: 'Viyana Oyunu' },
      { san: 'Bc4', from: 'f1', to: 'c4', winRate: '51%', games: '38K', note: 'Fil Açılışı' },
      { san: 'f4', from: 'f2', to: 'f4', winRate: '50%', games: '24K', note: 'Şah Gambiti' },
    ],
  },
  'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq': {
    name: 'Şah Atı Açılışı (1. e4 e5 2. Nf3)',
    eco: 'C40',
    continuations: [
      { san: 'Nc6', from: 'b8', to: 'c6', winRate: '48%', games: '510K', note: 'Ana Varyant' },
      { san: 'Nf6', from: 'g8', to: 'f6', winRate: '49%', games: '65K', note: 'Petrov (Rus) Savunması' },
      { san: 'd6', from: 'd7', to: 'd6', winRate: '45%', games: '25K', note: 'Philidor Savunması' },
    ],
  },
  'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq': {
    name: '1. e4 e5 2. Nf3 Nc6',
    eco: 'C44',
    continuations: [
      { san: 'Bb5', from: 'f1', to: 'b5', winRate: '55%', games: '260K', note: 'İspanyol Açılışı (Ruy Lopez)' },
      { san: 'Bc4', from: 'f1', to: 'c4', winRate: '53%', games: '185K', note: 'İtalyan Açılışı' },
      { san: 'd4', from: 'd2', to: 'd4', winRate: '52%', games: '55K', note: 'İskoç Açılışı' },
      { san: 'Nc3', from: 'b1', to: 'c3', winRate: '51%', games: '30K', note: 'Üç At Açılışı' },
    ],
  },
  'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq': {
    name: 'İtalyan Açılışı: Giuoco Piano',
    eco: 'C50',
    continuations: [
      { san: 'c3', from: 'c2', to: 'c3', winRate: '54%', games: '88K', note: 'Ana Varyant (d4 hazırlığı)' },
      { san: 'd3', from: 'd2', to: 'd3', winRate: '53%', games: '62K', note: 'Giuoco Pianissimo' },
      { san: 'O-O', from: 'e1', to: 'g1', winRate: '52%', games: '35K', note: 'Hızlı Rok' },
      { san: 'b4', from: 'b2', to: 'b4', winRate: '51%', games: '14K', note: 'Evans Gambiti' },
    ],
  },
  'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq': {
    name: 'İspanyol Açılışı (Ruy Lopez)',
    eco: 'C60',
    continuations: [
      { san: 'a6', from: 'a7', to: 'a6', winRate: '48%', games: '195K', note: 'Morphy Savunması' },
      { san: 'Nf6', from: 'g8', to: 'f6', winRate: '50%', games: '55K', note: 'Berlin Savunması' },
      { san: 'Bc5', from: 'f8', to: 'c5', winRate: '46%', games: '12K', note: 'Klasik Savunma' },
    ],
  },
  'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq': {
    name: 'Sicilya Savunması (1. e4 c5)',
    eco: 'B20',
    continuations: [
      { san: 'Nf3', from: 'g1', to: 'f3', winRate: '54%', games: '670K', note: 'Açık Sicilya Hazırlığı' },
      { san: 'Nc3', from: 'b1', to: 'c3', winRate: '52%', games: '85K', note: 'Kapalı Sicilya' },
      { san: 'c3', from: 'c2', to: 'c3', winRate: '52%', games: '65K', note: 'Alapin Varyantı' },
    ],
  },
  'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq': {
    name: 'Vezir Piyonu Açılışı (1. d4)',
    eco: 'A40',
    continuations: [
      { san: 'Nf6', from: 'g8', to: 'f6', winRate: '49%', games: '760K', note: 'Hint Savunmaları' },
      { san: 'd5', from: 'd7', to: 'd5', winRate: '48%', games: '540K', note: 'Kapalı Oyunlar' },
      { san: 'e6', from: 'e7', to: 'e6', winRate: '47%', games: '65K', note: 'Horwitz Savunması' },
    ],
  },
  'rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR b KQkq': {
    name: 'Vezir Gambiti (1. d4 d5 2. c4)',
    eco: 'D06',
    continuations: [
      { san: 'e6', from: 'e7', to: 'e6', winRate: '49%', games: '290K', note: 'Kabul Edilmeyen Vezir Gambiti (QGD)' },
      { san: 'c6', from: 'c7', to: 'c6', winRate: '49%', games: '185K', note: 'Slav Savunması' },
      { san: 'dxc4', from: 'd5', to: 'c4', winRate: '47%', games: '58K', note: 'Kabul Edilen Vezir Gambiti (QGA)' },
    ],
  },
};

export function lookupOpeningBook(fen) {
  if (!fen) return null;
  const key = fen.split(' ').slice(0, 3).join(' ');
  return OPENING_BOOK_BY_FEN_KEY[key] || null;
}
