/**
 * career_core.js の大規模フラジングテスト（1000回規模）
 * ランダムなプレイ方針で何世代もキャリアを回し、異常値・クラッシュ・
 * 論理矛盾が起きないかを検証する。
 * 実行: node career/fuzz_test.js [回数]
 */

global.localStorage = {
  _data: {},
  getItem(k) { return this._data[k] ?? null; },
  setItem(k, v) { this._data[k] = String(v); },
  removeItem(k) { delete this._data[k]; },
};

const C = require('./career_core.js');

const ITERATIONS = parseInt(process.argv[2], 10) || 1000;
const ACTIONS = [C.ACTION.TRAIN_SPEED, C.ACTION.TRAIN_STAMINA, C.ACTION.TRAIN_GUTS, C.ACTION.REST];

let crashes = [];
let anomalies = [];
let stats = {
  totalWeeksSimulated: 0,
  totalRaces: 0,
  totalRetirements: 0,
  totalBreedings: 0,
  maxGenerationReached: 1,
  negativeFundsRuns: 0,
  fundsRange: [Infinity, -Infinity],
  statOverflows: 0,
};

function isFinal(n) { return typeof n === 'number' && isFinite(n) && !isNaN(n); }

function checkHorseSanity(h, runId, ctx) {
  const errs = [];
  if (!isFinal(h.speedBase)) errs.push(`speedBase不正: ${h.speedBase}`);
  if (!isFinal(h.maxStamina)) errs.push(`maxStamina不正: ${h.maxStamina}`);
  if (!isFinal(h.guts) || h.guts < 0 || h.guts > 100) errs.push(`guts範囲外: ${h.guts}`);
  if (!isFinal(h.fatigue) || h.fatigue < 0 || h.fatigue > 100) errs.push(`fatigue範囲外: ${h.fatigue}`);
  if (h.speedBase < C.STAT_RANGE.speedBase.min * 0.8 || h.speedBase > C.STAT_RANGE.speedBase.max * 1.15) {
    errs.push(`speedBaseが想定レンジを大きく外れる: ${h.speedBase}`);
  }
  if (!C.CLASS_ORDER.includes(h.currentClass)) errs.push(`不正なクラス: ${h.currentClass}`);
  if (h.age < 2 || h.age > 20) errs.push(`年齢が異常: ${h.age}`);
  if (errs.length) {
    anomalies.push({ runId, ctx, horseName: h.name, errs });
  }
  return errs.length === 0;
}

/** NPC（レースエンジン用の軽量な馬オブジェクト）専用のチェック。
 *  OwnedHorseと違いguts/fatigue/currentClassは元々持たないフィールドなので対象外。 */
function checkNpcSanity(h, runId, ctx) {
  const errs = [];
  if (!isFinal(h.speedBase)) errs.push(`speedBase不正: ${h.speedBase}`);
  if (!isFinal(h.maxStamina)) errs.push(`maxStamina不正: ${h.maxStamina}`);
  if (!isFinal(h.spurt)) errs.push(`spurt不正: ${h.spurt}`);
  if (h.speedBase < C.STAT_RANGE.speedBase.min * 0.8 || h.speedBase > C.STAT_RANGE.speedBase.max * 1.15) {
    errs.push(`speedBaseが想定レンジを大きく外れる: ${h.speedBase}`);
  }
  if (!['nige','senko','sashi','oikomi'].includes(h.type)) errs.push(`不正な脚質: ${h.type}`);
  if (!h.name || typeof h.name !== 'string') errs.push(`馬名が不正: ${h.name}`);
  if (errs.length) {
    anomalies.push({ runId, ctx, horseName: h.name, errs });
  }
  return errs.length === 0;
}

function randomChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

