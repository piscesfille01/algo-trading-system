// Firebase 대신 로컬 Express API 서버와 통신

export async function getAllData() {
  const res = await fetch('/api/data');
  if (!res.ok) throw new Error('API 서버 연결 실패');
  return res.json();
}

export async function getTodayRecommendation() {
  const { todayRec } = await getAllData();
  return todayRec;
}

export async function getPortfolioData() {
  const { portfolio } = await getAllData();
  return portfolio;
}

export async function getTradeHistory() {
  const { trades } = await getAllData();
  return trades;
}

export async function getPerformanceStats() {
  const { performance } = await getAllData();
  return performance;
}

export async function getJobStatus() {
  const res = await fetch('/api/status');
  return res.json();
}

export async function triggerPremarket() {
  const res = await fetch('/api/analyze/premarket', { method: 'POST' });
  return res.json();
}

export async function triggerPostmarket() {
  const res = await fetch('/api/analyze/postmarket', { method: 'POST' });
  return res.json();
}
