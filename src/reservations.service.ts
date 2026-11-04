import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type pg from 'pg';
import { addDays, addMonths, todayKst } from './dates.js';
import { DbService } from './db.service.js';
import { reject } from './fields.js';
import { charges, nightRate, nightsOf, refund } from './pricing.js';

export type Status = 'booked' | 'checked_in' | 'checked_out' | 'cancelled';
export const STATUSES: readonly Status[] = ['booked', 'checked_in', 'checked_out', 'cancelled'];

export interface CreateReservation {
  roomTypeId: number;
  checkIn: string;
  checkOut: string;
  petIds: number[];
  services: { serviceId: number; quantity: number }[];
}

interface Row {
  id: number;
  status: Status;
  check_in: string;
  check_out: string;
  weekday_rate: number;
  weekend_rate: number;
  checked_in_at: Date | null;
  checked_out_at: Date | null;
  cancelled_on: string | null;
  created_at: Date;
  room: { id: number; roomNo: string; typeId: number; typeName: string };
  guardian: { id: number; name: string; email: string; phone: string; emergencyName: string; emergencyPhone: string };
  pets: { id: number; name: string; species: string; weightKg: number; food: string | null; allergy: string | null }[];
  services: { serviceId: number; name: string; quantity: number; unitPrice: number }[];
}

// 예약 하나를 화면에 필요한 모양(방, 보호자, 반려동물, 서비스)으로 한 번에 가져온다
const SELECT_RESERVATION = `
SELECT r.id, r.status, r.check_in, r.check_out, r.weekday_rate, r.weekend_rate,
       r.checked_in_at, r.checked_out_at, r.cancelled_on, r.created_at,
       json_build_object('id', rm.id, 'roomNo', rm.room_no, 'typeId', rt.id, 'typeName', rt.name) AS room,
       json_build_object('id', g.id, 'name', g.name, 'email', g.email, 'phone', g.phone,
                         'emergencyName', g.emergency_name, 'emergencyPhone', g.emergency_phone) AS guardian,
       (SELECT coalesce(json_agg(json_build_object('id', p.id, 'name', p.name, 'species', p.species,
                 'weightKg', p.weight_kg, 'food', p.food, 'allergy', p.allergy) ORDER BY p.id), '[]')
          FROM reservation_pet rp JOIN pet p ON p.id = rp.pet_id WHERE rp.reservation_id = r.id) AS pets,
       (SELECT coalesce(json_agg(json_build_object('serviceId', s.id, 'name', s.name,
                 'quantity', rs.quantity, 'unitPrice', rs.unit_price) ORDER BY s.id), '[]')
          FROM reservation_service rs JOIN service s ON s.id = rs.service_id WHERE rs.reservation_id = r.id) AS services
  FROM reservation r
  JOIN room rm ON rm.id = r.room_id
  JOIN room_type rt ON rt.id = rm.room_type_id
  JOIN guardian g ON g.id = r.guardian_id`;

/** 저장된 값(단가, 날짜, 횟수)으로 금액과 환불을 계산해서 붙인다 */
function present(r: Row, today = todayKst()) {
  const amount = charges(
    { checkIn: r.check_in, checkOut: r.check_out, weekdayRate: r.weekday_rate, weekendRate: r.weekend_rate },
    r.services,
  );
  return {
    id: r.id,
    status: r.status,
    checkIn: r.check_in,
    checkOut: r.check_out,
    room: r.room,
    guardian: r.guardian,
    pets: r.pets,
    services: r.services.map((s) => ({ ...s, amount: s.quantity * s.unitPrice })),
    charges: amount,
    checkedInAt: r.checked_in_at,
    checkedOutAt: r.checked_out_at,
    cancelledOn: r.cancelled_on,
    createdAt: r.created_at,
    // 취소했으면 실제 환불, 아직 예약 상태면 "오늘 취소하면" 얼마인지
    refund: r.cancelled_on ? refund(amount.total, r.check_in, r.cancelled_on) : null,
    refundIfCancelledToday: r.status === 'booked' ? refund(amount.total, r.check_in, today) : null,
  };
}
export type Reservation = ReturnType<typeof present>;

