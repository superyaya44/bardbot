// Rejoue loopMode isolément (même source que db.js)
const loopMode = (v) => {
  if (typeof v === 'boolean') return v ? 2 : 0;
  const n = Number(v);
  return n === 2 ? 2 : n === 1 ? 1 : 0;
};
const cases = [[true,2],[false,0],[2,2],[1,1],[0,0],['2',2],['1',1],[undefined,0],[null,0]];
let ko=0;
for (const [input, expected] of cases) {
  const got = loopMode(input);
  const ok = got === expected; if(!ok) ko++;
  console.log(`  ${ok?'✓':'✗'} ${JSON.stringify(input)} → ${got}${ok?'':`  ATTENDU ${expected}`}`);
}
console.log(ko ? `${ko} échec(s)` : '  tous les cas passent');
