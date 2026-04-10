#!/bin/bash
# 백테스트 데모 - 사용법 예시

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📚 백테스트 시스템 사용법 데모"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "1️⃣ 과거 날짜로 추천 종목 확인 + 저장"
echo "   node scripts/pick.js 2026-03-19 | node scripts/backtest-save-picks.js 2026-03-19"
echo ""

echo "2️⃣ 진입한 종목 추가 (목표가 도달)"
echo "   node scripts/backtest-add.js 2026-03-19 NVDA entered 118.50 124.00 115.00 hit 123.80"
echo ""

echo "3️⃣ 진입한 종목 추가 (손절)"
echo "   node scripts/backtest-add.js 2026-03-19 AMD entered 120.00 130.00 115.00 stop 114.50"
echo ""

echo "4️⃣ 진입 안 한 종목 추가"
echo "   node scripts/backtest-add.js 2026-03-19 INTC passed \"score too low\""
echo ""

echo "5️⃣ 백테스트 분석 (5건 이상 쌓이면)"
echo "   node scripts/backtest-analyze.js"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "💡 실전 워크플로우"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Step 1: 과거 날짜 3월 전체 스캔"
echo "  for date in 2026-03-{01..31}; do"
echo "    node scripts/pick.js \$date | node scripts/backtest-save-picks.js \$date"
echo "  done"
echo ""
echo "Step 2: 각 날짜별로 진입/패스 결정 입력"
echo "  (위 명령어 사용)"
echo ""
echo "Step 3: 10건 이상 쌓이면 분석"
echo "  node scripts/backtest-analyze.js"
echo ""
echo "Step 4: 개선점 발견 시 Claude에게 승인 요청"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