for (let run = 0; run < ITERATIONS; run++) {
  try {
    const state = C.createNewGameState(`Fuzz${run}`);
    state.horse.growthType = randomChoice(['early', 'normal', 'late']);
    state.horse.sex = Math.random() < 0.5 ? 'male' : 'female';

    let generationsThisRun = 0;
    const maxGenerations = 1 + Math.floor(Math.random() * 8); // 1〜8世代（深い血統連鎖のテスト）

    while (generationsThisRun < maxGenerations) {
      let weeksThisGen = 0;
      const maxWeeksPerGen = 400; // 安全弁（本来は150週で自動引退するはず）

      while (weeksThisGen < maxWeeksPerGen) {
        if (state.horse.status !== 'active') break;

        checkHorseSanity(state.horse, run, `週${weeksThisGen}前`);

        // ランダムな行動方針（本当にランダムな入力に耐えられるか）
        const fatigue = state.horse.fatigue;
        let a1, a2;
        const raceInfo = C.getAvailableRace(state.currentTurn + 1, state.horse.currentClass, state.horse);
        const wantRace = raceInfo && Math.random() < 0.25; // 25%の確率でレースを選ぶ

        if (wantRace) {
          a1 = randomChoice(ACTIONS.filter(a => a !== C.ACTION.RACE));
          a2 = C.ACTION.RACE;
        } else {
          a1 = randomChoice(ACTIONS);
          a2 = randomChoice(ACTIONS);
        }

        const res = C.advanceWeek(state, a1, a2);
        weeksThisGen++;
        stats.totalWeeksSimulated++;

        if (a2 === C.ACTION.RACE && raceInfo) {
          // 出馬表〜レース〜結果反映までの一連をシミュレート
          const npcCount = raceInfo.fieldSize - 1;
          const npc = C.generateRaceField(state.horse.currentClass, npcCount, {
            raceCount: state.horse.totalRaces + 1,
            realNames: ['イグナイター','ジンギ','オオエライジン','チャンストウライ','ロードバクシン'],
            isGraded: raceInfo.isGraded,
            trackCondition: C.rollTrackCondition(),
            sexRestriction: raceInfo.sexRestriction,
          });
          if (npc.length !== npcCount) {
            anomalies.push({ runId: run, ctx: 'NPC頭数不一致', expect: npcCount, actual: npc.length });
          }
          npc.forEach(h => checkNpcSanity(h, run, 'NPC生成'));

          const rank = 1 + Math.floor(Math.random() * raceInfo.fieldSize);
          if (rank < 1 || rank > raceInfo.fieldSize) {
            anomalies.push({ runId: run, ctx: '着順範囲外', rank });
          }
          const before = state.funds;
          C.applyRaceResult(state, state.horse, rank, state.horse.currentClass, {
            raceName: raceInfo.name, distance: raceInfo.distance, prize1st: raceInfo.prize1st,
          });
          if (!isFinal(state.funds)) anomalies.push({ runId: run, ctx: '資金がNaN化', before, after: state.funds });
          stats.totalRaces++;

          // 馬券のシミュレーション
          if (Math.random() < 0.5) {
            const playerRH = C.ownedHorseToRaceHorse(state.horse, {
              strategy: C.bestAptitudeKey(state.horse), distance: raceInfo.distance,
              trackCondition: C.rollTrackCondition(),
            });
            const field = C.calcOdds([playerRH, ...npc]);
            field.forEach(f => {
              if (!isFinal(f.oddsWin) || f.oddsWin < 1.0) anomalies.push({ runId: run, ctx: 'オッズが不正', odds: f.oddsWin, name: f.name });
            });
            const betAmount = randomChoice(C.BET_UNITS);
            const betType = randomChoice(['WIN', 'PLACE']);
            const payout = C.calcPayout({ type: betType, amount: betAmount, odds: 3.0 }, rank);
            if (!isFinal(payout.payout) || payout.payout < 0) {
              anomalies.push({ runId: run, ctx: '払戻が不正', payout });
            }
          }

          const promoted = C.tryPromote(state.horse);
          if (promoted && !C.CLASS_ORDER.includes(promoted)) {
            anomalies.push({ runId: run, ctx: '昇級先クラスが不正', promoted });
          }
        }

        if (state.funds < stats.fundsRange[0]) stats.fundsRange[0] = state.funds;
        if (state.funds > stats.fundsRange[1]) stats.fundsRange[1] = state.funds;
        if (state.funds < 0) stats.negativeFundsRuns++;

        if (res.retired) {
          stats.totalRetirements++;
          checkHorseSanity(state.horse, run, '引退時');
          break;
        }
      }

      if (state.horse.status !== 'retired') {
        // 150週以内に引退しなかった（安全弁に達した）→ 明確な異常
        anomalies.push({ runId: run, ctx: '150週(+安全弁)以内に引退しなかった', weeksThisGen, status: state.horse.status });
        break;
      }

      generationsThisRun++;
      if (generationsThisRun < maxGenerations) {
        const parent = state.horse;
        const child = C.breedOffspring(parent, state.currentTurn);
        checkHorseSanity(child, run, '繁殖直後の仔馬');
        state.retiredHorses.push(parent);
        state.horse = child;
        stats.totalBreedings++;
        if (child.generation > stats.maxGenerationReached) stats.maxGenerationReached = child.generation;

        // 血統表チェーンの健全性
        const chain = C.buildPedigreeChain(child, state.retiredHorses);
        if (chain.length !== generationsThisRun + 1) {
          anomalies.push({ runId: run, ctx: '血統チェーンの長さが世代数と不一致', expect: generationsThisRun + 1, actual: chain.length });
        }
        if (chain[0].id !== child.id) {
          anomalies.push({ runId: run, ctx: '血統チェーンの先頭が現在の馬でない' });
        }
      }
    }

    // セーブ/ロードの往復チェック
    C.saveGame(state);
    const loaded = C.loadGame();
    if (loaded.horse.name !== state.horse.name || loaded.funds !== state.funds) {
      anomalies.push({ runId: run, ctx: 'セーブ/ロードで内容が変わった' });
    }

  } catch (e) {
    crashes.push({ runId: run, error: e.message, stack: e.stack.split('\n').slice(0,3).join(' | ') });
  }

  if ((run + 1) % 100 === 0) {
    process.stdout.write(`  ${run + 1}/${ITERATIONS} 完了（クラッシュ${crashes.length}件・異常値${anomalies.length}件）\n`);
  }
}

