# Stock Assistant - 전체 커멘드 정리

## 📊 일일 트레이딩 워크플로우

### 1️⃣ 종목 추천 받기
```bash
# 오늘 날짜로 스캔
node scripts/pick.js

# 특정 날짜로 스캔 (백테스트용)
node scripts/pick.js 2025-10-27
```

**출력**:
- 상위 5개 추천 종목 (점수 7점 이상)
- 각 종목별 진입가, 목표가, 손절가, R:R 비율
- 패턴 정보 (V자 반등, 다이버전스, 거래량 매집 등)
- `output/latest-picks.json`에 자동 저장

---

### 2️⃣ 진입할 종목 검토
```bash
# 추천된 종목 중 진입할 종목 선택 및 상세 분석
node scripts/review-entry.js SYMBOL1 SYMBOL2

# 예시
node scripts/review-entry.js TKO SWKS
node scripts/review-entry.js CTSH
```

**출력**:
- 현재 포트폴리오 상태 (보유 종목, 미실현 손익)
- 가용 자금
- 각 종목별 투자액 계산 (25% 균형 전략)
- 우선순위 랭킹
- 시장 상태 체크 (SPY, VIX)
- 리스크 경고

---

### 3️⃣ 보유 종목 매일 분석 (NEW! ✨)
```bash
# 보유 중인 종목 분석
node scripts/analyze-position.js SYMBOL1 SYMBOL2

# 예시
node scripts/analyze-position.js CTSH AXP
```

**출력**:
- 포지션 현황 (진입가, 현재가, 미실현 손익)
- 기술적 지표 (RSI, MACD, 거래량, ATR)
- 옵션 세력 (P/C Ratio)
- **Trailing Stop 제안** (본전 손절가 상향)
- **목표가 조정 제안** (모멘텀 강화 시)
- **조기 청산 알림** (과매수, 거래량 급감)
- **손절 재검토 알림** (약세 전환 신호)

**권장**: 주 1-2회 체크 (매일은 과함)

---

### 4️⃣ 매도 기록 (NEW! ✨)
```bash
# 청산가만 입력하면 자동으로 목표가/손절가 판단
node scripts/record-exit.js SYMBOL PRICE [NOTE]

# 예시
node scripts/record-exit.js CTSH 66.50              # 자동 판단
node scripts/record-exit.js AXP 280.00 "조기 익절"   # 자동 판단 + 메모
node scripts/record-exit.js TSLA 215.00 "손절 직전 청산"
```

**자동 판단 로직**:
- 청산가가 **목표가의 95% 이상** → ✅ "목표가 도달" (성공)
- 청산가가 **손절가의 105% 이하** → ❌ "손절" (실패)
- 그 외 → 🔄 "기타 청산" (조기 익절/청산)

**자동 처리**:
- `trades-manual.json` 업데이트 (결과 자동 판단)
- `balance.json` 잔고 업데이트
- 수익/손실 계산
- 메모 자동 저장

---

## 🧪 백테스트

### 5️⃣ 백테스트 날짜 스캔
```bash
# 30개 날짜 전체 스캔 (상승장/하락장/횡보장)
bash scripts/run-backtest-30.sh

# 또는 개별 날짜
node scripts/pick.js 2025-10-27 > output/temp-pick-2025-10-27.txt
node scripts/backtest-save-picks.js 2025-10-27 < output/temp-pick-2025-10-27.txt
```

---

### 6️⃣ 백테스트 데이터 입력
```bash
# 진입 후 결과 입력
node scripts/backtest-add.js DATE SYMBOL DECISION ...

# 진입 성공
node scripts/backtest-add.js 2025-10-27 NVDA entered 118.50 124.00 115.00 hit 123.80

# 패스
node scripts/backtest-add.js 2025-10-27 AMD passed "score only 6"

# 진입 실패
node scripts/backtest-add.js 2025-10-27 TSLA entered 210.00 220.00 200.00 stop 199.50
```

---

### 7️⃣ 백테스트 분석
```bash
# 전체 백테스트 결과 분석
node scripts/backtest-analyze.js
```

**출력**:
- 승률
- 평균 R:R 비율
- 시장 환경별 성과 (상승장/하락장/횡보장)
- 개선 제안 (점수 조정, R:R 조정 등)

---

## 🛠️ 유틸리티

### 8️⃣ 잔고 확인
```bash
cat output/balance.json
```

---

### 9️⃣ 보유 종목 확인
```bash
cat output/trades-manual.json
```

---

### 🔟 최근 추천 확인
```bash
cat output/latest-picks.json
```

---

## 📋 일일 루틴 요약

### 🌅 아침 (장 시작 전)
```bash
# 1. 오늘 추천 종목 스캔
node scripts/pick.js

# 2. 진입할 종목 선택 및 검토
node scripts/review-entry.js TKO SWKS

# 3. 보유 종목 상태 체크 (주 1-2회)
node scripts/analyze-position.js CTSH AXP
```

### 🌆 저녁 (장 마감 후)
```bash
# 4. 청산한 종목 기록 (가격만 입력, 자동 판단)
node scripts/record-exit.js CTSH 66.50

# 5. 잔고 확인
cat output/balance.json
```

### 📅 주말
```bash
# 백테스트 분석 (선택)
node scripts/backtest-analyze.js
```

---

## 🎯 트레이딩 원칙 (리마인더)

### 필수 준수
1. **디폴트 손익비**: 2:1 (목표 +10%, 손절 -5%)
2. **포지션 사이징**: 종목당 25% (균형 전략)
3. **최대 보유**: 5개 종목 이하
4. **손절 원칙**: 철저히 준수 (감정 배제)
5. **목표가 도달**: 즉시 청산
6. **VIX 25+**: 포지션 5% 이하로 축소

### 금지
- 손절가 임의 변경
- 목표가 도달 전 욕심
- 소형주/바이오 5% 이상 비중
- 동일 섹터 3개 이상

---

## 📞 문제 해결

### API Rate Limit 에러
```bash
# Yahoo Finance 429 에러 → 12초 대기 후 재시도
# Polygon.io 429 에러 → API 키 확인 또는 플랜 업그레이드
```

### 파일 없음 에러
```bash
# 초기 설정
echo '{"balance":10000}' > output/balance.json
echo '[]' > output/trades-manual.json
mkdir -p output/backtest-picks
```

---

## 🔗 참고 파일

- **설정**: `.env` (API 키)
- **워치리스트**: `docs/watchlist.md`
- **백테스트 날짜**: `BACKTEST-DATES.md`
- **메모리**: `~/.claude/projects/-Users-elliekang-Develop-stock-assistant/memory/`

---

**마지막 업데이트**: 2026-04-05
