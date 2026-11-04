import './env.js';
import { ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { DbService } from './db.service.js';

/** guardian = 코어 웹 고객(보호자), staff = 일반 직원, admin = 관리자 */
export type Role = 'guardian' | 'staff' | 'admin';
export interface AuthUser {
  kind: 'guardian' | 'staff';
  id: number;
  email: string;
  name: string;
  role: Role;
  mustChangePassword: boolean;
}

const TOKEN_HOURS = 12;

/** 비밀번호는 bcrypt로 되돌릴 수 없게 바꾼 값만 저장한다 (직원도 원문을 볼 수 없다) */
export const hashPassword = (password: string) => bcrypt.hash(password, 10);

/** 리셋·직원 생성 때 주는 임시 비밀번호. 헷갈리는 글자(0/O, 1/l)는 뺀다 */
export function temporaryPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 10 }, () => chars[randomInt(chars.length)]).join('');
}

@Injectable()
export class AuthService {
  constructor(private readonly db: DbService) {}

  private secret() {
    const s = process.env.AUTH_SECRET;
    if (!s || s.length < 16) throw new Error('AUTH_SECRET 설정값이 필요해요. (16자 이상)');
    return s;
  }

  private sign(payload: string) {
    return createHmac('sha256', this.secret()).update(payload).digest('base64url');
  }

  /** 로그인 성공 시 받는 "출입증". 고객인지 직원인지(k)와 id만 담는다 */
  private makeToken(kind: AuthUser['kind'], id: number) {
    const payload = Buffer.from(JSON.stringify({ k: kind, uid: id, exp: Date.now() + TOKEN_HOURS * 3600_000 })).toString(
      'base64url',
    );
    return `${payload}.${this.sign(payload)}`;
  }

  async userFromToken(token: string): Promise<AuthUser | null> {
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    const expected = this.sign(payload);
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    let data: { k?: string; uid?: number; exp?: number };
    try {
      data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    } catch {
      return null;
    }
    if (!Number.isInteger(data.uid) || !data.exp || data.exp < Date.now()) return null;
    // 역할·사용 여부는 토큰이 아니라 DB에서 매번 확인한다 (사용을 멈추면 바로 막힌다)
    if (data.k === 'guardian') return this.findGuardian(data.uid!);
    if (data.k === 'staff') {
      const s = await this.findStaff(data.uid!);
      return s?.isActive ? s.user : null;
    }
    return null;
  }

  private async findGuardian(id: number): Promise<AuthUser | null> {
    const { rows } = await this.db.pool.query(`SELECT id, email, name FROM guardian WHERE id = $1`, [id]);
    return rows[0] ? { kind: 'guardian', ...rows[0], role: 'guardian', mustChangePassword: false } : null;
  }

  private async findStaff(id: number) {
    const { rows } = await this.db.pool.query(
      `SELECT id, email, name, role, is_active, must_change_password FROM staff WHERE id = $1`,
      [id],
    );
    const s = rows[0];
    if (!s) return null;
    const user: AuthUser = {
      kind: 'staff',
      id: s.id,
      email: s.email,
      name: s.name,
      role: s.role,
      mustChangePassword: s.must_change_password,
    };
    return { user, isActive: s.is_active as boolean };
  }

  async signup(input: {
    email: string;
    password: string;
    name: string;
    phone: string;
    emergencyName: string;
    emergencyPhone: string;
  }) {
    try {
      const { rows } = await this.db.pool.query(
        `INSERT INTO guardian (email, password_hash, name, phone, emergency_name, emergency_phone)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [input.email, await hashPassword(input.password), input.name, input.phone, input.emergencyName, input.emergencyPhone],
      );
      const user = (await this.findGuardian(rows[0].id))!;
      return { token: this.makeToken('guardian', user.id), user };
    } catch (e) {
      if ((e as { constraint?: string }).constraint === 'guardian_email_key') {
        throw new ConflictException({ message: '이미 가입한 이메일이에요.' });
      }
      throw e;
    }
  }

  async loginGuardian(email: string, password: string) {
    const { rows } = await this.db.pool.query(`SELECT id, password_hash FROM guardian WHERE email = $1`, [email]);
    // 이메일이 틀렸는지 비밀번호가 틀렸는지는 알려 주지 않는다
    if (!rows[0] || !(await bcrypt.compare(password, rows[0].password_hash))) {
      throw new UnauthorizedException({ message: '이메일이나 비밀번호가 맞지 않아요.' });
    }
    const user = (await this.findGuardian(rows[0].id))!;
    return { token: this.makeToken('guardian', user.id), user };
  }

  async loginStaff(email: string, password: string) {
    const { rows } = await this.db.pool.query(`SELECT id, password_hash FROM staff WHERE email = $1`, [email]);
    if (!rows[0] || !(await bcrypt.compare(password, rows[0].password_hash))) {
      throw new UnauthorizedException({ message: '이메일이나 비밀번호가 맞지 않아요.' });
    }
    const s = (await this.findStaff(rows[0].id))!;
    if (!s.isActive) throw new ForbiddenException({ message: '사용이 중지된 계정이에요. 관리자에게 문의해 주세요.' });
    return { token: this.makeToken('staff', s.user.id), user: s.user };
  }

  async changePassword(user: AuthUser, currentPassword: string, newPassword: string) {
    const table = user.kind === 'guardian' ? 'guardian' : 'staff';
    const { rows } = await this.db.pool.query(`SELECT password_hash FROM ${table} WHERE id = $1`, [user.id]);
    if (!rows[0] || !(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
      throw new UnauthorizedException({ message: '지금 비밀번호가 맞지 않아요.' });
    }
    if (currentPassword === newPassword) {
      throw new ConflictException({ message: '지금과 다른 비밀번호를 입력해 주세요.' });
    }
    const hash = await hashPassword(newPassword);
    if (table === 'staff') {
      await this.db.pool.query(`UPDATE staff SET password_hash = $1, must_change_password = false WHERE id = $2`, [
        hash,
        user.id,
      ]);
    } else {
      await this.db.pool.query(`UPDATE guardian SET password_hash = $1 WHERE id = $2`, [hash, user.id]);
    }
    return { ok: true };
  }
}
