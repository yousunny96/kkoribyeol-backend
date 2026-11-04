import { Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser, Roles } from './auth.guard.js';
import type { AuthUser } from './auth.service.js';
import { todayKst } from './dates.js';
import { DbService } from './db.service.js';
import { Fields } from './fields.js';

export const PET_COLUMNS = `id, name, species, birth_date AS "birthDate", weight_kg AS "weightKg",
  last_vaccine_date AS "lastVaccineDate", last_rabies_date AS "lastRabiesDate", food, allergy`;

/** 반려동물 입력값 검사. 수정할 때는 보낸 칸만 검사한다 */
function readPet(body: unknown, partial: boolean) {
  const f = new Fields(body);
  const today = todayKst();
  const pick = <T>(key: string, read: () => T) => (partial && !f.has(key) ? undefined : read());
  const pet = {
    name: pick('name', () => f.text('name', '이름', { max: 30 })),
    species: pick('species', () => f.text('species', '종', { max: 30 })),
    birthDate: pick('birthDate', () => f.date('birthDate', '생년월일')),
    weightKg: pick('weightKg', () => f.number('weightKg', '몸무게', { min: 0.1, max: 100 })),
    lastVaccineDate: pick('lastVaccineDate', () => f.date('lastVaccineDate', '종합백신 접종일', { optional: true })),
    lastRabiesDate: pick('lastRabiesDate', () => f.date('lastRabiesDate', '광견병 접종일', { optional: true })),
    food: pick('food', () => f.text('food', '사료', { optional: true, max: 200 })),
    allergy: pick('allergy', () => f.text('allergy', '알레르기', { optional: true, max: 200 })),
  };
  for (const key of ['birthDate', 'lastVaccineDate', 'lastRabiesDate'] as const) {
    if (pet[key] && pet[key]! > today) f.errors[key] = '오늘 이후 날짜는 입력할 수 없어요.';
  }
  // 수정 때 생년월일을 보내지 않았으면 DB의 CHECK가 마지막으로 막는다
  for (const key of ['lastVaccineDate', 'lastRabiesDate'] as const) {
    if (pet[key] && pet.birthDate && pet[key]! < pet.birthDate) f.errors[key] = '접종일은 생년월일보다 빠를 수 없어요.';
  }
  f.check();
  return pet;
}

/** 보호자가 자기 반려동물을 등록하고 고친다 */
@Controller('pets')
@UseGuards(AuthGuard)
@Roles('guardian')
export class PetsController {
  constructor(private readonly db: DbService) {}

  @Get()
  async list(@CurrentUser() me: AuthUser) {
    const { rows } = await this.db.pool.query(`SELECT ${PET_COLUMNS} FROM pet WHERE guardian_id = $1 ORDER BY id`, [me.id]);
    return rows;
  }

  @Post()
  async create(@CurrentUser() me: AuthUser, @Body() body: unknown) {
    const p = readPet(body, false);
    const { rows } = await this.db.pool.query(
      `INSERT INTO pet (guardian_id, name, species, birth_date, weight_kg, last_vaccine_date, last_rabies_date, food, allergy)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${PET_COLUMNS}`,
      [me.id, p.name, p.species, p.birthDate, p.weightKg, p.lastVaccineDate, p.lastRabiesDate, p.food, p.allergy],
    );
    return rows[0];
  }

  @Patch(':id')
  async update(@CurrentUser() me: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    const p = readPet(body, true);
    const sets: string[] = [];
    const values: unknown[] = [id, me.id];
    const columns = {
      name: 'name',
      species: 'species',
      birthDate: 'birth_date',
      weightKg: 'weight_kg',
      lastVaccineDate: 'last_vaccine_date',
      lastRabiesDate: 'last_rabies_date',
      food: 'food',
      allergy: 'allergy',
    } as const;
    for (const [key, column] of Object.entries(columns)) {
      const v = p[key as keyof typeof p];
      if (v !== undefined) {
        values.push(v);
        sets.push(`${column} = $${values.length}`);
      }
    }
    if (!sets.length) return this.get(me, id);
    // 다른 보호자의 반려동물은 고칠 수 없다 (guardian_id 조건)
    const { rows } = await this.db.pool.query(
      `UPDATE pet SET ${sets.join(', ')} WHERE id = $1 AND guardian_id = $2 RETURNING ${PET_COLUMNS}`,
      values,
    );
    if (!rows[0]) throw new NotFoundException({ message: '내 반려동물 중에 없어요.' });
    return rows[0];
  }

  @Get(':id')
  async get(@CurrentUser() me: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const { rows } = await this.db.pool.query(`SELECT ${PET_COLUMNS} FROM pet WHERE id = $1 AND guardian_id = $2`, [
      id,
      me.id,
    ]);
    if (!rows[0]) throw new NotFoundException({ message: '내 반려동물 중에 없어요.' });
    return rows[0];
  }
}
