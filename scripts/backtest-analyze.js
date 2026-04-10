#!/usr/bin/env node
/**
 * 백테스트 분석 및 개선점 자동 발견
 *
 * 사용법:
 * node scripts/backtest-analyze.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKTEST_PATH = path.join(__dirname, '../output/backtest-results.json');
const PICKS_DIR = path.join(__dirname, '../output/backtest-picks');
const INSIGHTS_PATH = path.join(__dirname, '../output/backtest-insights.json');

if (!fs.existsSync(BACKTEST_PATH)) {
  console.log('❌ 백테스트 데이터 없음. 먼저 backtest-add.js로 케이스 추가하세요.');
  process.exit(1);
}

const backtest = JSON.parse(fs.readFileSync(BACKTEST_PATH, 'utf-8'));
const entered = backtest.filter(c => c.action === 'entered' && c.result !== 'holding');

if (entered.length < 5) {
  console.log('⚠️  백테스트 케이스가 너무 적음 (최소 5건 필요)');
  console.log(`   현재: ${entered.length}건`);
  process.exit(0);
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`🔍 백테스트 심층 분석 (${entered.length}건)`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

const insights = {
  generatedAt: new Date().toISOString(),
  totalCases: entered.length,
  findings: [],
  recommendations: [],
};

// ────────────────────────────────────────────────────────────
// 1. 날짜별 픽 데이터와 매칭 (점수, 패턴 등 복원)
// ────────────────────────────────────────────────────────────
const enrichedCases = [];

for (const c of entered) {
  const pickFile = path.join(PICKS_DIR, `${c.date}.json`);
  let pickData = null;

  if (fs.existsSync(pickFile)) {
    const picks = JSON.parse(fs.readFileSync(pickFile, 'utf-8'));
    pickData = picks.find(p => p.symbol === c.symbol);
  }

  enrichedCases.push({
    ...c,
    score: pickData?.score ?? null,
    patterns: pickData?.patterns ?? [],
    rrRatio: pickData?.rrRatio ?? null,
    div: pickData?.div ?? null,
  });
}

// ────────────────────────────────────────────────────────────
// 2. 점수별 승률 분석
// ────────────────────────────────────────────────────────────
console.log(`📊 점수별 승률 분석`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

const scoreRanges = [
  { min: 6, max: 7, label: '6-7점 (최소 진입)' },
  { min: 8, max: 9, label: '8-9점 (양호)' },
  { min: 10, max: 11, label: '10-11점 (우수)' },
  { min: 12, max: 20, label: '12점+ (최고급)' },
];

for (const range of scoreRanges) {
  const cases = enrichedCases.filter(c => c.score >= range.min && c.score <= range.max);
  if (cases.length === 0) continue;

  const wins = cases.filter(c => c.success).length;
  const winRate = Math.round(wins / cases.length * 100);
  const avgPnl = (cases.reduce((s, c) => s + c.pnlPct, 0) / cases.length).toFixed(2);

  const icon = winRate >= 70 ? '✅' : winRate >= 60 ? '🟡' : '🔴';
  console.log(`  ${icon} ${range.label.padEnd(20)}  승률 ${winRate}%  (${wins}/${cases.length})  평균 ${avgPnl > 0 ? '+' : ''}${avgPnl}%`);

  // 인사이트 기록
  if (winRate < 50 && cases.length >= 3) {
    insights.findings.push({
      type: 'low_winrate_by_score',
      scoreRange: range.label,
      winRate,
      sampleSize: cases.length,
      severity: 'high',
      description: `${range.label} 구간 승률이 ${winRate}%로 낮음`,
    });

    insights.recommendations.push({
      issue: `${range.label} 승률 ${winRate}%`,
      recommendation: range.min <= 7
        ? '최소 진입 점수를 8점으로 상향 고려'
        : '해당 점수대 진입 신중, 추가 확인 신호 필요',
      priority: 'high',
    });
  }
}

// ────────────────────────────────────────────────────────────
// 3. R:R 비율별 승률
// ────────────────────────────────────────────────────────────
console.log(`\n📊 R:R 비율별 승률 분석`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

const rrRanges = [
  { min: 1.0, max: 1.4, label: '1.0-1.4x (타이트)' },
  { min: 1.5, max: 1.9, label: '1.5-1.9x (적정)' },
  { min: 2.0, max: 5.0, label: '2.0x+ (여유)' },
];

for (const range of rrRanges) {
  const cases = enrichedCases.filter(c => c.rrRatio >= range.min && c.rrRatio <= range.max);
  if (cases.length === 0) continue;

  const wins = cases.filter(c => c.success).length;
  const winRate = Math.round(wins / cases.length * 100);
  const avgPnl = (cases.reduce((s, c) => s + c.pnlPct, 0) / cases.length).toFixed(2);

  const icon = winRate >= 70 ? '✅' : winRate >= 60 ? '🟡' : '🔴';
  console.log(`  ${icon} ${range.label.padEnd(20)}  승률 ${winRate}%  (${wins}/${cases.length})  평균 ${avgPnl > 0 ? '+' : ''}${avgPnl}%`);
}

// ────────────────────────────────────────────────────────────
// 4. 공통 패턴 분석 (성공 vs 실패)
// ────────────────────────────────────────────────────────────
console.log(`\n📊 패턴 분석 (성공 vs 실패)`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

const wins = enrichedCases.filter(c => c.success);
const losses = enrichedCases.filter(c => !c.success);

const winPatterns = {};
const lossPatterns = {};

for (const w of wins) {
  for (const p of w.patterns || []) {
    const key = extractPatternKey(p);
    if (key) winPatterns[key] = (winPatterns[key] || 0) + 1;
  }
}

for (const l of losses) {
  for (const p of l.patterns || []) {
    const key = extractPatternKey(p);
    if (key) lossPatterns[key] = (lossPatterns[key] || 0) + 1;
  }
}

// 성공 케이스에 많이 나타나는 패턴
console.log(`\n✅ 성공 케이스에서 자주 나타나는 패턴:`);
Object.entries(winPatterns)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5)
  .forEach(([pattern, count]) => {
    const winRate = wins.length > 0 ? Math.round(count / wins.length * 100) : 0;
    console.log(`   ${pattern.padEnd(30)}  ${count}/${wins.length}건 (${winRate}%)`);
  });

// 실패 케이스에 많이 나타나는 패턴
console.log(`\n❌ 실패 케이스에서 자주 나타나는 패턴:`);
Object.entries(lossPatterns)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5)
  .forEach(([pattern, count]) => {
    const lossRate = losses.length > 0 ? Math.round(count / losses.length * 100) : 0;
    console.log(`   ${pattern.padEnd(30)}  ${count}/${losses.length}건 (${lossRate}%)`);

    // 경고 패턴 발견
    if (lossRate >= 60) {
      insights.findings.push({
        type: 'warning_pattern',
        pattern,
        lossRate,
        severity: 'high',
        description: `"${pattern}" 패턴이 실패 케이스의 ${lossRate}%에서 나타남`,
      });

      insights.recommendations.push({
        issue: `위험 패턴: ${pattern}`,
        recommendation: `이 패턴이 있는 종목은 진입 전 추가 검증 필요 (섹터 확인, SPY 상태 등)`,
        priority: 'medium',
      });
    }
  });

// ────────────────────────────────────────────────────────────
// 5. 최종 권장사항
// ────────────────────────────────────────────────────────────
console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`💡 발견된 개선점 (${insights.recommendations.length}개)`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

if (insights.recommendations.length === 0) {
  console.log(`✅ 현재까지 특별한 문제 발견 안 됨. 더 많은 케이스 수집 필요.\n`);
} else {
  const highPriority = insights.recommendations.filter(r => r.priority === 'high');
  const mediumPriority = insights.recommendations.filter(r => r.priority === 'medium');

  if (highPriority.length > 0) {
    console.log(`🔴 High Priority (즉시 개선 필요)`);
    highPriority.forEach((r, i) => {
      console.log(`\n${i + 1}. ${r.issue}`);
      console.log(`   → ${r.recommendation}`);
    });
  }

  if (mediumPriority.length > 0) {
    console.log(`\n🟡 Medium Priority (검토 필요)`);
    mediumPriority.forEach((r, i) => {
      console.log(`\n${i + 1}. ${r.issue}`);
      console.log(`   → ${r.recommendation}`);
    });
  }

  console.log(`\n⚠️  위 개선점을 적용하려면 사용자 승인이 필요합니다.`);
  console.log(`   승인 후 모델 업데이트를 진행하겠습니다.\n`);
}

// 인사이트 저장
fs.writeFileSync(INSIGHTS_PATH, JSON.stringify(insights, null, 2));

// ────────────────────────────────────────────────────────────
// 유틸리티 함수
// ────────────────────────────────────────────────────────────
function extractPatternKey(patternStr) {
  // 패턴 문자열에서 핵심 키워드만 추출
  if (patternStr.includes('이중 상승 다이버전스') || patternStr.includes('이중')) return 'RSI+MACD 이중 다이버전스';
  if (patternStr.includes('RSI 상승 다이버전스')) return 'RSI 다이버전스';
  if (patternStr.includes('MACD 상승 다이버전스')) return 'MACD 다이버전스';
  if (patternStr.includes('극신선 저점')) return '극신선 저점 (2일 이내)';
  if (patternStr.includes('최신 저점')) return '최신 저점 (3-5일)';
  if (patternStr.includes('매집 패턴')) return '매집 패턴';
  if (patternStr.includes('거래량 소진')) return '하락 거래량 소진';
  if (patternStr.includes('BB 하단')) return 'BB 하단 지지';
  if (patternStr.includes('상승 전환 캔들')) return 'Doji/Hammer 캔들';
  if (patternStr.includes('콜 집중')) return '옵션 콜 집중';
  if (patternStr.includes('기관 매수')) return '기관 매수';
  if (patternStr.includes('섹터 약세')) return '섹터 약세';
  if (patternStr.includes('실적 발표')) return '실적 발표 임박';
  return null;
}
