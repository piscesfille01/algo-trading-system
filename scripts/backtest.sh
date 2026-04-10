#!/bin/bash
# A/B 백테스트: 거래량 필터 임계값 비교
# 사용: bash scripts/backtest.sh [start] [end] [threshold_a] [threshold_b]
# 예시: bash scripts/backtest.sh 2026-02-01 2026-02-28 0.8 1.2
#       bash scripts/backtest.sh                         ← 전체 기간, 0.8 vs 1.2

START=${1:-""}
END=${2:-""}
THRESH_A=${3:-"0.8"}
THRESH_B=${4:-"1.2"}

BACKUP_PENDING="output/picks-pending.backup.json"
BACKUP_SUMMARY="output/summary.backup.json"
PENDING="output/picks-pending.json"
SUMMARY="output/summary.json"

# 날짜 목록 추출
DATES=$(node -e "
const s=JSON.parse(require('fs').readFileSync('$SUMMARY'));
const start='$START', end='$END';
const dates=s.dates.map(d=>d.date).filter(d=>(!start||d>=start)&&(!end||d<=end));
console.log(dates.join('\n'));
")

if [ -z "$DATES" ]; then
  echo "⚠️  해당 기간 데이터 없음"
  exit 1
fi

DATE_COUNT=$(echo "$DATES" | wc -l | tr -d ' ')
echo "🧪 백테스트 대상: $DATE_COUNT 일"
echo "   A) VOL_THRESHOLD=$THRESH_A  B) VOL_THRESHOLD=$THRESH_B"
echo ""

# 백업
cp "$PENDING" "$BACKUP_PENDING" 2>/dev/null || echo '{}' > "$BACKUP_PENDING"
cp "$SUMMARY" "$BACKUP_SUMMARY"

run_batch() {
  local THRESH=$1
  local LABEL=$2

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "▶ $LABEL (VOL_THRESHOLD=$THRESH) 실행 중..."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # 대상 날짜만 picks-pending에서 제거
  node -e "
const fs=require('fs');
const dates=\`$DATES\`.trim().split('\n');
const pending=fs.existsSync('$PENDING')?JSON.parse(fs.readFileSync('$PENDING')):[];
const filtered=pending.filter(p=>!dates.includes(p.analysisDate));
fs.writeFileSync('$PENDING',JSON.stringify(filtered,null,2));
// summary.json에서도 해당 날짜 제거
const sum=JSON.parse(fs.readFileSync('$SUMMARY'));
sum.dates=sum.dates.filter(d=>!dates.includes(d.date));
fs.writeFileSync('$SUMMARY',JSON.stringify(sum,null,2));
"

  # 각 날짜별 pick + evolve 실행
  while IFS= read -r DATE; do
    printf "  %s ... " "$DATE"
    VOL_THRESHOLD=$THRESH node scripts/pick.js "$DATE" > /dev/null 2>&1
    node scripts/evolve.js "$DATE" > /dev/null 2>&1
    echo "done"
  done <<< "$DATES"

  echo ""
  echo "📊 결과 ($LABEL):"
  if [ -n "$START" ]; then
    node scripts/report.js "$START" "$END"
  else
    node scripts/report.js
  fi
}

# A 실행
run_batch "$THRESH_A" "기존 (A)"

echo ""
echo ""

# B 실행 (summary는 A 결과가 들어있는 상태에서 시작)
# B를 위해 원본 summary 복원 후 다시 실행
cp "$BACKUP_SUMMARY" "$SUMMARY"
cp "$BACKUP_PENDING" "$PENDING"
run_batch "$THRESH_B" "신규 (B)"

# 원본 복원
echo ""
echo "✅ 완료 — 원본 데이터 복원 중..."
cp "$BACKUP_SUMMARY" "$SUMMARY"
cp "$BACKUP_PENDING" "$PENDING"
rm -f "$BACKUP_PENDING" "$BACKUP_SUMMARY"
echo "✅ 원본 복원 완료"
