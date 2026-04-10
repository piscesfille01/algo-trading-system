#!/bin/bash
# 백테스트 30개 날짜 자동 스캔

# 상승장 10개
dates_bull=(
  2025-10-27 2025-10-28 2025-10-29 2025-12-11 2025-12-22
  2025-12-23 2025-12-24 2025-12-26 2026-01-26 2026-01-27
)

# 하락장 10개
dates_bear=(
  2025-11-18 2025-11-19 2025-11-20 2025-11-21 2026-03-12
  2026-03-13 2026-03-18 2026-03-20 2026-03-26 2026-03-27
)

# 횡보장 10개
dates_sideways=(
  2025-10-15 2025-10-22 2025-11-03 2025-11-12 2025-12-03
  2025-12-15 2026-02-10 2026-02-24 2026-03-04 2026-03-31
)

mkdir -p output/backtest-picks

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🟢 상승장 (10개) 스캔 중..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
for date in "${dates_bull[@]}"; do
  echo "Processing $date (Bull)..."
  node scripts/pick.js $date > output/temp-pick-$date.txt 2>&1
  node scripts/backtest-save-picks.js $date < output/temp-pick-$date.txt 2>/dev/null
  sleep 2
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔴 하락장 (10개) 스캔 중..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
for date in "${dates_bear[@]}"; do
  echo "Processing $date (Bear)..."
  node scripts/pick.js $date > output/temp-pick-$date.txt 2>&1
  node scripts/backtest-save-picks.js $date < output/temp-pick-$date.txt 2>/dev/null
  sleep 2
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🟡 횡보장 (10개) 스캔 중..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
for date in "${dates_sideways[@]}"; do
  echo "Processing $date (Sideways)..."
  node scripts/pick.js $date > output/temp-pick-$date.txt 2>&1
  node scripts/backtest-save-picks.js $date < output/temp-pick-$date.txt 2>/dev/null
  sleep 2
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ 완료! 30개 날짜 스캔 완료"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "다음 단계:"
echo "1. output/backtest-picks/ 폴더에서 각 날짜별 추천 종목 확인"
echo "2. 진입/패스 결정 후 backtest-add.js로 입력"
echo "3. 30건 입력 완료 후 backtest-analyze.js 실행"
echo ""
echo "임시 파일 정리:"
echo "  rm output/temp-pick-*.txt"
echo ""
