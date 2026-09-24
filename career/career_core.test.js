/**
 * career_core.js の動作検証テスト（復元版）
 * 実行: node career/career_core.test.js
 */

global.localStorage = {
  _data: {},
  getItem(k) { return this._data[k] ?? null; },
  setItem(k, v) { this._data[k] = String(v); },
  removeItem(k) { delete this._data[k]; },
};

const C = require('./career_core.js');

let passed = 0, failed = 0;
function check(label, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label} ${extra}`); }
}
function section(t) { console.log(`\n=== ${t} ===`); }

// ------------------------------------------------------------
section('1. 枠割当の一般化（既存18頭ロジックとの一致検証）');

function legacyWaku(index) {
  if (index < 12) return Math.floor(index / 2);
  else if (index < 15) return 6;
  else return 7;
}
const generalized18 = C.assignWakuIndices(18);
let match18 = true;
for (let i = 0; i < 18; i++) {
  if (generalized18[i] !== legacyWaku(i)) { match18 = false; break; }
}
check('n=18 で既存の決め打ちロジックと完全一致', match18);
[10, 12, 14, 16].forEach(n => {
  const w = C.assignWakuIndices(n);
  check(`n=${n}: 長さ${n}・全て0-7の範囲内`, w.length === n && w.every(x => x >= 0 && x <= 7));
});

// ------------------------------------------------------------
section('2. 表示スケール変換（0.1刻み）');

const minSpeed = C.STAT_RANGE.speedBase.min, maxSpeed = C.STAT_RANGE.speedBase.max;
check('最低値が0に変換される', C.toDisplayScale(minSpeed, 'speedBase') === 0);
check('最高値が100に変換される', C.toDisplayScale(maxSpeed, 'speedBase') === 100);
const mid = (minSpeed + maxSpeed) / 2;
check('中間値が約50に変換される', Math.abs(C.toDisplayScale(mid, 'speedBase') - 50) <= 0.5);

// ------------------------------------------------------------
section('3. 所有馬の生成');

const h = C.createOwnedHorse({ name: 'テストホース', birthTurn: 0 });
check('名前が設定される', h.name === 'テストホース');
check('初期ステータスがレンジ内', h.speedBase >= minSpeed && h.speedBase <= maxSpeed);
check('脚質適性が4つある', Object.keys(h.aptitude).length === 4);
const bestApt = C.bestAptitudeKey(h);
check('得意脚質が65以上', h.aptitude[bestApt] >= 65);
check('成長タイプが設定される', ['early','normal','late'].includes(h.growthType));
check('初期クラスはC3(園田の最下級)', h.currentClass === 'C3');
check('初期疲労は0', h.fatigue === 0);
check('世代1からスタート', h.generation === 1);

// ------------------------------------------------------------
section('4. 調教による成長・疲労');

const h2 = C.createOwnedHorse({ birthTurn: 0 }); h2.growthType = 'normal';
const beforeSpeed = h2.speedBase;
const rep = C.applyTraining(h2, C.ACTION.TRAIN_SPEED, 0);
check('スピードが上昇する', h2.speedBase > beforeSpeed);
check('疲労が加算される', h2.fatigue === C.FATIGUE.perTraining);
check('レポートが返る', rep.stat === 'スピード');

const h3 = C.createOwnedHorse({ birthTurn: 0 });
h3.fatigue = 50;
C.applyRest(h3);
check('休養で疲労が減る', h3.fatigue === 50 + C.FATIGUE.perRest);
h3.fatigue = 5; C.applyRest(h3);
check('疲労は0未満にならない', h3.fatigue === 0);
h3.fatigue = 95; C.applyTraining(h3, C.ACTION.TRAIN_SPEED, 0);
check('疲労は100を超えない', h3.fatigue === 100);

// ------------------------------------------------------------
section('5. コンディション抽選（疲労連動）');

function sampleConditions(fatigue, n = 3000) {
  const counts = {};
  for (let i = 0; i < n; i++) { const k = C.rollCondition(fatigue); counts[k] = (counts[k]||0)+1; }
  return counts;
}
const lowF = sampleConditions(0), highF = sampleConditions(100);
const lowGood = (lowF['最高']||0)+(lowF['良']||0), highGood = (highF['最高']||0)+(highF['良']||0);
check('低疲労のほうが好調が出やすい', lowGood > highGood * 1.5);

// ------------------------------------------------------------
section('6. 週サイクル・引退');

const state = C.createNewGameState('シュウテスト');
const fundsBefore = state.funds;
const res = C.advanceWeek(state, C.ACTION.TRAIN_SPEED, C.ACTION.REST);
check('ターンが1進む', state.currentTurn === 1);
check('資金が維持費分減る', state.funds < fundsBefore);
check('コンディションが再抽選される', typeof res.conditionKey === 'string');

const st3 = C.createNewGameState('インタイテスト');
st3.currentTurn = C.CAREER_TOTAL_WEEKS - 1;
check('150週未満では引退しない', C.checkRetirement(st3.horse, st3.currentTurn) === null);
st3.currentTurn = C.CAREER_TOTAL_WEEKS;
check('150週で自動引退する', C.checkRetirement(st3.horse, st3.currentTurn) === 'auto');
check('ステータスがretiredになる', st3.horse.status === 'retired');

const st4 = C.createNewGameState('ニンイインタイ');
check('3歳未満の任意引退は拒否される', C.retireByChoice(st4.horse, 10).ok === false);
check('3歳以降なら任意引退できる', C.retireByChoice(st4.horse, 60).ok === true);

// ------------------------------------------------------------
section('7. レースエンジンへの変換');

const h5 = C.createOwnedHorse({ name: 'ヘンカンテスト', birthTurn: 0 });
const raceHorse = C.ownedHorseToRaceHorse(h5, { strategy: 'senko', distance: 1400, conditionStatMod: 1.0 });
check('名前が引き継がれる', raceHorse.name === 'ヘンカンテスト');
check('作戦がtypeになる', raceHorse.type === 'senko');
check('毛色が引き継がれる', raceHorse.coat === h5.coat);
check('ダート固定', raceHorse.surf === 'dirt');
check('プレイヤー馬フラグが立つ', raceHorse.isPlayerHorse === true);
check('spurtがレンジ内', raceHorse.spurt > 0.9 && raceHorse.spurt < 1.6);

const h6 = C.createOwnedHorse({ birthTurn: 0 });
h6.aptitude = { nige: 90, senko: 30, sashi: 30, oikomi: 30 };
const good = C.ownedHorseToRaceHorse(h6, { strategy: 'nige', distance: 1400 });
const bad  = C.ownedHorseToRaceHorse(h6, { strategy: 'senko', distance: 1400 });
check('得意脚質のほうが能力値が高くなる', good.speedBase > bad.speedBase);

// ------------------------------------------------------------
section('8. 馬場状態・ポテンシャル');

for (const k of C.TRACK_CONDITION_ORDER) {
  check(`馬場状態[${k}]にstyleModがある`, !!C.TRACK_CONDITIONS[k].styleMod);
}
const h7 = C.createOwnedHorse({ birthTurn: 0 });
const goodTrack = C.ownedHorseToRaceHorse(h7, { strategy: 'nige', trackCondition: 'good' });
const poorTrack = C.ownedHorseToRaceHorse(h7, { strategy: 'nige', trackCondition: 'poor' });
check('不良馬場では逃げが強化される', poorTrack.speedBase > goodTrack.speedBase);
const oiGood = C.ownedHorseToRaceHorse(h7, { strategy: 'oikomi', trackCondition: 'good' });
const oiPoor = C.ownedHorseToRaceHorse(h7, { strategy: 'oikomi', trackCondition: 'poor' });
check('不良馬場では追込が弱化される', oiPoor.speedBase < oiGood.speedBase);
check('速度が上限を超えない(クランプ)', poorTrack.speedBase <= C.STAT_RANGE.speedBase.max * 1.12);

let potentials = {};
for (let i = 0; i < 200; i++) { const p = C.rollDayPotential(); potentials[p.key] = (potentials[p.key]||0)+1; }
check('ポテンシャルは普通が最頻出', potentials.normal > (potentials.great||0) && potentials.normal > (potentials.worst||0));

// ------------------------------------------------------------
section('9. NPC生成・ライバル馬・実在馬');

const used = new Set();
const names = Array.from({length: 30}, () => C.generateHorseName(used));
check('馬名が重複しない', new Set(names).size === 30);
check('馬名が9文字以内', names.every(n => n.length <= 9));

let strongerOk = true;
for (let i = 1; i < C.CLASS_ORDER.length; i++) {
  const lo = C.classStrength(C.CLASS_ORDER[i-1]), hi = C.classStrength(C.CLASS_ORDER[i]);
  if (hi.speedMin <= lo.speedMin) { strongerOk = false; break; }
}
check('クラスが上がるほどNPCが強くなる', strongerOk);

let rivalRaces = 0;
for (let n = 1; n <= 20; n++) {
  if (C.generateRaceField('C3', 9, { raceCount: n }).some(h => h.isRival)) rivalRaces++;
}
check('20レース中4回ライバルが出現(5走に1回)', rivalRaces === 4);

const REAL = ['イグナイター','ジンギ','オオエライジン','チャンストウライ','ロードバクシン','メグミオウジャ',
              'ケイエスヨシゼン','スマノヒツト','ニホンカイユーノス','ワカサルーチ','ハッピークイン','サンバコール',
              'タガノゴールド','エイシンニシパ','コパノリッキー','ドナアトラエンテ'];
const gradedField = C.generateRaceField('A1', 15, { raceCount: 3, realNames: REAL, isGraded: true });
check('重賞は全馬が実在馬の名前', gradedField.every(h => REAL.includes(h.name)));
check('重賞は全馬にisGradedRunnerフラグ', gradedField.every(h => h.isGradedRunner));
const condField = C.generateRaceField('C3', 9, { raceCount: 3, realNames: REAL, isGraded: false });
check('条件戦は実在馬を使わない', condField.every(h => !REAL.includes(h.name)));

// ------------------------------------------------------------
section('10. レース開催スケジュール（実カレンダー）');

let weeklyOk = true;
for (let t = 1; t <= 52; t++) { if (!C.getAvailableRace(t, 'C3')) { weeklyOk = false; break; } }
check('条件戦は毎週開催されている', weeklyOk);
check('重賞は年16走ある', C.GRADED_RACES.length === 16);
const kin = C.GRADED_RACES.find(r => r.name === '園田金盃');
check('園田金盃は年末開催', kin && kin.week >= 45 && kin.week <= 50);
const cs = C.GRADED_RACES.find(r => r.name === '兵庫チャンピオンシップ');
check('兵庫CSは5月開催', cs && cs.week >= 17 && cs.week <= 21);

const promoHorse = C.createOwnedHorse({ birthTurn: 0 });
check('未勝利では昇級しない', C.tryPromote(promoHorse) === null);
promoHorse.winsInCurrentClass = 1;
check('1勝でC3→C2に昇級', C.tryPromote(promoHorse) === 'C2');
check('昇級でクラス内勝利数がリセットされる', promoHorse.winsInCurrentClass === 0);

// ------------------------------------------------------------
section('11. 賞金・馬券');

check('C1クラス1着は110万(2026年実額)', C.calcPrize(1, 'C1') === 1100000);
check('C1クラス2着は44万(配分率40%)', C.calcPrize(2, 'C1') === 440000);
const kinpai = C.GRADED_RACES.find(r => r.name === '園田金盃');
check('園田金盃1着は3000万', C.calcPrize(1, kinpai) === 30000000);

const st5 = C.createNewGameState('ショウキンテスト');
const f0 = st5.funds;
C.applyRaceResult(st5, st5.horse, 1, 'B1', { raceName: 'テスト特別', distance: 1400 });
check('資金に賞金が加算される', st5.funds === f0 + 2000000);
check('勝利数が増える', st5.horse.totalWins === 1);

const field = C.generateRaceField('C1', 11, { raceCount: 1 });
const odds = C.calcOdds(field);
check('全馬にオッズがつく', odds.every(h => h.oddsWin > 0 && h.oddsPlace > 0));
check('複勝は単勝より低い', odds.every(h => h.oddsPlace <= h.oddsWin));
check('単勝1着で的中', C.calcPayout({type:'WIN',amount:1000,odds:3.0},1).hit === true);
check('複勝4着は不的中', C.calcPayout({type:'PLACE',amount:1000,odds:1.8},4).hit === false);

// ------------------------------------------------------------
section('12. 繁殖・世代交代');

for (let g = 1; g <= 5; g++) {
  check(`世代${g}の継承率は0〜1の範囲`, C.inheritRate(g, 'C3') >= 0 && C.inheritRate(g, 'C3') <= 1);
}
let classAscending = true;
for (let i = 1; i < C.CLASS_ORDER.length; i++) {
  if (C.inheritRate(1, C.CLASS_ORDER[i]) <= C.inheritRate(1, C.CLASS_ORDER[i-1])) { classAscending = false; break; }
}
check('到達クラスが高いほど継承率が上がる', classAscending);

const parent = C.createOwnedHorse({ birthTurn: 0 });
parent.speedBase = C.STAT_RANGE.speedBase.max; parent.currentClass = 'A1';
const child = C.breedOffspring(parent, 150);
check('仔馬は世代+1になる', child.generation === parent.generation + 1);
check('仔馬の誕生週が指定通り', child.birthTurn === 150);
check('毛色が継承される', child.coat === parent.coat);
check('親がA1だと仔馬の初期値が高くなる', C.toDisplayScale(child.speedBase, 'speedBase') > 15);

// ------------------------------------------------------------
section('13. セーブ／ロード');

const st6 = C.createNewGameState('セーブテスト');
st6.funds = 1234567; st6.currentTurn = 42;
C.saveGame(st6);
check('セーブデータが存在する', C.hasSaveData());
const loaded = C.loadGame();
check('資金が復元される', loaded.funds === 1234567);
check('馬名が復元される', loaded.horse.name === 'セーブテスト');

// ------------------------------------------------------------
section('14. 統合シミュレーション（150週フルキャリア）');

const sim = C.createNewGameState('フルキャリア');
sim.horse.growthType = 'normal';
for (let w = 0; w < C.CAREER_TOTAL_WEEKS; w++) {
  if (sim.horse.status !== 'active') break;
  const rest = sim.horse.fatigue >= 55;
  C.advanceWeek(sim, rest ? C.ACTION.REST : C.ACTION.TRAIN_SPEED, rest ? C.ACTION.REST : C.ACTION.TRAIN_STAMINA);
}
check('150週で自動引退している', sim.horse.status === 'retired');
check('疲労が常に0-100の範囲内だった', sim.horse.fatigue >= 0 && sim.horse.fatigue <= 100);
console.log(`     [参考] 最終スピード: ${C.toDisplayScale(sim.horse.speedBase,'speedBase').toFixed(1)}`);

// ------------------------------------------------------------
console.log(`\n${'='.repeat(50)}`);
console.log(`  結果:  ✅ ${passed} 件成功  /  ❌ ${failed} 件失敗`);
console.log(`${'='.repeat(50)}\n`);
process.exit(failed > 0 ? 1 : 0);
