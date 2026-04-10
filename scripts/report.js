#!/usr/bin/env node
/**
 * 기간별 종합 분석 & 개선 우선순위
 * 실행: node scripts/report.js [start] [end]
 * 예시: node scripts/report.js 2024-09-03 2024-09-27
 *       node scripts/report.js          ← 전체 기간
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const SUMMARY_PATH = path.join(__dirname, '../output/summary.json');
const bar = '━'.repeat(64);

if (!fs.existsSync(SUMMARY_PATH)) {
  console.log('\n⚠️  summary.json 없음. 먼저 evolve.js를 날짜별로 실행하세요.\n');
  process.exit(0);
}

const startArg = process.argv[2] ?? null;
const endArg   = process.argv[3] ?? null;

const all = JSON.parse(fs.readFileSync(SUMMARY_PATH)).dates ?? [];
const dates = all.filter(d =>
  (!startArg || d.date >= startArg) &&
  (!endArg   || d.date <= endArg)
);

if (!dates.length) {
  console.log(`\n⚠️  해당 기간 데이터 없음 (${startArg} ~ ${endArg})\n`);
  process.exit(0);
}

// ── 집계 ──────────────────────────────────────────────────────────────
const totalPicks  = dates.reduce((s, d) => s + d.picks,  0);
const totalWins   = dates.reduce((s, d) => s + d.wins,   0);
const totalLosses = dates.reduce((s, d) => s + d.losses, 0);
const totalOpens  = dates.reduce((s, d) => s + d.opens,  0);
const winRate     = totalWins + totalLosses > 0
  ? Math.round(totalWins / (totalWins + totalLosses) * 100) : null;

// 날짜 기준 승률 (수익 난 날 / 결과 있는 날)
const resolvedDates = dates.filter(d => d.wins + d.losses > 0);
const winDays  = resolvedDates.filter(d => d.wins > d.losses).length;
const lossDays = resolvedDates.filter(d => d.wins <= d.losses).length;
const dayWinRate = resolvedDates.length > 0
  ? Math.round(winDays / resolvedDates.length * 100) : null;

// 이슈 빈도 집계
const issueTotals = { market: 0, bounce: 0, momentum: 0, signal: 0 };
for (const d of dates) {
  issueTotals.market   += d.issues?.market   ?? 0;
  issueTotals.bounce   += d.issues?.bounce   ?? 0;
  issueTotals.momentum += d.issues?.momentum ?? 0;
  issueTotals.signal   += d.issues?.signal   ?? 0;
}

// 손절 원인 세부 집계
const causeCounts = {
  spyFell: 0, spy10dDown: 0, rsiFalling: 0,
  bearishCandle: 0, notRecovering: 0, lowVolume: 0, recentDump: 0,
};
const allLosses = dates.flatMap(d => d.lossDetails ?? []);
for (const l of allLosses) {
  for (const [k, v] of Object.entries(l.causes ?? {})) {
    if (v && k in causeCounts) causeCounts[k]++;
  }
}

// 수익 종목 공통 신호
const allWins = dates.flatMap(d => d.winDetails ?? []);
const winSignalCounts = {};
for (const w of allWins) {
  for (const pt of w.patterns ?? []) {
    const key = pt.includes('세력 매집') ? '세력 매집 패턴'
              : pt.includes('Higher Low ×3') ? 'Higher Low ×3'
              : pt.includes('Higher Low ×2') ? 'Higher Low ×2'
              : pt.includes('MACD') ? 'MACD 상승 전환'
              : pt.includes('깊은 눌림') ? '깊은 눌림'
              : null;
    if (key) winSignalCounts[key] = (winSignalCounts[key] ?? 0) + 1;
  }
}

// ── 출력 ──────────────────────────────────────────────────────────────
const period = startArg ? `${startArg} ~ ${endArg ?? dates.at(-1).date}` : '전체 기간';
console.log(`\n${bar}`);
console.log(`📊 종합 리포트 (${period})`);
console.log(bar);
console.log(`  분석 날짜: ${dates.length}일  |  총 픽: ${totalPicks}건`);
console.log(`  ✅ 수익 ${totalWins}  ❌ 손절 ${totalLosses}  ⏳ 미결 ${totalOpens}`);
console.log(`  종목별 승률: ${winRate !== null ? winRate + '%' : 'N/A'}  (${totalWins}승/${totalWins+totalLosses}건)`);
console.log(`  날짜별 승률: ${dayWinRate !== null ? dayWinRate + '%' : 'N/A'}  (${winDays}일 수익/${resolvedDates.length}일)`);

// 날짜별 요약
console.log(`\n${bar}`);
console.log('날짜별 승률');
console.log(bar);
console.log('날짜'.padEnd(13) + '픽'.padEnd(4) + '승'.padEnd(4) + '패'.padEnd(4) + '승률');
console.log('─'.repeat(40));
for (const d of dates) {
  const r = d.wins + d.losses > 0 ? Math.round(d.wins / (d.wins + d.losses) * 100) + '%' : '-';
  const icon = d.wins + d.losses === 0 ? '⏳' : d.wins / (d.wins + d.losses) >= 0.6 ? '✅' : '❌';
  console.log(`${d.date.padEnd(13)}${String(d.picks).padEnd(4)}${String(d.wins).padEnd(4)}${String(d.losses).padEnd(4)}${icon} ${r}`);
}

// 손절 원인 순위
console.log(`\n${bar}`);
console.log('손절 원인 TOP (전체 손절 대비 비율)');
console.log(bar);
const causeLabels = {
  spyFell:       'SPY 진입 후 하락',
  spy10dDown:    'SPY 10일 추세 하락',
  rsiFalling:    'RSI 하락 중 (모멘텀 약화)',
  bearishCandle: '진입일 음봉',
  notRecovering: '2일 연속 반등 미확인',
  lowVolume:     '거래량 부족',
  recentDump:    '최근 급락 종목 (낙하하는 칼)',
};
const n = totalLosses || 1;
Object.entries(causeCounts)
  .sort((a, b) => b[1] - a[1])
  .filter(([, v]) => v > 0)
  .forEach(([k, v]) => {
    const pct = Math.round(v / n * 100);
    const bar2 = '█'.repeat(Math.round(pct / 5));
    console.log(`  ${causeLabels[k].padEnd(24)} ${String(v).padStart(2)}건 (${String(pct).padStart(3)}%)  ${bar2}`);
  });

// 수익 종목 공통 신호
if (allWins.length) {
  console.log(`\n${bar}`);
  console.log('수익 종목 공통 신호 (유효한 신호)');
  console.log(bar);
  Object.entries(winSignalCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => {
      const pct = Math.round(v / totalWins * 100);
      console.log(`  ${k.padEnd(24)} ${v}건 / ${totalWins}건 수익 (${pct}%)`);
    });
}

// ── 개선 우선순위 & Claude Code 프롬프트 ─────────────────────────────
console.log(`\n${bar}`);
console.log('🔧 개선 우선순위 & Claude Code 프롬프트');
console.log(bar);

const sorted = Object.entries(issueTotals).sort((a, b) => b[1] - a[1]).filter(([, v]) => v > 0);

if (!sorted.length) {
  console.log('\n  손절 없음 — 알고리즘 수정 불필요.\n');
  process.exit(0);
}

const issueDesc = {
  market:   { rank: null, title: '시장 하락 시 손절', prompt: `손절 ${issueTotals.market}건이 SPY 단기 하락과 겹쳤어.
현재 pick.js는 SPY 50MA 필터만 있고 진입 당일 SPY 단기 방향 확인이 없어.
SPY 5일 평균 아래인 날 진입 차단하는 로직 추가를 고려해줘.
위치: pick.js analyzeSymbol() 시장 필터 섹션.` },
  bounce:   { rank: null, title: '반등 확인 부족', prompt: `손절 ${issueTotals.bounce}건이 반등 1일만 확인된 상태에서 진입했어.
현재 조건 4는 "3일 전보다 오늘 종가 높음" — 1일 반등도 통과돼.
2일 연속 종가 상승으로 강화하되, 픽 수 감소를 감안해서 다른 조건과 균형 맞춰줘.
위치: pick.js analyzeSymbol() 핵심 조건 4.` },
  momentum: { rank: null, title: 'RSI 하락 중 진입', prompt: `손절 ${issueTotals.momentum}건이 RSI가 이미 하락 방향인 상태에서 진입했어.
현재 pick.js는 RSI 범위(35~62)만 보고 방향은 안 봐.
RSI가 2일 전보다 높아지는 중인 것을 필터 또는 스코어 조건으로 추가 고려.
위치: pick.js analyzeSymbol() 핵심 조건 2 or 스코어링 섹션.` },
  signal:   { rank: null, title: '신호 약한 종목 진입', prompt: `손절 ${issueTotals.signal}건이 세력 매집/Higher Low 같은 강한 신호 없이 기본 점수만으로 통과됐어.
현재 최소 점수 5점 기준이 너무 낮거나, 강한 신호 1개 이상 필수 조건이 없어.
최소 점수 상향 또는 강한 신호 1개 이상 필수화를 고려해줘.
위치: pick.js analyzeSymbol() score < 5 조건.` },
};

sorted.forEach(([key, count], i) => {
  const d = issueDesc[key];
  console.log(`
━━ [${i+1}순위: ${d.title}] ${count}건 손절 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${d.prompt}`);
});

console.log(`\n${bar}\n`);