@Injectable()
export class ReservationsService {
  constructor(private readonly db: DbService) {}

  private async select(where: string, params: unknown[], order = 'r.check_in, r.id', c?: pg.PoolClient) {
    const { rows } = await (c ?? this.db.pool).query<Row>(`${SELECT_RESERVATION} WHERE ${where} ORDER BY ${order}`, params);
    return rows.map((r) => present(r));
  }

  async get(id: number, guardianId?: number) {
    const [r] = await this.select('r.id = $1', [id]);
    // 다른 보호자의 예약은 있는지조차 알려 주지 않는다
    if (!r || (guardianId !== undefined && r.guardian.id !== guardianId)) {
      throw new NotFoundException({ message: '예약을 찾을 수 없어요.' });
    }
    return r;
  }

  listForGuardian(guardianId: number) {
    return this.select('r.guardian_id = $1', [guardianId], 'r.check_in DESC, r.id DESC');
  }

  listAll(filter: { status?: Status; date?: string }) {
    const where: string[] = ['true'];
    const params: unknown[] = [];
    if (filter.status) {
      params.push(filter.status);
      where.push(`r.status = $${params.length}`);
    }
    if (filter.date) {
      params.push(filter.date);
      where.push(`r.check_in <= $${params.length} AND r.check_out > $${params.length}`);
    }
    return this.select(where.join(' AND '), params, 'r.check_in DESC, r.id DESC');
  }

