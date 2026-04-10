# 🎯 백테스트 시스템 - 완전 자동화

## 📋 개요

과거 날짜로 추천 종목을 확인하고, 실제 진입/패스 결정을 입력하면:
1. **자동으로 승률 계산**
2. **점수별/패턴별 성공률 분석**
3. **개선점 자동 발견**
4. **Claude가 코드 수정 제안** (당신 승인 필요)

---

## 🚀 빠른 시작

### 1. 과거 날짜 추천 확인
```bash
# 3월 19일 추천 종목 보기 + 저장
node scripts/pick.js 2026-03-19 | node scripts/backtest-save-picks.js 2026-03-19
```

출력 예시:
```
1. NVDA  score 15  R:R 2.1:1
   매수 $118.50 | 목표 $124.00 | 손절 $115.00
   · 🎯 RSI+MACD 이중 상승 다이버전스
   · ⚡ 극신선 저점 (2일 전)
   ...
```

### 2. 진입/패스 결정 입력

**진입한 경우:**
```bash
# 목표가 도달 (+4.5%)
node scripts/backtest-add.js 2026-03-19 NVDA entered 118.50 124.00 115.00 hit 123.80

# 손절 (-4.0%)
node scripts/backtest-add.js 2026-03-19 AMD entered 120.00 130.00 115.00 stop 115.20

# 아직 보유 중 (현재가 $185)
node scripts/backtest-add.js 2026-03-19 TSLA entered 180.00 190.00 175.00 holding 185.00
```

**진입 안 한 경우:**
```bash
node scripts/backtest-add.js 2026-03-19 INTC passed "score too low"
node scripts/backtest-add.js 2026-03-19 META passed "already holding too many positions"
```

### 3. 분석 실행 (5건 이상 쌓이면)
```bash
node scripts/backtest-analyze.js
```

출력 예시:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 백테스트 심층 분석 (12건)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 점수별 승률 분석
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🔴 6-7점 (최소 진입)       승률 40%  (2/5)  평균 -1.20%
  ✅ 8-9점 (양호)           승률 80%  (4/5)  평균 +6.50%
  ✅ 10점+ (우수)           승률 100%  (2/2)  평균 +12.30%

💡 발견된 개선점 (1개)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔴 High Priority (즉시 개선 필요)

1. 6-7점 구간 승률 40%
   → 최소 진입 점수를 8점으로 상향 고려

⚠️  위 개선점을 적용하려면 사용자 승인이 필요합니다.
```

### 4. Claude에게 승인 요청
```
"분석 결과 봤어. 6-7점 승률 40%니까 최소 점수 8점으로 올려줘"
```

→ Claude가 자동으로 pick.js 코드 수정!

---

## 📊 자동 분석 항목

### 케이스 5-9건
- 점수별 승률
- R:R 비율별 승률
- 기본 통계

### 케이스 10-19건
- 점수별 승률
- R:R 비율별 승률
- **패턴 분석** (성공 vs 실패)
- 개선점 자동 발견

### 케이스 20건+
- 점수별 승률
- R:R 비율별 승률
- 패턴 분석
- **섹터별 승률**
- **시장 환경별 승률** (SPY 상승/하락장)
- 고급 개선 제안

---

## 🎯 Claude가 자동으로 발견하는 것들

### 1. 점수 임계값 문제
```
발견: "6-7점 승률 40% (2/5)"
제안: "최소 진입 점수를 8점으로 상향"
→ pick.js에서 score < 8 탈락 적용
```

### 2. 위험 패턴
```
발견: "섹터 약세 패턴이 실패 케이스 80%에서 나타남"
제안: "섹터 약세 시 -3점 패널티 추가"
→ pick.js 수정
```

### 3. 성공 패턴 강화
```
발견: "이중 다이버전스 성공률 90% (9/10)"
제안: "이중 다이버전스에 +2점 보너스"
→ pick.js 수정
```

### 4. R:R 비율 조정
```
발견: "R:R 1.0-1.4x 승률 45% (5/11)"
      "R:R 1.5x+ 승률 85% (6/7)"
제안: "R:R 최소 1.5:1로 상향"
→ pick.js 수정
```

---

## 📁 저장되는 파일

```
output/
├── backtest-results.json       # 모든 케이스 (원본 데이터)
├── backtest-stats.json          # 실시간 통계 (승률, 수익 등)
├── backtest-insights.json       # 발견된 개선점
└── backtest-picks/
    ├── 2026-03-19.json         # 해당 날짜 추천 종목 상세
    ├── 2026-03-20.json
    └── ...
