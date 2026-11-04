import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser, Roles } from './auth.guard.js';
import type { AuthUser } from './auth.service.js';
import { isDateString, todayKst } from './dates.js';
import { DbService } from './db.service.js';
import { Fields, reject } from './fields.js';
import { ReservationsService, STATUSES, type Status } from './reservations.service.js';

/** 로그인하지 않아도 볼 수 있는 기준 정보 */
@Controller()
export class CatalogController {
  constructor(
    private readonly db: DbService,
    private readonly reservations: ReservationsService,
  ) {}

  @Get('services')
  async services() {
    const { rows } = await this.db.pool.query(`SELECT id, name, price FROM service ORDER BY id`);
    return rows;
  }

  /** 날짜를 고르면 객실 종류별 빈 방 수 (객실 종류, 몸무게 기준, 요금도 함께) */
  @Get('availability')
  availability(@Query('date') date?: string) {
    if (date !== undefined && !isDateString(date)) reject('date는 YYYY-MM-DD 형식이어야 해요.');
    return this.reservations.availability(date ?? todayKst());
  }
}

/** 코어 웹: 보호자는 자기 예약만 보고, 신청하고, 취소한다 */
@Controller('reservations')
@UseGuards(AuthGuard)
@Roles('guardian')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Get()
  list(@CurrentUser() me: AuthUser) {
    return this.reservations.listForGuardian(me.id);
  }

  @Get(':id')
  get(@CurrentUser() me: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.reservations.get(id, me.id);
  }

  @Post()
  create(@CurrentUser() me: AuthUser, @Body() body: unknown) {
    const f = new Fields(body);
    const roomTypeId = f.number('roomTypeId', '객실 종류', { int: true, min: 1 });
    const checkIn = f.date('checkIn', '체크인 날짜')!;
    const checkOut = f.date('checkOut', '체크아웃 날짜')!;
    const petIds = f.idList('petIds', '반려동물', { min: 1, max: 2 });
    const rawServices = f.raw('services') ?? [];
    const services: { serviceId: number; quantity: number }[] = [];
    if (!Array.isArray(rawServices)) {
      f.errors.services = '추가 서비스 목록 형식이 아니에요.';
    } else {
      rawServices.forEach((s, i) => {
        const sf = new Fields(s);
        const serviceId = sf.number('serviceId', '서비스', { int: true, min: 1 });
        const quantity = sf.number('quantity', '횟수', { int: true, min: 1, max: 30 });
        if (Object.keys(sf.errors).length) f.errors[`services.${i}`] = Object.values(sf.errors)[0];
        services.push({ serviceId, quantity });
      });
      if (new Set(services.map((s) => s.serviceId)).size !== services.length) {
        f.errors.services = '같은 서비스는 한 번만 넣고 횟수를 늘려 주세요.';
      }
    }
    f.check();
    return this.reservations.create(me.id, { roomTypeId, checkIn, checkOut, petIds, services });
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() me: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.reservations.cancel(id, me.id);
  }
}

/** 어드민: 직원은 전체를 보고 상태를 바꾼다 */
@Controller('admin')
@UseGuards(AuthGuard)
@Roles('staff')
export class AdminReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Get('today')
  today() {
    return this.reservations.today();
  }

  @Get('availability')
  availability(@Query('date') date?: string) {
    if (date !== undefined && !isDateString(date)) reject('date는 YYYY-MM-DD 형식이어야 해요.');
    return this.reservations.availability(date ?? todayKst());
  }

  /** 이번 달 객실 종류별 매출. month를 주지 않으면 이번 달 */
  @Get('sales')
  sales(@Query('month') month?: string) {
    const m = month ?? todayKst().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) reject('month는 YYYY-MM 형식이어야 해요.');
    return this.reservations.sales(m);
  }

  @Get('reservations')
  list(@Query('status') status?: string, @Query('date') date?: string) {
    if (status !== undefined && !STATUSES.includes(status as Status)) reject(`status는 ${STATUSES.join(', ')} 중 하나예요.`);
    if (date !== undefined && !isDateString(date)) reject('date는 YYYY-MM-DD 형식이어야 해요.');
    return this.reservations.listAll({ status: status as Status | undefined, date });
  }

  @Get('reservations/:id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.reservations.get(id);
  }

  @Post('reservations/:id/check-in')
  @HttpCode(200)
  checkIn(@Param('id', ParseIntPipe) id: number) {
    return this.reservations.checkIn(id);
  }

  @Post('reservations/:id/check-out')
  @HttpCode(200)
  checkOut(@Param('id', ParseIntPipe) id: number) {
    return this.reservations.checkOut(id);
  }

  /** 노쇼나 전화 취소를 직원이 처리할 때 */
  @Post('reservations/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseIntPipe) id: number) {
    return this.reservations.cancel(id);
  }
}
