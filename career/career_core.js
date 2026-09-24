/**
 * 兵庫アーバン競馬シミュレーター Ver10.0 — 育成モード ロジック層
 * ============================================================
 * 設計方針：
 *   既存レースエンジン(js.html)には一切手を入れず、このファイルを独立した
 *   ロジック層として追加する。既存エンジンとの接続は ownedHorseToRaceHorse()
 *   ただ一つの変換関数を介して行う。
 *
 *   詳細設計は docs/DATA_MODEL_v10.md / docs/DESIGN_v10_training.md を参照。
 */

// ============================================================
// 1. 定数定義
// ============================================================

/** 1年の週数 */
const WEEKS_PER_YEAR = 52;

/** 1頭の現役期間（週）。約2.9年 */
const CAREER_TOTAL_WEEKS = 150;

/** 育成ステータスの内部値レンジ（既存エンジンのC〜S相当に対応）
 *  既存 setupHorsesPool() の実測値：
 *    S: speedBase 1.35 / maxStamina 165 / spurt 1.4
 *    C: speedBase 1.26 / maxStamina 135 / spurt 1.1
 */
const STAT_RANGE = {
  speedBase:  { min: 1.26, max: 1.35 },
  maxStamina: { min: 135,  max: 165  },
  spurt:      { min: 1.1,  max: 1.4  },
};

/** クラス定義：園田競馬の実際の格付け（C3→C2→C1→B2→B1→A2→A1）に準拠。
 *  出走頭数は下級ほど少なく、上級ほど多くなるよう設定。
 *  賞金額は2026年の園田競馬の実額を基準にクラス間で段階的に設定している。
 *    （参考実額：C1 4歳以上特別 1着110万円／一般戦 1着200万円）
 */
const RACE_CLASSES = {
  C3: { key:'C3', label:'C3', order:0, fieldSize:10, prize1st:  600000 },
  C2: { key:'C2', label:'C2', order:1, fieldSize:10, prize1st:  800000 },
  C1: { key:'C1', label:'C1', order:2, fieldSize:12, prize1st: 1100000 },
  B2: { key:'B2', label:'B2', order:3, fieldSize:12, prize1st: 1500000 },
  B1: { key:'B1', label:'B1', order:4, fieldSize:14, prize1st: 2000000 },
  A2: { key:'A2', label:'A2', order:5, fieldSize:14, prize1st: 2800000 },
  A1: { key:'A1', label:'A1', order:6, fieldSize:16, prize1st: 4000000 },
};

/** クラスの昇級順（下から上へ） */
const CLASS_ORDER = ['C3','C2','C1','B2','B1','A2','A1'];

/**
 * 園田競馬の実際の年間重賞カレンダー（2026年の開催日・距離に準拠）。
 * week は1年52週のうちの開催週（1月第1週=1週目として日付から換算）。
 * 姫路開催の重賞も、園田の近い距離に読み替えて同じカレンダーに載せている。
 * sexRestriction: 'female' の場合は牝馬限定。ageRestriction: 数値の場合は
 * その年齢の馬だけが出走できる（実際の「菊花賞」「優駿」等の3歳限定重賞、
 * 「女王盃」「クイーン賞」等の牝馬限定重賞に準拠）。指定が無ければ制限なし。
 */
const GRADED_RACES = [
  { week:  4, name: '新春賞',              distance: 1400, prize1st: 10000000 },
  { week:  8, name: '兵庫女王盃',          distance: 1400, prize1st: 12000000, sexRestriction: 'female' },
  { week: 11, name: '姫路菊花賞',          distance: 1800, prize1st:  8000000, ageRestriction: 3 },
  { week: 13, name: '菊水賞',              distance: 1700, prize1st: 12000000 },
  { week: 15, name: '西日本クラシック',    distance: 1870, prize1st: 10000000, ageRestriction: 3 },
  { week: 18, name: '兵庫大賞典',          distance: 1400, prize1st: 15000000 },
  { week: 19, name: '兵庫優駿',            distance: 1870, prize1st: 15000000, ageRestriction: 3 },
  { week: 19, name: '兵庫チャンピオンシップ', distance: 1400, prize1st: 50000000 },
  { week: 20, name: 'のじぎく賞',          distance: 1700, prize1st: 10000000, sexRestriction: 'female' },
  { week: 23, name: '六甲盃',              distance: 1870, prize1st: 15000000 },
  { week: 25, name: '園田FCスプリント',    distance:  820, prize1st: 10000000 },
  { week: 28, name: '兵庫サマークイーン賞',distance: 1700, prize1st: 10000000, sexRestriction: 'female' },
  { week: 33, name: '摂津盃',              distance: 1700, prize1st: 10000000 },
  { week: 38, name: '楠賞',                distance: 1400, prize1st: 12000000 },
  { week: 43, name: '兵庫ゴールドトロフィー', distance: 1400, prize1st: 20000000 },
  { week: 48, name: '園田金盃',            distance: 1870, prize1st: 30000000 },
];

/** 着順ごとの賞金配分率（1着を1.0とした比率）
 *  2026年の園田C1特別の実額 110万/44万/27.5万/16.5万/11万 から算出した実際の配分
 */
const PRIZE_RATE_BY_RANK = [1.0, 0.40, 0.25, 0.15, 0.10];

/** 資金まわり */
const ECONOMY = {
  initialFunds: 3000000,
  weeklyCostTraining: 30000,  // 調教を行った週
  weeklyCostRest:     15000,  // 休養のみの週
};

