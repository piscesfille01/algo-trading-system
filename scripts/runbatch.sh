#!/bin/bash
# 날짜 범위 배치 실행 (pick + evolve)
# 사용: bash scripts/runbatch.sh 2026-03-01 2026-03-27
# 날짜는 실제 거래일만 입력 (주말/공휴일 자동 스킵됨 — pick이 결과 없으면 evolve도 무해)

START=$1
END=$2

if [ -z "$START" ] || [ -z "$END" ]; then
  echo "사용법: bash scripts/runbatch.sh 2026-03-01 2026-03-27"
  exit 1
fi

# START~END 사이 날짜 생성
DATE="$START"
while [[ "$DATE" <= "$END" ]]; do
  # 주말 스킵
  DOW=$(date -j -f "%Y-%m-%d" "$DATE" +%u 2>/dev/null || date -d "$DATE" +%u)
  if [[ "$DOW" -le 5 ]]; then
    printf "  %s ... " "$DATE"
    node scripts/pick.js "$DATE" > /dev/null 2>&1
    node scripts/evolve.js "$DATE" > /dev/null 2>&1
    echo "done"
  fi
  # 다음 날
  DATE=$(date -j -v+1d -f "%Y-%m-%d" "$DATE" +"%Y-%m-%d" 2>/dev/null || date -d "$DATE + 1 day" +"%Y-%m-%d")
done

echo ""
echo "📊 리포트:"
node scripts/report.js "$START" "$END"
