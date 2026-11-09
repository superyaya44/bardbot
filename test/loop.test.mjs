// Teste refillQueue en isolation, en simulant la consommation de la file par playNext
const { refillQueue } = await import('../src/bot.js');

const mk = (loop, n) => {
  const tracks = Array.from({ length: n }, (_, i) => ({ id: i + 1, title: `t${i + 1}` }));
  return { loop, queue: tracks.map((t) => ({ ...t })), tracks, now: null };
};
// Rejoue `steps` fois le cycle "prendre un morceau" et retourne l'ordre obtenu
const run = (ctx, steps) => {
  const played = [];
  for (let i = 0; i < steps; i++) {
    if (!refillQueue(ctx)) { played.push('STOP'); break; }
    ctx.now = ctx.queue.splice(0, 1)[0];
    played.push(ctx.now.title);
  }
  return played.join(' ');
};

const cases = [
  ['loop 0 (off), 2 morceaux      ', mk(0, 2), 5, 't1 t2 STOP'],
  ['loop 1 (morceau), 1 morceau   ', mk(1, 1), 4, 't1 t1 t1 t1'],
  ['loop 1 (morceau), 2 morceaux  ', mk(1, 2), 5, 't1 t2 t2 t2 t2'],
  ['loop 2 (playlist), 1 morceau  ', mk(2, 1), 4, 't1 t1 t1 t1'],
  ['loop 2 (playlist), 3 morceaux ', mk(2, 3), 7, 't1 t2 t3 t1 t2 t3 t1'],
  ['loop 2, playlist vide         ', { loop: 2, queue: [], tracks: [], now: null }, 2, 'STOP'],
];
let ko = 0;
for (const [label, ctx, steps, expected] of cases) {
  const got = run(ctx, steps);
  const ok = got === expected;
  if (!ok) ko++;
  console.log(`${ok ? '✓' : '✗'} ${label} → ${got}${ok ? '' : `   ATTENDU: ${expected}`}`);
}
console.log(ko ? `\n${ko} test(s) en échec` : '\nTous les cas passent');
process.exit(ko ? 1 : 0);
