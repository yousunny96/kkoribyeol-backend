// 날짜는 모두 'YYYY-MM-DD' 문자열로 다룬다. 계산할 때만 UTC 자정으로 바꿔서 시간대 영향을 받지 않게 한다

const toUtc = (d: string) => new Date(`${d}T00:00:00Z`);
const fmt = (dt: Date) => dt.toISOString().slice(0, 10);

export function isDateString(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fmt(toUtc(s)) === s;
}

/** 호텔은 한국에 있으므로 "오늘"은 서버 위치와 상관없이 한국 날짜 */
export function todayKst(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now);
}

export function addDays(d: string, days: number) {
  const dt = toUtc(d);
  dt.setUTCDate(dt.getUTCDate() + days);
  return fmt(dt);
}

/** 1/31 + 1개월처럼 그 달에 없는 날은 그 달의 마지막 날로 맞춘다 (PostgreSQL과 같은 방식) */
export function addMonths(d: string, months: number) {
  const dt = toUtc(d);
  const day = dt.getUTCDate();
  dt.setUTCDate(1);
  dt.setUTCMonth(dt.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(day, lastDay));
  return fmt(dt);
}

/** from에서 to까지 며칠인지 (to가 더 늦으면 양수) */
export function daysBetween(from: string, to: string) {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

/** 0=일요일 … 5=금요일, 6=토요일 */
export function weekday(d: string) {
  return toUtc(d).getUTCDay();
}
