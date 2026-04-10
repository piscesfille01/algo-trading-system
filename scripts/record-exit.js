#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════
// 매도 기록 스크립트
// 용도: 종목 청산 시 trades-manual.json 자동 업데이트
// 사용: node scripts/record-exit.js SYMBOL PRICE [NOTE]
// 예시:
//   node scripts/record-exit.js CTSH 66.50              # 자동 판단
//   node scripts/record-exit.js AXP 280.00 "조기 익절"   # 자동 판단 + 메모
// ═══════════════════════════════════════════════════════════════════

const TRADES_PATH = path.join(__dirname, '../output/trades-manual.json');
const BALANCE_PATH = path.join(__dirname, '../output/balance.json');

function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log(`사용법: node scripts/record-exit.js SYMBOL PRICE [NOTE]`);
    console.log(`\n예시:`);
    console.log(`  node scripts/record-exit.js CTSH 66.50              # 자동으로 목표가/손절가 판단`);
    console.log(`  node scripts/record-exit.js AXP 280.00 "조기 익절"   # 메모 추가`);
    console.log(`  node scripts/record-exit.js TSLA 215.00 "손절 직전 청산"\n`);
    console.log(`💡 청산가가 목표가에 가까우면 "목표가 도달", 손절가에 가까우면 "손절"로 자동 기록됨\n`);
    process.exit(1);
  }

  const symbol = args[0].toUpperCase();
  const sellPrice = parseFloat(args[1]);
  const note = args.slice(2).join(' ') || '';

  if (isNaN(sellPrice)) {
    console.error(`❌ 유효하지 않은 가격: ${args[1]}`);
    process.exit(1);
  }

  // trades-manual.json 로드
  if (!fs.existsSync(TRADES_PATH)) {
    console.error(`❌ ${TRADES_PATH} 파일이 없습니다.`);
    process.exit(1);
  }

  const trades = JSON.parse(fs.readFileSync(TRADES_PATH, 'utf-8'));
  const trade = trades.find(t => t.symbol === symbol && t.result === 'open');

  if (!trade) {
    console.error(`❌ ${symbol}: 보유 중인 포지션을 찾을 수 없습니다.`);
    process.exit(1);
  }

  // ── 자동 판단: hit / stop / exit ──
  const target = trade.target;
  const stop = trade.stop;
  const buyPrice = trade.buyPrice;

  let result;
  let autoReason;

  if (sellPrice >= target * 0.95) {
    // 목표가의 95% 이상 → hit
    result = 'hit';
    autoReason = `목표가($${target.toFixed(2)})의 ${((sellPrice / target) * 100).toFixed(1)}% 도달`;
  } else if (sellPrice <= stop * 1.05) {
    // 손절가의 105% 이하 → stop
    result = 'stop';
    autoReason = `손절가($${stop.toFixed(2)}) 근처에서 청산`;
  } else if (sellPrice > buyPrice) {
    // 진입가 위 → exit (조기 익절)
    result = 'exit';
    autoReason = '목표가 전 조기 익절';
  } else {
    // 진입가 아래 → exit (손절 전 청산)
    result = 'exit';
    autoReason = '손절가 전 조기 청산';
  }

  // 매도 정보 업데이트
  const sellDate = new Date().toISOString().split('T')[0];
  const pnl = (sellPrice - trade.buyPrice) * trade.shares;
  const pnlPct = ((sellPrice - trade.buyPrice) / trade.buyPrice) * 100;

  trade.sellDate = sellDate;
  trade.sellPrice = sellPrice;
  trade.result = result;
  trade.pnl = parseFloat(pnl.toFixed(2));
  trade.pnlPct = parseFloat(pnlPct.toFixed(2));

  // 메모에 자동 판단 이유 + 사용자 메모 추가
  const fullNote = autoReason + (note ? ` / ${note}` : '');
  trade.notes = (trade.notes || '') + `\n[청산 ${sellDate}] ${fullNote}`;

  // balance 업데이트
  const balanceData = JSON.parse(fs.readFileSync(BALANCE_PATH, 'utf-8'));
  const returnedCash = trade.invested + pnl;
  balanceData.balance = parseFloat((balanceData.balance + returnedCash).toFixed(2));

  // 저장
  fs.writeFileSync(TRADES_PATH, JSON.stringify(trades, null, 2));
  fs.writeFileSync(BALANCE_PATH, JSON.stringify(balanceData, null, 2));

  // 결과 출력
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 ${symbol} 청산 완료`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  console.log(`진입: $${trade.buyPrice.toFixed(2)} (${trade.buyDate})`);
  console.log(`목표: $${target.toFixed(2)} / 손절: $${stop.toFixed(2)}`);
  console.log(`청산: $${sellPrice.toFixed(2)} (${sellDate})`);
  console.log(`결과: ${result === 'hit' ? '✅ 목표가 도달' : result === 'stop' ? '❌ 손절' : '🔄 기타 청산'}`);
  console.log(`판단: ${autoReason}\n`);

  console.log(`투자액: $${trade.invested}`);
  console.log(`수익: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnl >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%)\n`);

  console.log(`반환 금액: $${returnedCash.toFixed(2)}`);
  console.log(`현재 잔고: $${balanceData.balance.toFixed(2)}\n`);

  if (note) {
    console.log(`추가 메모: ${note}\n`);
  }

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

main();