/** 週の行動タイプ */
const ACTION = {
  TRAIN_SPEED:   'train_speed',
  TRAIN_STAMINA: 'train_stamina',
  TRAIN_GUTS:    'train_guts',
  REST:          'rest',
  RACE:          'race',
};

/** 疲労の増減量
 *  ※条件戦は毎週開催になったため、レースに出ながら調教も回せるよう
 *    蓄積を緩やかにし、休養での回復量を大きくしている。
 */
const FATIGUE = {
  perTraining: 12,
  perRest:    -32,
  perRace:     16,
  min: 0,
  max: 100,
};

/** 成長タイプごとの伸び率カーブ
 *  early（早熟）：序盤よく伸び、後半は伸び悩む
 *  late（晩成）：序盤は伸びないが、後半に大きく伸びる
 */
const GROWTH_CURVES = {
  early:  (progress) => 1.5 - 1.0 * progress,   // 1.5 → 0.5
  normal: () => 1.0,                             // 常に1.0
  late:   (progress) => 0.5 + 1.0 * progress,   // 0.5 → 1.5
};

/** 1回の調教あたりの基礎上昇量（内部値ベース）
 *  ※150週フルキャリアのシミュレーションで調整済み。
 *    この値だと、疲労管理をしながら1つのステータスに特化した場合で最終94前後、
 *    2種類に分散した場合は各60前後になり、カンストしない。
 *    「特化して尖らせるか、バランス良く伸ばすか」の選択が最後まで意味を持つ。
 */
const TRAIN_GAIN = {
  speedBase:  0.00042,
  maxStamina: 0.132,
  guts:       0.192,
};

// ============================================================
// 2. ユーティリティ
// ============================================================

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

function randomPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function generateId(prefix = 'h') {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

/**
 * 内部値（狭いレンジ）を、プレイヤー表示用の0-100スケールに変換する。
 * speedBase の可動域は 1.26〜1.35 と非常に狭く、そのまま見せても成長が実感できないため。
 */
function toDisplayScale(internalValue, statKey) {
  const range = STAT_RANGE[statKey];
  if (!range) return Math.round(internalValue * 10) / 10;
  const ratio = (internalValue - range.min) / (range.max - range.min);
  return Math.round(clamp(ratio, 0, 1) * 1000) / 10;
}

/** 表示スケール(0-100)から内部値へ戻す */
function fromDisplayScale(displayValue, statKey) {
  const range = STAT_RANGE[statKey];
  if (!range) return displayValue;
  const ratio = clamp(displayValue, 0, 100) / 100;
  return range.min + ratio * (range.max - range.min);
}

// ============================================================
// 3. OwnedHorse（所有馬）の生成
// ============================================================

const COAT_KEYS = ['bay', 'darkBay', 'blueBlack', 'black', 'chestnut', 'liverChestnut', 'gray', 'white'];

/**
 * 新しい所有馬を生成する。
 * @param {object} opts - name, sex, coat, birthTurn, sireId, damId, generation を任意で指定可能
 */
function createOwnedHorse(opts = {}) {
  // 初期能力はC〜B相当のあたりからランダムに開始する
  const startRatio = () => 0.05 + Math.random() * 0.25;  // 内部レンジの5%〜30%地点

  // 脚質適性：1つだけ得意を作り、残りはばらつかせる
  const aptitude = { nige: 0, senko: 0, sashi: 0, oikomi: 0 };
  const keys = Object.keys(aptitude);
  keys.forEach(k => { aptitude[k] = Math.round(20 + Math.random() * 40); });  // 20〜60
  const bestKey = randomPick(keys);
  aptitude[bestKey] = Math.round(65 + Math.random() * 25);                    // 65〜90

  return {
    // --- 識別・見た目 ---
    id: opts.id || generateId(),
    name: opts.name || 'ナナシノウマ',
    coat: opts.coat || randomPick(COAT_KEYS),
    sex: opts.sex || (Math.random() < 0.5 ? 'male' : 'female'),
    birthTurn: opts.birthTurn ?? 0,
    age: 2,

    // --- 血統 ---
    sireId: opts.sireId || null,
    damId: opts.damId || null,
    generation: opts.generation ?? 1,

    // --- 育成ステータス（内部値） ---
    speedBase:  STAT_RANGE.speedBase.min  + startRatio() * (STAT_RANGE.speedBase.max  - STAT_RANGE.speedBase.min),
    maxStamina: STAT_RANGE.maxStamina.min + startRatio() * (STAT_RANGE.maxStamina.max - STAT_RANGE.maxStamina.min),
    guts: Math.round(25 + Math.random() * 25),          // 0-100スケール
    temperament: Math.round(20 + Math.random() * 60),   // 0(大人しい)〜100(荒い)
    aptitude,

    // --- 成長タイプ ---
    growthType: randomPick(['early', 'normal', 'late']),

    // --- コンディション ---
    fatigue: 0,
    conditionKey: '普通',
    isInjured: false,

    // --- 戦績 ---
    raceHistory: [],
    totalWins: 0,
    totalRaces: 0,
    totalPrize: 0,
    currentClass: 'C3',     // 昇級制。園田の最下級 C3 からスタート
    winsInCurrentClass: 0,  // 現在のクラスでの勝利数（1勝で昇級）

    // --- 状態 ---
    status: 'active',
    retiredAtTurn: null,
    offspringIds: [],
  };
}

// ============================================================
// 4. 成長・週サイクル処理
// ============================================================

/** キャリアの進行度(0.0〜1.0)を返す。成長カーブの計算に使う */
function careerProgress(owned, currentTurn) {
  return clamp((currentTurn - owned.birthTurn) / CAREER_TOTAL_WEEKS, 0, 1);
}

/**
 * 調教を1回実行する。成長タイプ・疲労状態に応じて効果が変動する。
 * @returns {object} 伸びた量のレポート（UI表示用）
 */
function applyTraining(owned, actionType, currentTurn) {
  const progress = careerProgress(owned, currentTurn);
  const curve = GROWTH_CURVES[owned.growthType] || GROWTH_CURVES.normal;
  const growthMult = curve(progress);

  // 疲労が溜まっているほど調教効果が落ちる。
  // ※高疲労域のペナルティが弱いと「休まず調教し続けるのが最適解」になり、
  //   週の使い方を選ぶ楽しみが消えてしまう。休養コスト(1枠=調教1回分)に
  //   見合うだけの強いペナルティを設定している。
  const fatiguePenalty = owned.fatigue >= 85 ? 0.05
                       : owned.fatigue >= 70 ? 0.15
                       : owned.fatigue >= 50 ? 0.6
                       : owned.fatigue >= 30 ? 0.9
                       : 1.0;

  // 気性が荒い馬は効果がぶれる（ハイリスク・ハイリターン）
  const temperVariance = 1 + ((Math.random() - 0.5) * (owned.temperament / 100) * 0.6);

  const factor = growthMult * fatiguePenalty * temperVariance;
  const report = { stat: null, gainDisplay: 0 };

  if (actionType === ACTION.TRAIN_SPEED) {
    const before = toDisplayScale(owned.speedBase, 'speedBase');
    owned.speedBase = clamp(owned.speedBase + TRAIN_GAIN.speedBase * factor,
                            STAT_RANGE.speedBase.min, STAT_RANGE.speedBase.max);
    report.stat = 'スピード';
    report.gainDisplay = toDisplayScale(owned.speedBase, 'speedBase') - before;
  } else if (actionType === ACTION.TRAIN_STAMINA) {
    const before = toDisplayScale(owned.maxStamina, 'maxStamina');
    owned.maxStamina = clamp(owned.maxStamina + TRAIN_GAIN.maxStamina * factor,
                             STAT_RANGE.maxStamina.min, STAT_RANGE.maxStamina.max);
    report.stat = 'スタミナ';
    report.gainDisplay = toDisplayScale(owned.maxStamina, 'maxStamina') - before;
  } else if (actionType === ACTION.TRAIN_GUTS) {
    const before = Math.round(owned.guts * 10) / 10;
    owned.guts = clamp(owned.guts + TRAIN_GAIN.guts * factor, 0, 100);
    report.stat = '根性';
    report.gainDisplay = Math.round(owned.guts * 10) / 10 - before;
  }

  owned.fatigue = clamp(owned.fatigue + FATIGUE.perTraining, FATIGUE.min, FATIGUE.max);
  return report;
}

/** 休養を1回実行する */
function applyRest(owned) {
  owned.fatigue = clamp(owned.fatigue + FATIGUE.perRest, FATIGUE.min, FATIGUE.max);
  return { stat: null, gainDisplay: 0, rested: true };
}

/**
 * 疲労度に応じたコンディション抽選テーブルを返す。
 * 既存エンジンの conditionList（最高/良/普通/悪/最悪）のキーに対応。
 */
function getConditionWeights(fatigue) {
  // 低疲労テーブルと高疲労テーブルを fatigue で線形補間する
  const low  = { '最高': 20, '良': 35, '普通': 30, '悪': 10, '最悪': 5 };
  const high = { '最高': 3,  '良': 12, '普通': 30, '悪': 35, '最悪': 20 };
  const t = clamp(fatigue / 100, 0, 1);
  const out = {};
  Object.keys(low).forEach(k => { out[k] = low[k] * (1 - t) + high[k] * t; });
  return out;
}

/** 重み付き抽選でコンディションキーを決める */
function rollCondition(fatigue) {
  const weights = getConditionWeights(fatigue);
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (const [key, w] of Object.entries(weights)) {
    r -= w;
    if (r <= 0) return key;
  }
  return '普通';
}

/**
 * 1週間を進める。前半・後半の2つの行動を受け取って処理する。
 * @param {object} state - { funds, currentTurn, horse }
 * @param {string} firstHalf  - ACTION.*
 * @param {string} secondHalf - ACTION.*
 * @returns {object} この週に起きたことのレポート（UI表示用）
 */
function advanceWeek(state, firstHalf, secondHalf) {
  const owned = state.horse;
  const reports = [];
  let didTrain = false;

  [firstHalf, secondHalf].forEach(action => {
    if (action === ACTION.REST) {
      reports.push(applyRest(owned));
    } else if (action === ACTION.RACE) {
      // レース処理は別途 runRace() を呼ぶ。ここでは疲労のみ加算
      owned.fatigue = clamp(owned.fatigue + FATIGUE.perRace, FATIGUE.min, FATIGUE.max);
      reports.push({ stat: null, raced: true });
    } else if (action && action.startsWith('train_')) {
      reports.push(applyTraining(owned, action, state.currentTurn));
      didTrain = true;
    }
  });

  // 資金：週次維持費
  const cost = didTrain ? ECONOMY.weeklyCostTraining : ECONOMY.weeklyCostRest;
  state.funds -= cost;

  // 週を進めて、コンディションを再抽選
  state.currentTurn += 1;
  owned.age = 2 + Math.floor((state.currentTurn - owned.birthTurn) / WEEKS_PER_YEAR);
  owned.conditionKey = rollCondition(owned.fatigue);

  // 引退判定
  const retired = checkRetirement(owned, state.currentTurn);

  return { reports, cost, retired, conditionKey: owned.conditionKey };
}

// ============================================================
// 5. 引退判定
// ============================================================

/** 世代ごとの基礎継承率に、親の到達クラスによる倍率をかける。
 *  ※「長く調教すれば強くなる」だけだと作業ゲー的になってしまうため、
 *    実際にレースで結果を出してクラスを上げたかどうかを継承の主な
 *    評価軸にする。C3のまま152週過ごした馬より、A1まで駆け上がった
 *    馬のほうが、仔馬にしっかり能力を伝えられる。
 */
function inheritRate(generation, finalClass) {
  const base = Math.min(0.42, 0.16 + (generation - 1) * 0.045);
  const idx = Math.max(0, CLASS_ORDER.indexOf(finalClass || 'C3'));
  const classMult = 0.55 + 0.45 * (idx / (CLASS_ORDER.length - 1));  // C3:0.55倍 〜 A1:1.0倍
  return base * classMult;
}

/**
 * 引退した親馬から仔馬を作る（繁殖）。
 * 能力は「ランダムな初期値」と「親の最終能力」を継承率で混ぜて決める。
 * 継承率は代を重ねるごとに緩やかに上がるため、初期の世代ほど
 * 少しずつしか強くならない（世代を重ねる意味が出るようにしている）。
 * @param {object} parent - 引退したOwnedHorse
 * @param {number} birthTurn - 仔馬が生まれる週
 */
function breedOffspring(parent, birthTurn) {
  const rate = inheritRate(parent.generation || 1, parent.currentClass);
  const child = createOwnedHorse({
    birthTurn,
    generation: (parent.generation || 1) + 1,
    sireId: parent.sex === 'male' ? parent.id : null,
    damId: parent.sex === 'female' ? parent.id : null,
    coat: parent.coat,   // 毛色は継承する
  });

  const mix = (base, parentVal, range) =>
    clamp(base + (parentVal - base) * rate, range.min, range.max);
  child.speedBase  = mix(child.speedBase,  parent.speedBase,  STAT_RANGE.speedBase);
  child.maxStamina = mix(child.maxStamina, parent.maxStamina, STAT_RANGE.maxStamina);
  child.guts       = clamp(child.guts + (parent.guts - child.guts) * rate, 0, 100);

  // 脚質適性も、親の得意分野を少し引き継ぐ
  const bestKey = bestAptitudeKey(parent);
  child.aptitude[bestKey] = clamp(child.aptitude[bestKey] + parent.aptitude[bestKey] * rate * 0.5, 0, 100);

  return child;
}

/**
 * 現在の所有馬から遡って血統表（祖先の連なり）を組み立てる。
 * 現在の育成モデルは「引退した1頭の親」から仔馬を作る形（父か母のどちらか
 * 一方の系統のみ）のため、血統表も枝分かれしない一本のチェーンになる。
 * @param {object} currentHorse - 表示対象の馬（省略時は末端から辿らない単体表示用）
 * @param {object[]} retiredHorses - state.retiredHorses（引退して殿堂入りした馬の配列）
 * @returns {object[]} 世代の新しい順（現在の馬が先頭）に並んだ祖先チェーン
 */
function buildPedigreeChain(currentHorse, retiredHorses) {
  const byId = new Map((retiredHorses || []).map(h => [h.id, h]));
  const chain = [];
  let cursor = currentHorse;
  const seen = new Set();
  while (cursor && !seen.has(cursor.id)) {
    chain.push(cursor);
    seen.add(cursor.id);
    const parentId = cursor.sireId || cursor.damId;
    cursor = parentId ? byId.get(parentId) : null;
  }
  return chain;
}

function checkRetirement(owned, currentTurn) {
  if (owned.status !== 'active') return null;
  const weeksElapsed = currentTurn - owned.birthTurn;
  if (weeksElapsed >= CAREER_TOTAL_WEEKS) {
    owned.status = 'retired';
    owned.retiredAtTurn = currentTurn;
    return 'auto';
  }
  return null;
}

/** プレイヤーの任意引退（3歳以降=52週経過後ならいつでも可） */
function retireByChoice(owned, currentTurn) {
  const weeksElapsed = currentTurn - owned.birthTurn;
  if (weeksElapsed < WEEKS_PER_YEAR) return { ok: false, reason: '3歳になるまで引退できません' };
  owned.status = 'retired';
  owned.retiredAtTurn = currentTurn;
  return { ok: true };
}

// ============================================================
// 6. 既存レースエンジンへの変換
// ============================================================

/**
 * 所有馬(OwnedHorse) → 既存エンジンの horse オブジェクト へ変換する。
 * 既存エンジンとの唯一の接続点。
 *
 * @param {object} owned
 * @param {object} raceContext - { strategy, distance, conditionStatMod }
 */
function ownedHorseToRaceHorse(owned, raceContext = {}) {
  // 作戦（脚質）はプレイヤーが選ぶ。未指定なら最も適性の高いものを自動選択
  const strategy = raceContext.strategy || bestAptitudeKey(owned);
  const aptValue = owned.aptitude[strategy] ?? 50;

  // 適性が高いほどプラス、低いほどマイナスの補正（0.88 〜 1.08 程度）
  const aptMod = 0.88 + (aptValue / 100) * 0.20;

  // コンディション補正（既存 conditionList の statMod 相当。呼び出し側から渡す）
  const condMod = raceContext.conditionStatMod ?? 1.0;

  // 馬場状態による脚質補正と、その日のポテンシャル上下
  const cond = TRACK_CONDITIONS[raceContext.trackCondition] || TRACK_CONDITIONS.good;
  const trackMod = cond.styleMod[strategy] || 1.0;
  const dayMod = raceContext.dayPotentialMod ?? 1.0;

  // spurt は根性から算出する
  // 序盤の馬は根性が低く、そのままだと直線で全く伸びずダラダラした
  // レースになってしまうため、下限(0.35)を設けて最低限の脚は使えるようにする
  const spurtRatio = Math.max(0.35, clamp(owned.guts / 100, 0, 1));
  const spurt = STAT_RANGE.spurt.min + spurtRatio * (STAT_RANGE.spurt.max - STAT_RANGE.spurt.min) * trackMod * dayMod;

  // 距離適性：Phase1は簡易に「現在の出走距離を中心とした帯」を返す
  const dist = raceContext.distance || 1400;

  return {
    name: owned.name,
    skillName: resolveSkillName(owned),
    type: strategy,
    baseWinRate: 0.05,   // prepareRaceData 側で正規化されるため暫定値
    speedBase:  clamp(owned.speedBase  * aptMod * condMod * trackMod * dayMod, STAT_RANGE.speedBase.min * 0.85, STAT_RANGE.speedBase.max * 1.12),
    maxStamina: clamp(owned.maxStamina * aptMod * condMod * trackMod * dayMod, STAT_RANGE.maxStamina.min * 0.85, STAT_RANGE.maxStamina.max * 1.12),
    spurt: spurt * aptMod,
    coat: owned.coat,
    courseType: strategy === 'nige' ? 'in' : strategy === 'oikomi' ? 'out' : 'normal',
    surf: 'dirt',                    // 園田はダート専用
    distMin: dist - 400,
    distMax: dist + 400,
    accelType: owned.temperament >= 55 ? 'sharp' : 'smooth',
    isPlayerHorse: true,             // UI側のハイライト用フラグ
  };
}

/** 最も適性の高い脚質キーを返す */
function bestAptitudeKey(owned) {
  return Object.entries(owned.aptitude).sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * 育成ステータスに応じてスキル名を自動解放する（Phase1は自動割当方式）。
 * 既存エンジンのスキル名をそのまま使う。
 */
function resolveSkillName(owned) {
  const speedDisp = toDisplayScale(owned.speedBase, 'speedBase');
  const staminaDisp = toDisplayScale(owned.maxStamina, 'maxStamina');
  if (owned.guts >= 75)      return '飛ぶような末脚';
  if (speedDisp >= 70)       return '驚異のスピード';
  if (staminaDisp >= 70)     return '無尽蔵のスタミナ';
  return '闘志の走り';       // 既存エンジンの汎用スキル
}

// ============================================================
// 7. 出走枠（waku）の一般化
// ============================================================

/**
 * n頭立てのときの、各馬の枠インデックス(0〜7)の配列を返す。
 * 余りは外枠(8枠側)から順に1頭ずつ多く割り当てる（JRA/NAR方式）。
 * n=18 のとき、既存エンジンの決め打ちロジックと完全に一致することを検証済み。
 */
function assignWakuIndices(n) {
  const base = Math.floor(n / 8);
  const remainder = n % 8;
  const counts = Array(8).fill(base);
  for (let i = 0; i < remainder; i++) counts[7 - i] += 1;
  const wakuIndices = [];
  counts.forEach((count, wakuIdx) => {
    for (let i = 0; i < count; i++) wakuIndices.push(wakuIdx);
  });
  return wakuIndices;
}

// ============================================================
// 8. レース開催スケジュール
// ============================================================

/** 週番号を「1年52週」の中の週(1〜52)に変換する */
function weekOfYear(turn) {
  return ((turn - 1) % WEEKS_PER_YEAR) + 1;
}

/** その週に開催される重賞レースを返す（無ければnull） */
function getGradedRaceAt(turn) {
  const woy = weekOfYear(turn);
  const list = GRADED_RACES.filter(r => r.week === woy);
  if (list.length === 0) return null;
  // 同じ週に複数ある場合は賞金の高い方を採用
  return list.sort((a, b) => b.prize1st - a.prize1st)[0];
}

/**
 * その週に出走できるレースを返す。
 * 条件戦（C3〜A1）は毎週開催。重賞は実際のカレンダー通りの週にのみ開催され、
 * A1・A2クラスの馬だけが出走できる。重賞に牝馬限定・年齢限定が付いている場合、
 * 出走馬(horse)がその条件を満たさなければ通常の条件戦にフォールバックする。
 * @param {number} turn
 * @param {string} horseClass
 * @param {object} [horse] - OwnedHorse。省略時は条件チェックをスキップする
 * @returns {object} { classKey, label, fieldSize, prize1st, distance, isGraded, name }
 */
function getAvailableRace(turn, horseClass, horse) {
  const cls = RACE_CLASSES[horseClass];
  if (!cls) return null;

  // A2以上の馬は、重賞開催週なら重賞に出走できる（牝馬限定・年齢限定は要適合）
  const graded = getGradedRaceAt(turn);
  const eligible = !graded ? false
    : (!graded.sexRestriction || !horse || horse.sex === graded.sexRestriction)
      && (!graded.ageRestriction || !horse || horse.age === graded.ageRestriction);
  if (graded && eligible && cls.order >= RACE_CLASSES.A2.order) {
    return {
      classKey: horseClass, label: '重賞', name: graded.name,
      fieldSize: 16, prize1st: graded.prize1st,
      distance: graded.distance, isGraded: true,
      sexRestriction: graded.sexRestriction || null,
      ageRestriction: graded.ageRestriction || null,
    };
  }

  // 条件戦は毎週開催
  return {
    classKey: horseClass, label: cls.label, name: '園田' + cls.label + '戦',
    fieldSize: cls.fieldSize, prize1st: cls.prize1st,
    distance: 1400, isGraded: false,
  };
}

/** 次の重賞レースまでの週数と、その重賞情報を返す */
function nextGradedRace(turn) {
  for (let i = 1; i <= WEEKS_PER_YEAR; i++) {
    const g = getGradedRaceAt(turn + i);
    if (g) return { weeksAway: i, race: g };
  }
  return null;
}

/** 昇級判定：現在のクラスで1勝すると次のクラスへ上がる
 *  （実際の地方競馬の条件戦も、勝てば上のクラスへ進む仕組みに近い）
 */
function tryPromote(owned) {
  const idx = CLASS_ORDER.indexOf(owned.currentClass);
  if (idx < 0 || idx >= CLASS_ORDER.length - 1) return null;
  // 現在のクラスに上がってから勝った数を見る
  if ((owned.winsInCurrentClass || 0) >= 1) {
    owned.currentClass = CLASS_ORDER[idx + 1];
    owned.winsInCurrentClass = 0;   // 新クラスでの勝利数をリセット
    return owned.currentClass;
  }
  return null;
}

// ============================================================
// 8a. 馬場状態
// ============================================================

/** 馬場状態ごとの脚質補正。良馬場は中立、荒れるほど前(逃げ・先行)が有利、
 *  差し・追込は届きにくくなる（実際の馬場傾向を簡略化したもの） */
const TRACK_CONDITIONS = {
  good:     { key:'good',     label:'良',   styleMod:{ nige:1.00, senko:1.00, sashi:1.00, oikomi:1.00 } },
  yielding: { key:'yielding', label:'稍重', styleMod:{ nige:1.02, senko:1.01, sashi:0.99, oikomi:0.98 } },
  heavy:    { key:'heavy',    label:'重',   styleMod:{ nige:1.05, senko:1.03, sashi:0.96, oikomi:0.93 } },
  poor:     { key:'poor',     label:'不良', styleMod:{ nige:1.08, senko:1.05, sashi:0.93, oikomi:0.88 } },
};
const TRACK_CONDITION_ORDER = ['good','yielding','heavy','poor'];

/** 馬場状態を抽選する（良馬場が最も出やすい） */
function rollTrackCondition() {
  const r = Math.random();
  if (r < 0.55) return 'good';
  if (r < 0.80) return 'yielding';
  if (r < 0.94) return 'heavy';
  return 'poor';
}

/** その日の「ポテンシャルの上下」を抽選する。
 *  能力値そのものは変えず、レース当日だけの一時的な補正として使う。
 *  普通の日が多く、稀に絶好調/絶不調が出る。 */
function rollDayPotential() {
  const r = Math.random();
  if (r < 0.10) return { key:'great', label:'絶好調', mod:1.05 };
  if (r < 0.25) return { key:'good',  label:'好調',   mod:1.02 };
  if (r < 0.85) return { key:'normal',label:'普通',   mod:1.00 };
  if (r < 0.95) return { key:'bad',   label:'不調',   mod:0.98 };
  return           { key:'worst', label:'絶不調', mod:0.95 };
}



/** 競走馬名の構成パーツ。実際の馬名によくある組み合わせから作る */
const NAME_PREFIX = ['サン','メイ','ナイス','キング','ゴールド','シルバー','ヒカル','タイセイ','エース',
  'ダイワ','マル','トウカイ','ミラクル','ロード','スーパー','ビッグ','ヤマ','コスモ','セイウン','エイシン',
  'ホク','リョウ','シゲル','タガノ','ニシノ','キタノ','マイネル','スマート','グラン','ハヤブサ'];
const NAME_BODY = ['ブレイブ','スター','ウィナー','キセキ','ホープ','クイーン','プリンス','ライト','ソウル',
  'ロマン','パワー','ドリーム','フラッシュ','アロー','ジェット','ウェーブ','クラウン','ブレス','ノヴァ',
  'テイオー','マーチ','ダンサー','ランナー','ホーマ','ボーイ','ガール','シチー','タイム','ハート','リバー'];
const NAME_SUFFIX = ['', '', '', 'オー','ゴー','マル','ミノル','チャン','キング','クイーン','エース'];

/** 競走馬らしい名前をランダムに生成する（カタカナ9文字以内に収める） */
function generateHorseName(used = new Set()) {
  for (let i = 0; i < 60; i++) {
    const n = randomPick(NAME_PREFIX) + randomPick(NAME_BODY) + randomPick(NAME_SUFFIX);
    if (n.length <= 9 && !used.has(n)) { used.add(n); return n; }
  }
  return 'ウマ' + Math.floor(Math.random() * 9999);
}

/** クラスごとの能力レンジ（内部値）。クラスが上がるほど強くなる */
function classStrength(classKey) {
  const idx = Math.max(0, CLASS_ORDER.indexOf(classKey));
  const t = idx / (CLASS_ORDER.length - 1);   // 0(C3) 〜 1(A1)
  return {
    speedMin: 1.26 + t * 0.055,
    speedMax: 1.29 + t * 0.060,
    stamMin:  132 + t * 20,
    stamMax:  145 + t * 20,
    spurtMin: 1.05 + t * 0.18,
    spurtMax: 1.18 + t * 0.20,
  };
}

/**
 * 指定クラスのNPC（ライバル馬）を1頭生成する。
 * @param {string} classKey - C3〜A1
 * @param {object} opts - { used:Set, isRival:boolean, name:string, isGradedRunner:boolean }
 */
function createNpcHorse(classKey, opts = {}) {
  // 重賞の出走馬は、プレイヤーのクラスに関わらず最上位(A1)相当の能力にする
  const baseClass = opts.isGradedRunner ? 'A1' : classKey;
  const s = classStrength(baseClass);
  const used = opts.used || new Set();
  const rnd = (a, b) => a + Math.random() * (b - a);
  // 牝馬限定戦なら、NPCも全頭牝馬にする（実際のレースの見た目に合わせる）
  const sex = opts.sexRestriction === 'female' ? 'female' : (Math.random() < 0.5 ? 'male' : 'female');

  // 格上の強敵は一段上、重賞馬はさらに上の能力を持つ
  const boost = opts.isGradedRunner ? 1.02 : (opts.isRival ? 1.035 : 1.0);
  const types = ['nige','senko','sashi','oikomi'];
  const type = randomPick(types);

  // その日のポテンシャル上下（NPCにもランダムに乗せることで、格付け通りに
  // 決まらない波乱の余地を作る）と、馬場状態による脚質補正を反映する
  const dayPotential = rollDayPotential();
  const cond = TRACK_CONDITIONS[opts.trackCondition] || TRACK_CONDITIONS.good;
  const trackMod = cond.styleMod[type] || 1.0;
  const totalMod = dayPotential.mod * trackMod;

  return {
    name: opts.name || generateHorseName(used),
    skillName: (opts.isRival || opts.isGradedRunner) ? '飛ぶような末脚' : '闘志の走り',
    type,
    baseWinRate: opts.isGradedRunner ? 0.10 : (opts.isRival ? 0.12 : 0.05),
    speedBase:  clamp(rnd(s.speedMin, s.speedMax) * boost * totalMod, STAT_RANGE.speedBase.min * 0.85, STAT_RANGE.speedBase.max * 1.12),
    maxStamina: clamp(rnd(s.stamMin, s.stamMax) * boost * totalMod, STAT_RANGE.maxStamina.min * 0.85, STAT_RANGE.maxStamina.max * 1.12),
    spurt:      clamp(rnd(s.spurtMin, s.spurtMax) * boost * totalMod, STAT_RANGE.spurt.min * 0.85, STAT_RANGE.spurt.max * 1.12),
    coat: randomPick(COAT_KEYS),
    courseType: 'normal',
    surf: 'dirt',
    distMin: 800, distMax: 2400,
    accelType: Math.random() < 0.5 ? 'smooth' : 'sharp',
    isRival: !!opts.isRival,
    isGradedRunner: !!opts.isGradedRunner,
    sex,
  };
}

/**
 * レースの出走メンバー（プレイヤー馬を除くNPC）を作る。
 * ・重賞：実在の園田の名馬が出走してくる（クラス最上位の能力＋補正）
 * ・条件戦：自動生成した馬。5レースに1回、格上の強敵が1頭混ざる
 * @param {string} classKey
 * @param {number} count - 必要なNPC頭数
 * @param {object} opts - { raceCount:number, realNames:string[], isGraded:boolean }
 */
function generateRaceField(classKey, count, opts = {}) {
  const used = new Set();
  const field = [];
  const isGraded = !!opts.isGraded;
  const realNames = (opts.realNames || []).slice();

  // 5レースに1回、格上の強敵を1頭入れる（重賞では全馬が強豪なので入れない）
  const raceCount = opts.raceCount || 0;
  const hasRival = !isGraded && raceCount > 0 && raceCount % 5 === 0;

  for (let i = 0; i < count; i++) {
    const isRival = hasRival && i === 0;
    let name = null;

    // 重賞は実在の名馬を優先的に使う
    if (isGraded && realNames.length > 0) {
      name = realNames.splice(Math.floor(Math.random() * realNames.length), 1)[0];
      used.add(name);
    }

    field.push(createNpcHorse(classKey, {
      used, isRival, name,
      // 重賞の出走馬は最上位クラス相当の能力にし、さらに底上げする
      isGradedRunner: isGraded,
      trackCondition: opts.trackCondition || 'good',
      sexRestriction: opts.sexRestriction || null,
    }));
  }
  return field.sort(() => Math.random() - 0.5);
}

// ============================================================
// 9b. 馬券
// ============================================================

/** 馬券の種類 */
const BET_TYPES = {
  WIN:   { key:'WIN',   label:'単勝', desc:'1着を当てる' },
  PLACE: { key:'PLACE', label:'複勝', desc:'3着以内に入れば的中' },
};

/** 購入できる金額の単位 */
const BET_UNITS = [100, 500, 1000, 5000, 10000];

/**
 * 出走各馬のオッズを算出する。
 * 能力（speedBase/maxStamina/spurt）から勝率を見積もり、控除率を引いてオッズにする。
 * @param {object[]} field - 出走馬の配列（プレイヤー馬含む）
 * @returns {object[]} 各馬に winRate / oddsWin / oddsPlace を付けた配列
 */
function calcOdds(field) {
  // 能力を総合スコア化
  const scores = field.map(h => {
    const sp = (h.speedBase - 1.2) * 100;      // 概ね 6〜16
    const st = (h.maxStamina - 120) / 10;      // 概ね 1.2〜4.5
    const spu = (h.spurt - 1.0) * 10;          // 概ね 0.5〜4
    return Math.max(0.5, sp * 1.6 + st * 1.2 + spu * 1.0);
  });
  // スコアを強調して勝率差をつける
  const weights = scores.map(s => Math.pow(s, 3.2));
  const total = weights.reduce((a, b) => a + b, 0);

  const TAKEOUT_WIN = 0.20;    // 単勝の控除率（実際の競馬と同程度）
  const TAKEOUT_PLACE = 0.20;

  return field.map((h, i) => {
    const winRate = weights[i] / total;
    // 複勝率は勝率から概算（3着以内に入る確率）
    const placeRate = Math.min(0.95, winRate * 2.6);
    return Object.assign({}, h, {
      winRate,
      oddsWin:   Math.max(1.1, Math.round((1 - TAKEOUT_WIN) / winRate * 10) / 10),
      oddsPlace: Math.max(1.0, Math.round((1 - TAKEOUT_PLACE) / placeRate * 10) / 10),
    });
  });
}

/**
 * 馬券の払戻を計算する。
 * @param {object} bet - { type, horseNum, amount, odds }
 * @param {number} resultRank - その馬の着順
 * @returns {object} { hit:boolean, payout:number }
 */
function calcPayout(bet, resultRank) {
  if (!bet || !bet.amount) return { hit: false, payout: 0 };
  let hit = false;
  if (bet.type === 'WIN')   hit = (resultRank === 1);
  if (bet.type === 'PLACE') hit = (resultRank <= 3);
  return {
    hit,
    payout: hit ? Math.floor(bet.amount * bet.odds) : 0,
  };
}

// ============================================================
// 10. 賞金計算
// ============================================================

/** 着順(1始まり)から賞金額を返す。
 *  第2引数はクラスキー、または prize1st を持つレース情報オブジェクトを渡せる。
 *  （重賞はクラスではなくレースごとに賞金が異なるため）
 */
function calcPrize(rank, classKeyOrRace) {
  const rate = PRIZE_RATE_BY_RANK[rank - 1];
  if (rate === undefined) return 0;
  let base;
  if (typeof classKeyOrRace === 'object' && classKeyOrRace !== null) {
    base = classKeyOrRace.prize1st;
  } else {
    const cls = RACE_CLASSES[classKeyOrRace];
    if (!cls) return 0;
    base = cls.prize1st;
  }
  if (!base) return 0;
  return Math.round(base * rate);
}

/** レース結果を所有馬に反映する */
function applyRaceResult(state, owned, rank, classKey, raceInfo = {}) {
  // raceInfo に prize1st があれば（重賞など）それを優先して賞金を計算する
  const prize = raceInfo && raceInfo.prize1st
    ? calcPrize(rank, raceInfo)
    : calcPrize(rank, classKey);
  state.funds += prize;
  owned.totalRaces += 1;
  owned.totalPrize += prize;
  if (rank === 1) {
    owned.totalWins += 1;
    owned.winsInCurrentClass = (owned.winsInCurrentClass || 0) + 1;
  }

  owned.raceHistory.push({
    turn: state.currentTurn,
    raceName: raceInfo.raceName || '',
    classKey,
    distance: raceInfo.distance || 0,
    rank,
    prize,
  });

  // 好走した馬はわずかに成長する（実戦経験ボーナス）
  // ※調教による成長を補う程度の小さい値にとどめる。ここが大きすぎると
  //   「レースに出るだけで育つ」ことになり、調教の選択が意味を失うため。
  if (rank <= 3) {
    const bonus = (4 - rank) * 0.00012;
    owned.speedBase = clamp(owned.speedBase + bonus, STAT_RANGE.speedBase.min, STAT_RANGE.speedBase.max);
  }

  return { prize };
}

// ============================================================
// 10. ゲーム状態の生成とセーブ／ロード
// ============================================================

const SAVE_KEY = 'urban_keiba_career_v10';

/** 新規ゲーム状態を作る */
function createNewGameState(horseName) {
  const horse = createOwnedHorse({ name: horseName, birthTurn: 0 });
  return {
    version: 10,
    funds: ECONOMY.initialFunds,
    currentTurn: 0,
    horse,
    retiredHorses: [],   // 引退馬の記録（Phase2で繁殖に使う）
  };
}

function saveGame(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.error('セーブに失敗しました:', e);
    return false;
  }
}

function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.error('ロードに失敗しました:', e);
    return null;
  }
}