console.log('\n' + '='.repeat(60));
console.log(`フラジングテスト結果（${ITERATIONS}回実行）`);
console.log('='.repeat(60));
console.log(`総シミュレート週数: ${stats.totalWeeksSimulated}`);
console.log(`総レース数: ${stats.totalRaces}`);
console.log(`総引退数: ${stats.totalRetirements}`);
console.log(`総繁殖数: ${stats.totalBreedings}`);
console.log(`到達した最大世代: ${stats.maxGenerationReached}`);
console.log(`資金レンジ: ¥${stats.fundsRange[0].toLocaleString()} 〜 ¥${stats.fundsRange[1].toLocaleString()}`);
console.log(`資金がマイナスだった週の延べ数: ${stats.negativeFundsRuns}`);
console.log(`\nクラッシュ（例外）: ${crashes.length}件`);
crashes.slice(0, 10).forEach(c => console.log(`  [run${c.runId}] ${c.error}\n    ${c.stack}`));
console.log(`\n異常値検出: ${anomalies.length}件`);
anomalies.slice(0, 15).forEach(a => console.log(`  [run${a.runId}] ${a.ctx}: ${JSON.stringify(a).slice(0,150)}`));

const exitCode = (crashes.length > 0 || anomalies.length > 0) ? 1 : 0;
console.log('\n' + (exitCode === 0 ? '✅ 異常なし' : '❌ 問題あり（上記参照）'));
process.exit(exitCode);
