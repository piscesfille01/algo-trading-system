#!/usr/bin/env node
/**
 * Live trading buy records
 * Usage: node scripts/buy.js SMCI PLTR
 *
 * Records actual entries from today's recommendations (via run.js).
 * Entry/target/stop prices are auto-loaded from picks-pending.json.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { toZonedTime } from 'date-fns-tz';
import { format } from 'date-fns';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORTFOLIO_PATH = path.join(__dirname, '../output/real-portfolio.json');
const PENDING_PATH   = path.join(__dirname, '../output/picks-pending.json');
const PT_TZ = 'America/Vancouver';
const today = format(toZonedTime(new Date(), PT_TZ), 'yyyy-MM-dd');

const symbols = process.argv.slice(2).map(s => s.toUpperCase());
if (!symbols.length) {
  console.error('사용법: node scripts/buy.js SMCI PLTR');
  process.exit(1);
}

// 포트폴리오 로드 (없으면 초기화)
const portfolio = fs.existsSync(PORTFOLIO_PATH)
  ? JSON.parse(fs.readFileSync(PORTFOLIO_PATH, 'utf-8'))
  : { balance: 10000, initialBalance: 10000, startDate: today, positions: [], history: [] };

// 오늘 picks 로드
const pending = fs.existsSync(PENDING_PATH)
  ? JSON.parse(fs.readFileSync(PENDING_PATH, 'utf-8'))
  : [];
const todayPicks = pending.filter(p => p.analysisDate === today);

if (!todayPicks.length) {
  console.error(`⚠️  ${today} 추천 기록 없음 — 먼저 node scripts/run.js 실행하세요`);
  process.exit(1);
}

// 종목당 배분: 잔액 20% ÷ 오늘 총 picks 수
const perPickAmt = portfolio.balance * 0.20 / todayPicks.length;
const line = '━'.repeat(50);

console.log(`\n${line}`);
console.log(`📥 매수 기록 (${today})`);
console.log(line);

for (const sym of symbols) {
  const pick = todayPicks.find(p => p.symbol === sym);
  if (!pick) {
    console.log(`⚠️  ${sym}: 오늘 추천 목록에 없음 — 스킵`);
    continue;
  }

  if (portfolio.positions.find(p => p.symbol === sym && p.status === 'open')) {
    console.log(`⚠️  ${sym}: 이미 보유 중 — 스킵`);
    continue;
  }

  const shares = Math.floor(perPickAmt / pick.buyPrice);
  if (shares < 1) {
    console.log(`⚠️  ${sym}: 잔액 부족으로 1주 매수 불가 — 스킵`);
    continue;
  }

  const cost = parseFloat((shares * pick.buyPrice).toFixed(2));
  portfolio.balance = parseFloat((portfolio.balance - cost).toFixed(2));

  portfolio.positions.push({
    id:          `real_${today}_${sym}`,
    symbol:      sym,
    buyDate:     today,
    buyPrice:    pick.buyPrice,
    targetPrice: pick.targetPrice,
    stopLoss:    pick.stopLoss,
    rrRatio:     pick.rrRatio,
    shares,
    cost,
    status:      'open',
    score:       pick.score,
    patterns:    pick.patterns ?? [],
  });

  const tPct = ((pick.targetPrice - pick.buyPrice) / pick.buyPrice * 100).toFixed(1);
  const sPct = ((pick.stopLoss   - pick.buyPrice) / pick.buyPrice * 100).toFixed(1);
  console.log(`\n✅ ${sym} 매수`);
  console.log(`   $${pick.buyPrice} × ${shares}주 = $${cost}`);
  console.log(`   목표 $${pick.targetPrice} (+${tPct}%)  손절 $${pick.stopLoss} (${sPct}%)`);
}

fs.writeFileSync(PORTFOLIO_PATH, JSON.stringify(portfolio, null, 2));
console.log(`\n💰 잔액: $${portfolio.balance.toLocaleString()}`);
console.log(`${line}\n`);
