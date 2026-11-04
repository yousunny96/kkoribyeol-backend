import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser, Roles } from './auth.guard.js';
import { hashPassword, temporaryPassword, type AuthUser } from './auth.service.js';
import { DbService } from './db.service.js';
import { Fields, reject } from './fields.js';

const STAFF_COLUMNS = `id, email, name, role, is_active AS "isActive", must_change_password AS "mustChangePassword", created_at AS "createdAt"`;

/** 직원 계정 관리는 관리자만 한다 */
@Controller('admin/staff')
@UseGuards(AuthGuard)
@Roles('admin')
export class StaffController {
  constructor(private readonly db: DbService) {}

  @Get()
  async list() {
    const { rows } = await this.db.pool.query(`SELECT ${STAFF_COLUMNS} FROM staff ORDER BY id`);
    return rows;
  }

  /** 계정을 만들면 임시 비밀번호가 한 번만 나온다. 직원은 첫 로그인 때 바꿔야 한다 */
  @Post()
  async create(@Body() body: unknown) {
    const f = new Fields(body);
    const email = f.email();
    const name = f.text('name', '이름', { max: 30 })!;
    const role = f.oneOf('role', '역할', ['staff', 'admin'] as const);
    f.check();

    const password = temporaryPassword();
    try {
      const { rows } = await this.db.pool.query(
        `INSERT INTO staff (email, password_hash, name, role, must_change_password)
         VALUES ($1, $2, $3, $4, true) RETURNING ${STAFF_COLUMNS}`,
        [email, await hashPassword(password), name, role],
      );
      return { staff: rows[0], temporaryPassword: password };
    } catch (e) {
      if ((e as { constraint?: string }).constraint === 'staff_email_key') reject('이미 있는 직원 이메일이에요.');
      throw e;
    }
  }

  /** 이름, 역할, 사용 여부를 고친다. 자기 자신을 멈추거나 일반 직원으로 내릴 수는 없다 (관리자가 아무도 없게 되는 것을 막음) */
  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    const f = new Fields(body);
    const name = f.has('name') ? f.text('name', '이름', { max: 30 }) : undefined;
    const role = f.has('role') ? f.oneOf('role', '역할', ['staff', 'admin'] as const) : undefined;
    const isActive = f.has('isActive') ? f.bool('isActive', '사용 여부') : undefined;
    f.check();
    if (id === me.id && (isActive === false || role === 'staff')) {
      reject('자기 계정은 사용을 멈추거나 일반 직원으로 바꿀 수 없어요.');
    }

    const { rows } = await this.db.pool.query(
      `UPDATE staff SET
         name = COALESCE($2, name),
         role = COALESCE($3, role),
         is_active = COALESCE($4, is_active)
       WHERE id = $1 RETURNING ${STAFF_COLUMNS}`,
      [id, name ?? null, role ?? null, isActive ?? null],
    );
    if (!rows[0]) throw new NotFoundException({ message: '없는 직원이에요.' });
    return rows[0];
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  async resetPassword(@Param('id', ParseIntPipe) id: number) {
    const password = temporaryPassword();
    const { rows } = await this.db.pool.query(
      `UPDATE staff SET password_hash = $2, must_change_password = true WHERE id = $1 RETURNING ${STAFF_COLUMNS}`,
      [id, await hashPassword(password)],
    );
    if (!rows[0]) throw new NotFoundException({ message: '없는 직원이에요.' });
    return { staff: rows[0], temporaryPassword: password };
  }
}
