#!/usr/bin/env node
/**
 * 백테스트 케이스 추가
 *
 * 사용법:
 * node scripts/backtest-add.js 2026-03-19 NVDA entered 118.50 124.00 115.00 hit 123.80
 * node scripts/backtest-add.js 2026-03-19 AMD passed "score too low"
 * node scripts/backtest-add.js 2026-03-19 TSLA entered 180.00 190.00 175.00 stop 174.50
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKTEST_PATH = path.join(__dirname, '../output/backtest-results.json');
const STATS_PATH = path.join(__dirname, '../output/backtest-stats.json');

// 커맨드라인 파싱
const [, , date, symbol, action, ...args] = process.argv;

if (!date || !symbol || !action) {
  console.log(`
사용법:

1. 진입한 케이스 (목표가 도달):
   node scripts/backtest-add.js 2026-03-19 NVDA entered 118.50 124.00 115.00 hit 123.80

2. 진입한 케이스 (손절):
   node scripts/backtest-add.js 2026-03-19 AMD entered 120.00 130.00 115.00 stop 114.50

3. 진입한 케이스 (아직 보유 중):
   node scripts/backtest-add.js 2026-03-19 TSLA entered 180.00 190.00 175.00 holding 185.00

4. 진입 안 한 케이스:
   node scripts/backtest-add.js 2026-03-19 INTC passed "score too low"

파라미터:
  date      추천 날짜 (YYYY-MM-DD)
  symbol    종목
  action    entered | passed

  [entered인 경우]
  buyPrice  진입가
  target    목표가
  stop      손절가
  result    hit | stop | holding
  exitPrice 청산가 (holding이면 현재가)

  [passed인 경우]
  reason    패스 이유 (따옴표로 감싸기)
`);
  process.exit(1);
}

// 기존 데이터 로드
let backtest = [];
if (fs.existsSync(BACKTEST_PATH)) {
  backtest = JSON.parse(fs.readFileSync(BACKTEST_PATH, 'utf-8'));
}

// 새 케이스 추가
const newCase = {
  id: `${date}_${symbol}_${Date.now()}`,
  date,
  symbol,
  action,
  addedAt: new Date().toISOString(),
};

if (action === 'entered') {
  const [buyPrice, target, stop, result, exitPrice] = args;

  if (!buyPrice || !target || !stop || !result || !exitPrice) {
    console.error('❌ entered 케이스는 buyPrice, target, stop, result, exitPrice 필요');
    process.exit(1);
  }

  const buy = parseFloat(buyPrice);
  const tgt = parseFloat(target);
  const stp = parseFloat(stop);
  const exit = parseFloat(exitPrice);

  const pnlPct = ((exit - buy) / buy * 100).toFixed(2);
  const success = result === 'hit' || parseFloat(pnlPct) > 2;

  Object.assign(newCase, {
    buyPrice: buy,
    target: tgt,
    stop: stp,
    result,
    exitPrice: exit,
    pnlPct: parseFloat(pnlPct),
    success,
  });

  console.log(`\n✅ 진입 케이스 추가: ${symbol}`);
  console.log(`   진입: $${buy} → 청산: $${exit}`);
  console.log(`   결과: ${result === 'hit' ? '🎯 목표가 도달' : result === 'stop' ? '🛑 손절' : '⏳ 보유 중'}`);
  console.log(`   수익: ${pnlPct > 0 ? '+' : ''}${pnlPct}%`);

} else if (action === 'passed') {
  const reason = args.join(' ').replace(/"/g, '');

  Object.assign(newCase, {
    reason,
  });

  console.log(`\n⏭️  패스 케이스 추가: ${symbol}`);
  console.log(`   이유: ${reason}`);

} else {
  console.error('❌ action은 entered 또는 passed만 가능');
  process.exit(1);
}

// 저장
backtest.push(newCase);
fs.writeFileSync(BACKTEST_PATH, JSON.stringify(backtest, null, 2));

// 통계 업데이트
updateStats(backtest);

console.log(`\n📊 현재 백테스트: ${backtest.length}건`);

// ────────────────────────────────────────────────────────────
// 통계 계산
// ────────────────────────────────────────────────────────────
function updateStats(backtest) {
  const entered = backtest.filter(c => c.action === 'entered');
  const closed = entered.filter(c => c.result !== 'holding');
  const wins = closed.filter(c => c.success);
  const losses = closed.filter(c => !c.success);

  const winRate = closed.length > 0
    ? Math.round(wins.length / closed.length * 100)
    : null;

  const avgWin = wins.length > 0
    ? (wins.reduce((s, c) => s + c.pnlPct, 0) / wins.length).toFixed(2)
    : 0;

  const avgLoss = losses.length > 0
    ? (losses.reduce((s, c) => s + c.pnlPct, 0) / losses.length).toFixed(2)
    : 0;

  const totalPnl = closed.reduce((s, c) => s + c.pnlPct, 0).toFixed(2);

  const stats = {
    totalCases: backtest.length,
    entered: entered.length,
    passed: backtest.filter(c => c.action === 'passed').length,
    closed: closed.length,
    holding: entered.filter(c => c.result === 'holding').length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    avgWin: parseFloat(avgWin),
    avgLoss: parseFloat(avgLoss),
    totalPnl: parseFloat(totalPnl),
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2));

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📈 백테스트 통계`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  전체 케이스: ${stats.totalCases}건 (진입 ${stats.entered} / 패스 ${stats.passed})`);
  console.log(`  결과 확정: ${stats.closed}건 (보유 중 ${stats.holding}건)`);
  console.log(`  승: ${stats.wins}건 / 패: ${stats.losses}건`);

  if (winRate !== null) {
    const icon = winRate >= 70 ? '✅' : winRate >= 60 ? '🟡' : '🔴';
    console.log(`  승률: ${icon} ${winRate}%`);
  }

  console.log(`  평균 수익: ${avgWin > 0 ? '+' : ''}${avgWin}%`);
  console.log(`  평균 손실: ${avgLoss}%`);
  console.log(`  누적 수익: ${totalPnl > 0 ? '+' : ''}${totalPnl}%`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}
