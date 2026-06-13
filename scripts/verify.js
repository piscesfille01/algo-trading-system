#!/usr/bin/env node
/**
 * Verify recommendation results
 * Usage: node scripts/verify.js 2026-01-12
 *
 * Evaluation criteria:
 *  - Target hit within 20 trading days → ✅ Win
 *  - Stop loss hit within 20 trading days → ❌ Loss
 *  - Neither hit within 20 days → ✅ if close > buy, ❌ otherwise
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const date = process.argv[2];
if (!date) { console.error('사용법: node scripts/verify.js 2026-01-12'); process.exit(1); }

const CACHE_DIR    = path.resolve('output/cache');
const PENDING_PATH = path.join(__dirname, '../output/picks-pending.json');
const HOLD_DAYS    = 20;

function getResult(p, date) {
  const cacheFile = path.join(CACHE_DIR, `yh_${p.symbol}.json`);
  if (!fs.existsSync(cacheFile)) return null;
  const rows   = JSON.parse(fs.readFileSync(cacheFile));
  const future = rows.filter(r => r.date > date).slice(0, HOLD_DAYS);
  if (!future.length) return null;

  for (const row of future) {
    if (row.high >= p.targetPrice) return { result: '✅ 수익', hitDay: row.date, pnl: +((p.targetPrice - p.buyPrice) / p.buyPrice * 100).toFixed(1) };
    if (row.low  <= p.stopLoss)   return { result: '❌ 손절', hitDay: row.date, pnl: +((p.stopLoss  - p.buyPrice) / p.buyPrice * 100).toFixed(1) };
  }

  // 20일 내 미달 → 종가로 판정
  const endRow = future.at(-1);
  const endPnl = +((endRow.close - p.buyPrice) / p.buyPrice * 100).toFixed(1);
  const result = endPnl >= 0 ? '✅ 수익(만기)' : '❌ 손실(만기)';
  return { result, hitDay: endRow.date, pnl: endPnl };
}

const pending = fs.existsSync(PENDING_PATH) ? JSON.parse(fs.readFileSync(PENDING_PATH)) : [];
const picks   = pending.filter(p => p.analysisDate === date);

if (!picks.length) {
  console.log(`\n⚠️  ${date} 날짜 추천 기록 없음 — 먼저 node scripts/run.js ${date} 실행하세요\n`);
  process.exit(0);
}

console.log(`\n📊 ${date} 추천 결과 검증 (최대 ${HOLD_DAYS}영업일)\n`);
console.log('종목'.padEnd(7) + '매수가'.padEnd(10) + '목표가'.padEnd(10) + '손절가'.padEnd(10) + '결과'.padEnd(16) + '날짜'.padEnd(13) + '손익');
console.log('─'.repeat(78));

let wins = 0, losses = 0, noData = 0;

for (const p of picks) {
  const r = getResult(p, date);
  if (!r) { console.log(`${p.symbol.padEnd(7)} ⏳ 데이터 없음`); noData++; continue; }
  const isWin = r.result.startsWith('✅');
  if (isWin) wins++; else losses++;
  console.log(
    p.symbol.padEnd(7) +
    `$${p.buyPrice}`.padEnd(10) +
    `$${p.targetPrice}`.padEnd(10) +
    `$${p.stopLoss}`.padEnd(10) +
    r.result.padEnd(16) +
    r.hitDay.padEnd(13) +
    `${r.pnl >= 0 ? '+' : ''}${r.pnl}%`
  );
}

const total = wins + losses;
console.log('─'.repeat(78));
console.log(`\n총 ${picks.length}종목 | ✅ ${wins}  ❌ ${losses}  ⏳ ${noData} | 승률 ${total ? Math.round(wins/total*100) + '%' : 'N/A'}\n`);
