#!/usr/bin/env node
/**
 * pick.js 실행 결과를 백테스트용으로 저장
 *
 * 사용법:
 * node scripts/pick.js 2026-03-19 | node scripts/backtest-save-picks.js 2026-03-19
 *
 * 또는:
 * node scripts/pick.js 2026-03-19 > output/temp-picks.txt
 * node scripts/backtest-save-picks.js 2026-03-19 < output/temp-picks.txt
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PICKS_DIR = path.join(__dirname, '../output/backtest-picks');

const date = process.argv[2];

if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error('❌ 날짜 필요 (YYYY-MM-DD)');
  console.error('사용법: node scripts/pick.js 2026-03-19 | node scripts/backtest-save-picks.js 2026-03-19');
  process.exit(1);
}

if (!fs.existsSync(PICKS_DIR)) {
  fs.mkdirSync(PICKS_DIR, { recursive: true });
}

const outputPath = path.join(PICKS_DIR, `${date}.json`);

// stdin에서 pick.js 출력을 파싱
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

let currentPick = null;
const picks = [];
let inPickSection = false;

rl.on('line', (line) => {
  // 추천 종목 섹션 시작
  if (line.includes('다이버전스 후보 종목')) {
    inPickSection = true;
  }

  // 종목 번호 감지 (1., 2., 3. 등)
  const pickMatch = line.match(/^(\d+)\.\s+(\w+)/);
  if (pickMatch && inPickSection) {
    // 이전 종목 저장
    if (currentPick) picks.push(currentPick);

    currentPick = {
      symbol: pickMatch[2],
      patterns: [],
    };
  }

  // 점수 추출
  const scoreMatch = line.match(/score\s+(\d+)/);
  if (scoreMatch && currentPick) {
    currentPick.score = parseInt(scoreMatch[1]);
  }

  // R:R 비율
  const rrMatch = line.match(/R:R\s+([\d.]+):1/);
  if (rrMatch && currentPick) {
    currentPick.rrRatio = parseFloat(rrMatch[1]);
  }

  // 매수/목표/손절가
  const priceMatch = line.match(/매수\s+\$?([\d.]+).*목표\s+\$?([\d.]+).*손절\s+\$?([\d.]+)/);
  if (priceMatch && currentPick) {
    currentPick.buyPrice = parseFloat(priceMatch[1]);
    currentPick.target = parseFloat(priceMatch[2]);
    currentPick.stop = parseFloat(priceMatch[3]);
  }

  // 패턴 라인 감지 (들여쓰기 + ·, -, 🎯, 📊 등)
  if (currentPick && (line.match(/^\s+[·\-🎯📊✅⭐⚡🕯️🏦🔥]/))) {
    const pattern = line.trim().replace(/^[·\-]\s*/, '');
    if (pattern && !pattern.startsWith('매수') && !pattern.startsWith('목표')) {
      currentPick.patterns.push(pattern);
    }
  }
});

rl.on('close', () => {
  // 마지막 종목 저장
  if (currentPick) picks.push(currentPick);

  if (picks.length === 0) {
    console.log('⚠️  추천 종목 없음 또는 파싱 실패');
    process.exit(0);
  }

  // 저장
  fs.writeFileSync(outputPath, JSON.stringify(picks, null, 2));

  console.log(`\n✅ ${date} 추천 종목 저장 완료: ${picks.length}건`);
  picks.forEach((p, i) => {
    console.log(`   ${i + 1}. ${p.symbol}  score ${p.score}  R:R ${p.rrRatio}:1`);
  });
  console.log(`   → ${outputPath}\n`);
});
