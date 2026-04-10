#!/bin/bash
echo "🚀 Stock Assistant 설치 시작..."

# 루트 패키지 설치
echo "📦 스크립트 의존성 설치..."
npm install

# 대시보드 패키지 설치
echo "📦 대시보드 의존성 설치..."
cd dashboard && npm install && cd ..

# .env 파일 생성
if [ ! -f .env ]; then
  cp .env.example .env
  echo "✅ .env 파일 생성됨 - ANTHROPIC_API_KEY와 Firebase 설정을 입력하세요"
fi

if [ ! -f dashboard/.env ]; then
  cp dashboard/.env.example dashboard/.env
  echo "✅ dashboard/.env 파일 생성됨 - Firebase Web 설정을 입력하세요"
fi

echo ""
echo "✅ 설치 완료!"
echo ""
echo "📋 다음 단계:"
echo "  1. .env 파일에 ANTHROPIC_API_KEY 입력"
echo "  2. Firebase 프로젝트 생성 후 .env에 설정 입력"
echo "  3. 장 전 분석: npm run premarket"
echo "  4. 장 후 분석: npm run postmarket"
echo "  5. 대시보드: npm run dashboard"