```

---

## 💡 효율적인 백테스트 방법

### 방법 1: 한 달 전체 스캔 (추천)
```bash
# 3월 전체 추천 종목 저장
for date in 2026-03-{01..31}; do
  echo "Processing $date..."
  node scripts/pick.js $date | node scripts/backtest-save-picks.js $date
  sleep 2  # API 제한 방지
done
```

그 후 각 날짜별로:
```bash
# 저장된 추천 보기
cat output/backtest-picks/2026-03-19.json

# 진입/패스 입력
node scripts/backtest-add.js 2026-03-19 NVDA entered ...
```

### 방법 2: 주요 날짜만
```bash
# 상승장 날짜들
node scripts/pick.js 2025-11-15 | node scripts/backtest-save-picks.js 2025-11-15
node scripts/pick.js 2025-11-22 | node scripts/backtest-save-picks.js 2025-11-22

# 하락장 날짜들
node scripts/pick.js 2026-03-10 | node scripts/backtest-save-picks.js 2026-03-10
node scripts/pick.js 2026-03-20 | node scripts/backtest-save-picks.js 2026-03-20
```

### 방법 3: 특정 섹터 집중
```bash
# 기술주 폭락 시기
2026-01-15, 2026-02-10, 2026-03-20

# 금융주 상승 시기
2025-11-01, 2025-12-10
```

---

## 🎯 목표 케이스 수

### 최소 목표: 30건
- 통계적 의미 있는 샘플
- 각 점수 구간별 3건 이상
- 다양한 섹터 포함

### 이상적 목표: 50-100건
- 섹터별 분석 가능
- 시장 환경별 분석
- 신뢰도 높은 개선점

---

## 🤖 Claude의 역할

### 당신이 데이터 입력하면:
```bash
node scripts/backtest-add.js ...
```

### Claude가 자동으로:
1. **승률 계산** (실시간)
2. **패턴 분석** (10건+)
3. **개선점 발견** (자동)
4. **코드 수정 제안** (당신 승인 필요)

### 당신이 승인하면:
```
"좋아, 최소 점수 8점으로 올려줘"
```

### Claude가 실행:
- pick.js 수정
- 변경 사항 설명
- 재백테스트 제안

---

## ✅ 체크리스트

### 백테스트 시작 전:
- [ ] `output/backtest-picks/` 디렉토리 존재 확인
- [ ] 과거 날짜 최소 10개 선정 (다양한 시장 환경)

### 백테스트 중:
- [ ] 진입/패스 결정 정확히 입력
- [ ] 목표가/손절가 실제 설정값 입력
- [ ] 5건마다 `backtest-analyze.js` 실행

### 백테스트 완료 후:
- [ ] 30건 이상 달성
- [ ] 승률 60% 이상 확인
- [ ] 개선점 적용
- [ ] 재백테스트로 검증

---

## 🚨 주의사항

### 정확한 데이터 입력
```bash
# ❌ 잘못된 예
node scripts/backtest-add.js 2026-03-19 NVDA entered 118 124 115 hit 123
# → 소수점 필수!

# ✅ 올바른 예
node scripts/backtest-add.js 2026-03-19 NVDA entered 118.50 124.00 115.00 hit 123.80
```

### 진입 시점 정확히
```bash
# ❌ 다음날 가격으로 진입
pick.js 추천: 2026-03-19 $118.50
실제 진입: 2026-03-20 $122.00  # 4% 갭업

# ✅ 추천 당일 종가로 진입
pick.js 추천: 2026-03-19 $118.50
실제 진입: 2026-03-19 $118.50  # 또는 다음날 시가
```

### 보유 중 케이스 업데이트
```bash
# 처음 진입
node scripts/backtest-add.js 2026-03-19 TSLA entered 180.00 190.00 175.00 holding 185.00

# 나중에 목표가 도달 → 재입력 필요 없음
# backtest-results.json 직접 수정하거나 새로 추가
```

---

## 📞 도움말

### 명령어가 헷갈리면:
```bash
bash scripts/backtest-demo.sh
```

### 파일 보고 싶으면:
```bash
cat output/backtest-stats.json
cat output/backtest-insights.json
```

### 초기화하고 싶으면:
```bash
rm -rf output/backtest-*.json
rm -rf output/backtest-picks/
```

---

## 🎯 최종 목표

**30건 백테스트 완료 후:**
- 승률 65-70% 달성
- 점수 임계값 최적화
- 위험 패턴 필터링
- 성공 패턴 강화

**→ Claude가 제안하는 개선점 적용**
**→ 실전 투자 자신감 확보!**
