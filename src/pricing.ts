import { addDays, daysBetween, weekday } from './dates.js';

// 금액은 저장하지 않고 예약에 저장된 단가와 날짜로 그때그때 계산한다 (꼬리별_설계결정.md 4장)

export interface StayInput {
  checkIn: string;
  checkOut: string;
  weekdayRate: number;
  weekendRate: number;
}

export interface ServiceLine {
  quantity: number;
  unitPrice: number;
}

/** 묵는 밤들. 체크아웃 날은 묵지 않으므로 빠진다 [check_in, check_out) */
export function nightsOf(checkIn: string, checkOut: string) {
  const nights: string[] = [];
  for (let d = checkIn; d < checkOut; d = addDays(d, 1)) nights.push(d);
  return nights;
}

/** 주말 요금은 금·토요일 밤 (결정 7) */
export function isWeekendNight(night: string) {
  const w = weekday(night);
  return w === 5 || w === 6;
}

export function nightRate(night: string, s: Pick<StayInput, 'weekdayRate' | 'weekendRate'>) {
  return isWeekendNight(night) ? s.weekendRate : s.weekdayRate;
}

export function charges(stay: StayInput, services: ServiceLine[]) {
  const nights = nightsOf(stay.checkIn, stay.checkOut);
  const weekendNights = nights.filter(isWeekendNight).length;
  const weekdayNights = nights.length - weekendNights;
  const lodging = weekdayNights * stay.weekdayRate + weekendNights * stay.weekendRate;
  const serviceAmount = services.reduce((sum, s) => sum + s.quantity * s.unitPrice, 0);
  return {
    weekdayNights,
    weekendNights,
    weekdayRate: stay.weekdayRate,
    weekendRate: stay.weekendRate,
    lodging,
    services: serviceAmount,
    total: lodging + serviceAmount,
  };
}

/** 체크인 3일 전까지 100%, 2일 전~전날 50%, 당일(노쇼 포함) 0% */
export function refundRate(checkIn: string, cancelledOn: string) {
  const daysBefore = daysBetween(cancelledOn, checkIn);
  if (daysBefore >= 3) return 1;
  if (daysBefore >= 1) return 0.5;
  return 0;
}

/** 환불은 합계(숙박비 + 서비스) 기준 (결정 10) */
export function refund(total: number, checkIn: string, cancelledOn: string) {
  const rate = refundRate(checkIn, cancelledOn);
  return { rate, amount: Math.floor(total * rate) };
}
