# 🚀 백테스트 시작 가이드

## ✅ 준비 완료

### 1️⃣ 추천 날짜 리스트 (30개)
📄 **BACKTEST-DATES.md** 확인
- 🟢 상승장 10개
- 🔴 하락장 10개  
- 🟡 횡보장 10개

### 2️⃣ 자동 스캔 스크립트
```bash
bash scripts/run-backtest-30.sh
```
→ 30개 날짜 자동 스캔 (약 2분 소요)

### 3️⃣ 진입/패스 입력
```bash
# 목표가 도달
node scripts/backtest-add.js 2025-10-27 NVDA entered 118.50 124.00 115.00 hit 123.80

# 손절
node scripts/backtest-add.js 2025-10-27 AMD entered 120.00 130.00 115.00 stop 114.50

# 패스
node scripts/backtest-add.js 2025-10-27 INTC passed "score too low"
```

### 4️⃣ 분석 실행 (5건 이상 시)
```bash
node scripts/backtest-analyze.js
```

---

## 📊 Claude가 자동으로 하는 것

### 매번 입력할 때마다:
- ✅ 승률 실시간 계산
- ✅ 평균 수익/손실 업데이트
- ✅ 누적 통계 저장

### 10건 이상 쌓이면:
- ✅ 점수별 승률 분석
- ✅ 패턴별 성공/실패율
- ✅ 개선점 자동 발견
- ⚠️ 사용자 승인 요청

### 당신이 승인하면:
- 🔧 pick.js 자동 수정
- 📈 모델 성능 개선
- ✅ 완료!

---

## 🎯 목표

**30건 완료 시:**
- 승률 65-70% 달성
- 점수 임계값 최적화
- 위험 패턴 필터링
- 실전 투자 준비 완료

---

## 📞 상세 가이드

- **BACKTEST-README.md** - 전체 사용법
- **BACKTEST-DATES.md** - 30개 추천 날짜
- **docs/backtest-guide.md** - 고급 기능

---

## 🚀 지금 시작

### Step 1: 날짜 스캔
```bash
bash scripts/run-backtest-30.sh
```

### Step 2: 첫 번째 날짜 확인
```bash
cat output/backtest-picks/2025-10-27.json
```

### Step 3: 진입/패스 입력
```bash
node scripts/backtest-add.js 2025-10-27 [SYMBOL] [entered/passed] ...
```

### Step 4: 통계 확인
```bash
cat output/backtest-stats.json
```

**시작!** 🎯
