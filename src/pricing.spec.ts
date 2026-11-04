import { addMonths } from './dates.js';
import { charges, nightsOf, refund, refundRate } from './pricing.js';

const rates = { weekdayRate: 40000, weekendRate: 50000 };

describe('숙박비', () => {
  it('체크아웃 날은 묵지 않는다', () => {
    expect(nightsOf('2026-12-10', '2026-12-12')).toEqual(['2026-12-10', '2026-12-11']);
  });

  it('금·토요일 밤만 주말 요금', () => {
    // 2026-12-10(목) ~ 12-14(월): 목(평), 금(주), 토(주), 일(평)
    const c = charges({ checkIn: '2026-12-10', checkOut: '2026-12-14', ...rates }, []);
    expect(c).toMatchObject({ weekdayNights: 2, weekendNights: 2, lodging: 180000 });
  });

  it('추가 서비스는 횟수 × 신청 당시 단가로 더한다', () => {
    const c = charges({ checkIn: '2026-12-07', checkOut: '2026-12-08', ...rates }, [
      { quantity: 2, unitPrice: 10000 },
      { quantity: 1, unitPrice: 30000 },
    ]);
    expect(c).toMatchObject({ lodging: 40000, services: 50000, total: 90000 });
  });
});

describe('환불', () => {
  it.each([
    ['2026-12-07', 1], // 3일 전
    ['2026-12-08', 0.5], // 2일 전
    ['2026-12-09', 0.5], // 전날
    ['2026-12-10', 0], // 당일
    ['2026-12-11', 0], // 노쇼 (다음 날 처리)
  ])('체크인 12/10, %s 취소 → %s', (cancelledOn, rate) => {
    expect(refundRate('2026-12-10', cancelledOn)).toBe(rate);
  });

  it('합계 기준으로 비율을 곱한다', () => {
    expect(refund(90000, '2026-12-10', '2026-12-09')).toEqual({ rate: 0.5, amount: 45000 });
  });
});

describe('개월 더하기', () => {
  it('없는 날은 그 달 마지막 날로', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2025-06-15', 5)).toBe('2025-11-15');
    expect(addMonths('2024-02-29', 12)).toBe('2025-02-28');
  });
});
