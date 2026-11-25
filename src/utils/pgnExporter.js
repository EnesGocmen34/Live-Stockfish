// Standard Chess PGN Exporter with headers and formatted moves

export function buildStandardPgn({
  white = 'Beyaz',
  black = 'Siyah',
  whiteElo = null,
  blackElo = null,
  timeControl = null,
  event = 'Live Stockfish Arena Match',
  site = 'Live Stockfish Arena',
  date = null,
  result = '*',
  termination = 'Normal',
  moves = [],
}) {
  const d = date || new Date().toISOString().slice(0, 10).replace(/-/g, '.');

  const headers = [
    `[Event "${event}"]`,
    `[Site "${site}"]`,
    `[Date "${d}"]`,
    `[Round "1"]`,
    `[White "${white}"]`,
    `[Black "${black}"]`,
    `[Result "${result}"]`,
    whiteElo ? `[WhiteElo "${whiteElo}"]` : null,
    blackElo ? `[BlackElo "${blackElo}"]` : null,
    timeControl ? `[TimeControl "${timeControl}"]` : null,
    termination ? `[Termination "${termination}"]` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const moveStrings = [];
  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    const san = typeof move === 'string' ? move : move?.san || '';
    if (!san) continue;

    if (i % 2 === 0) {
      moveStrings.push(`${Math.floor(i / 2) + 1}. ${san}`);
    } else {
      moveStrings.push(san);
    }
  }

  const movesBody = moveStrings.join(' ');
  const fullPgn = `${headers}\n\n${movesBody ? movesBody + ' ' : ''}${result}`.trim();
  return fullPgn;
}