  /** 예약 만들기. DB가 못 막는 규칙(다른 테이블을 봐야 하거나 날짜에 따라 바뀌는 것)을 여기서 막는다 */
  async create(guardianId: number, input: CreateReservation) {
    const today = todayKst();
    if (input.checkIn < today) reject('지난 날짜로는 예약할 수 없어요.');
    if (input.checkOut <= input.checkIn) reject('체크아웃은 체크인보다 늦어야 해요.');

    const id = await this.db.tx(async (c) => {
      // 같은 반려동물로 동시에 두 번 예약하지 못하게 잠근다
      const { rows: pets } = await c.query(
        `SELECT id, guardian_id, name, birth_date, weight_kg, last_vaccine_date, last_rabies_date
           FROM pet WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE`,
        [input.petIds],
      );
      // 규칙: 한 예약에는 같은 보호자의 반려동물만
      if (pets.length !== input.petIds.length || pets.some((p) => p.guardian_id !== guardianId)) {
        throw new ForbiddenException({ message: '내 반려동물만 예약할 수 있어요.', code: 'NOT_OWN_PET' });
      }

      for (const p of pets) {
        // 규칙: 체크인 날 기준 생후 5개월 이상
        if (addMonths(p.birth_date, 5) > input.checkIn) {
          reject(`${p.name}은(는) 체크인 날 생후 5개월이 안 돼서 예약할 수 없어요.`, 'TOO_YOUNG');
        }
        // 규칙: 체크인 날 기준 종합백신·광견병 접종 1년 이내
        for (const [date, label] of [
          [p.last_vaccine_date, '종합백신'],
          [p.last_rabies_date, '광견병'],
        ] as [string | null, string][]) {
          if (!date) reject(`${p.name}의 ${label} 접종 기록이 없어 예약할 수 없어요.`, 'VACCINE_MISSING');
          if (addMonths(date!, 12) < input.checkIn) {
            reject(`${p.name}의 ${label} 접종이 체크인 날 기준 1년이 지나서 예약할 수 없어요. (접종일 ${date})`, 'VACCINE_EXPIRED');
          }
        }
      }

      // 규칙: 몸무게에 맞는 종류의 방만. 두 마리면 무거운 쪽 기준
      const { rows: types } = await c.query(`SELECT * FROM room_type WHERE id = $1`, [input.roomTypeId]);
      const type = types[0];
      if (!type) reject('없는 객실 종류예요.');
      const heaviest = pets.reduce((a, b) => (b.weight_kg > a.weight_kg ? b : a));
      const w = heaviest.weight_kg as number;
      if (w < type.min_weight || (type.max_weight !== null && w >= type.max_weight)) {
        const range = type.max_weight === null ? `${type.min_weight}kg 이상` : `${type.min_weight}kg 이상 ${type.max_weight}kg 미만`;
        reject(`${heaviest.name}(${w}kg)은(는) ${type.name} 객실(${range})에 맞지 않아요.`, 'WEIGHT_MISMATCH');
      }

      // 규칙: 같은 반려동물이 날짜가 겹치는 다른 예약에 들어가 있으면 안 된다 (방이 달라도)
      const { rows: busy } = await c.query(
        `SELECT p.name FROM reservation r
           JOIN reservation_pet rp ON rp.reservation_id = r.id
           JOIN pet p ON p.id = rp.pet_id
          WHERE rp.pet_id = ANY($1::bigint[]) AND r.status <> 'cancelled'
            AND daterange(r.check_in, r.check_out) && daterange($2::date, $3::date)`,
        [input.petIds, input.checkIn, input.checkOut],
      );
      if (busy.length) reject(`${busy[0].name}은(는) 같은 기간에 이미 예약이 있어요.`, 'PET_ALREADY_BOOKED');

      const serviceIds = input.services.map((s) => s.serviceId);
      const { rows: services } = await c.query(`SELECT id, price FROM service WHERE id = ANY($1::bigint[])`, [serviceIds]);
      if (services.length !== new Set(serviceIds).size) reject('없는 추가 서비스가 있어요.');

      // 빈 방을 번호 순으로 고른다. 그 사이 다른 사람이 같은 방을 잡으면 DB의 겹침 금지(EXCLUDE)에 걸리므로 다음 방으로
      const { rows: rooms } = await c.query(`SELECT id FROM room WHERE room_type_id = $1 ORDER BY room_no`, [type.id]);
      for (const room of rooms) {
        await c.query('SAVEPOINT pick_room');
        try {
          const { rows } = await c.query(
            `INSERT INTO reservation (guardian_id, room_id, check_in, check_out, weekday_rate, weekend_rate)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [guardianId, room.id, input.checkIn, input.checkOut, type.weekday_price, type.weekend_price],
          );
          const reservationId: number = rows[0].id;
          await c.query(`INSERT INTO reservation_pet (reservation_id, pet_id) SELECT $1, unnest($2::bigint[])`, [
            reservationId,
            input.petIds,
          ]);
          for (const s of input.services) {
            const price = services.find((x) => x.id === s.serviceId)!.price;
            await c.query(
              `INSERT INTO reservation_service (reservation_id, service_id, quantity, unit_price) VALUES ($1, $2, $3, $4)`,
              [reservationId, s.serviceId, s.quantity, price],
            );
          }
          return reservationId;
        } catch (e) {
          if ((e as { code?: string }).code !== '23P01') throw e;
          await c.query('ROLLBACK TO SAVEPOINT pick_room');
        }
      }
      throw new ConflictException({ message: `그 기간에는 ${type.name} 객실에 빈 방이 없어요.`, code: 'NO_ROOM' });
    });
    return this.get(id);
  }

  /** 취소. 고객은 자기 예약만, 직원은 노쇼 처리에도 쓴다. 취소한 날짜로 환불을 계산한다 */
  async cancel(id: number, guardianId?: number) {
    const r = await this.get(id, guardianId);
    if (r.status !== 'booked') reject('예약됨 상태인 예약만 취소할 수 있어요.', 'INVALID_STATUS');
    await this.db.pool.query(`UPDATE reservation SET status = 'cancelled', cancelled_on = $2 WHERE id = $1`, [id, todayKst()]);
    return this.get(id);
  }

  async checkIn(id: number) {
    const r = await this.get(id);
    const today = todayKst();
    if (r.status !== 'booked') reject('예약됨 상태인 예약만 입실 처리할 수 있어요.', 'INVALID_STATUS');
    if (today < r.checkIn || today >= r.checkOut) reject(`입실은 숙박 기간(${r.checkIn}~${r.checkOut}) 안에만 할 수 있어요.`);
    await this.db.pool.query(`UPDATE reservation SET status = 'checked_in', checked_in_at = now() WHERE id = $1`, [id]);
    return this.get(id);
  }

  async checkOut(id: number) {
    const r = await this.get(id);
    if (r.status !== 'checked_in') reject('입실 상태인 예약만 퇴실 처리할 수 있어요.', 'INVALID_STATUS');
    await this.db.pool.query(`UPDATE reservation SET status = 'checked_out', checked_out_at = now() WHERE id = $1`, [id]);
    return this.get(id);
  }

  /** 오늘 입실 예정·퇴실 예정 (취소 제외). 사료와 알레르기, 비상 연락처가 함께 나온다 */
  async today() {
    const date = todayKst();
    const [checkIns, checkOuts] = await Promise.all([
      this.select(`r.check_in = $1 AND r.status <> 'cancelled'`, [date], 'r.id'),
      this.select(`r.check_out = $1 AND r.status <> 'cancelled'`, [date], 'r.id'),
    ]);
    return { date, checkIns, checkOuts };
  }

  /** 그날 밤 객실 종류별 빈 방 수. 예약할 때와 같은 기준(취소만 빼고 모두 방을 차지)으로 센다 */
  async availability(date: string) {
    const { rows } = await this.db.pool.query(
      `SELECT rt.id, rt.name, rt.min_weight AS "minWeight", rt.max_weight AS "maxWeight",
              rt.weekday_price AS "weekdayPrice", rt.weekend_price AS "weekendPrice",
              count(rm.id) AS total,
              count(rm.id) FILTER (WHERE EXISTS (
                SELECT 1 FROM reservation r
                 WHERE r.room_id = rm.id AND r.status <> 'cancelled'
                   AND r.check_in <= $1 AND r.check_out > $1)) AS occupied
         FROM room_type rt LEFT JOIN room rm ON rm.room_type_id = rt.id
        GROUP BY rt.id ORDER BY rt.min_weight`,
      [date],
    );
    return { date, roomTypes: rows.map((r) => ({ ...r, available: r.total - r.occupied })) };
  }

  /**
   * 이번 달 객실 종류별 매출 (D 요구사항)
   * - 숙박비: 그 달에 실제로 묵은 밤만 (취소 제외)
   * - 추가 서비스: 체크인한 달 (취소 제외)
   * - 위약금(합계 - 환불): 취소한 날의 달
   */
  async sales(month: string) {
    const start = `${month}-01`;
    const end = addMonths(start, 1);
    const reservations = await this.select(
      `(r.status <> 'cancelled' AND r.check_in < $2 AND r.check_out > $1)
        OR (r.status = 'cancelled' AND r.cancelled_on >= $1 AND r.cancelled_on < $2)`,
      [start, end],
    );
    const { rows: types } = await this.db.pool.query(`SELECT id, name FROM room_type ORDER BY min_weight`);
    const byType = new Map<number, { roomTypeId: number; name: string; nights: number; lodging: number; services: number; penalty: number }>(
      types.map((t) => [t.id, { roomTypeId: t.id, name: t.name, nights: 0, lodging: 0, services: 0, penalty: 0 }]),
    );

    for (const r of reservations) {
      const row = byType.get(r.room.typeId)!;
      if (r.status === 'cancelled') {
        row.penalty += r.charges.total - r.refund!.amount;
        continue;
      }
      for (const night of nightsOf(r.checkIn, r.checkOut)) {
        if (night >= start && night < end) {
          row.nights += 1;
          row.lodging += nightRate(night, r.charges);
        }
      }
      if (r.checkIn >= start && r.checkIn < end) row.services += r.charges.services;
    }

    const rows = [...byType.values()].map((r) => ({ ...r, total: r.lodging + r.services + r.penalty }));
    return { month, from: start, to: addDays(end, -1), rows, total: rows.reduce((s, r) => s + r.total, 0) };
  }
}