function hasSaveData() {
  return !!localStorage.getItem(SAVE_KEY);
}

// ============================================================
// エクスポート（ブラウザ / Node どちらでも使えるように）
// ============================================================
const CareerMode = {
  // 定数
  WEEKS_PER_YEAR, CAREER_TOTAL_WEEKS, STAT_RANGE, RACE_CLASSES,
  ECONOMY, ACTION, FATIGUE, COAT_KEYS,
  // 変換・表示
  toDisplayScale, fromDisplayScale,
  // 所有馬
  createOwnedHorse, careerProgress,
  // 週サイクル
  applyTraining, applyRest, advanceWeek, rollCondition, getConditionWeights,
  // 引退
  checkRetirement, retireByChoice, breedOffspring, inheritRate, buildPedigreeChain,
  TRACK_CONDITIONS, TRACK_CONDITION_ORDER, rollTrackCondition, rollDayPotential,
  // レース連携
  ownedHorseToRaceHorse, bestAptitudeKey, resolveSkillName, assignWakuIndices,
  calcPrize, applyRaceResult,
  // レース開催スケジュール
  getAvailableRace, getGradedRaceAt, nextGradedRace, weekOfYear,
  GRADED_RACES, CLASS_ORDER, tryPromote, PRIZE_RATE_BY_RANK,
  // NPC生成
  generateHorseName, createNpcHorse, generateRaceField, classStrength,
  // 馬券
  BET_TYPES, BET_UNITS, calcOdds, calcPayout,
  // セーブ
  createNewGameState, saveGame, loadGame, hasSaveData, SAVE_KEY,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CareerMode;
}
if (typeof window !== 'undefined') {
  window.CareerMode = CareerMode;
}
