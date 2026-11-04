import { BadRequestException } from '@nestjs/common';
import { isDateString } from './dates.js';

/** 요청 본문을 칸별로 검사하고, 틀린 칸은 모아서 한 번에 알려 준다 */
export class Fields {
  readonly errors: Record<string, string> = {};
  private readonly body: Record<string, unknown>;

  constructor(body: unknown) {
    this.body = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  }

  has(key: string) {
    return this.body[key] !== undefined;
  }

  text(key: string, label: string, opts: { optional?: boolean; max?: number } = {}) {
    const v = this.body[key];
    const s = typeof v === 'string' ? v.trim() : '';
    if (!s) {
      if (!opts.optional) this.errors[key] = `${label}을(를) 입력해 주세요.`;
      return null;
    }
    if (s.length > (opts.max ?? 100)) this.errors[key] = `${label}은(는) ${opts.max ?? 100}자 이하로 입력해 주세요.`;
    return s;
  }

  email(key = 'email') {
    const s = this.text(key, '이메일', { max: 200 });
    if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) this.errors[key] = '이메일 형식이 아니에요.';
    return s?.toLowerCase() ?? '';
  }

  password(key: string, label = '비밀번호') {
    const v = this.body[key];
    const s = typeof v === 'string' ? v : '';
    if (s.length < 8) this.errors[key] = `${label}는 8자 이상이어야 해요.`;
    return s;
  }

  date(key: string, label: string, opts: { optional?: boolean } = {}) {
    const v = this.body[key];
    if ((v === undefined || v === null || v === '') && opts.optional) return null;
    if (!isDateString(v)) {
      this.errors[key] = `${label}을(를) YYYY-MM-DD 형식으로 입력해 주세요.`;
      return null;
    }
    return v;
  }

  number(key: string, label: string, opts: { min?: number; max?: number; int?: boolean } = {}) {
    const n = Number(this.body[key]);
    if (this.body[key] === '' || this.body[key] === null || !Number.isFinite(n) || (opts.int && !Number.isInteger(n))) {
      this.errors[key] = `${label}을(를) 숫자로 입력해 주세요.`;
      return 0;
    }
    if (opts.min !== undefined && n < opts.min) this.errors[key] = `${label}은(는) ${opts.min} 이상이어야 해요.`;
    if (opts.max !== undefined && n > opts.max) this.errors[key] = `${label}은(는) ${opts.max} 이하여야 해요.`;
    return n;
  }

  idList(key: string, label: string, opts: { min: number; max: number }) {
    const v = this.body[key];
    const ids = Array.isArray(v) ? v.map(Number) : [];
    if (!Array.isArray(v) || ids.some((n) => !Number.isInteger(n) || n <= 0)) {
      this.errors[key] = `${label}을(를) 골라 주세요.`;
    } else if (new Set(ids).size !== ids.length) {
      this.errors[key] = `같은 ${label}을(를) 두 번 고를 수 없어요.`;
    } else if (ids.length < opts.min || ids.length > opts.max) {
      this.errors[key] = `${label}은(는) ${opts.min}~${opts.max}개까지 고를 수 있어요.`;
    }
    return ids;
  }

  oneOf<T extends string>(key: string, label: string, options: readonly T[]) {
    const v = this.body[key];
    if (typeof v !== 'string' || !options.includes(v as T)) {
      this.errors[key] = `${label}은(는) ${options.join(', ')} 중 하나여야 해요.`;
      return options[0];
    }
    return v as T;
  }

  bool(key: string, label: string) {
    const v = this.body[key];
    if (typeof v !== 'boolean') this.errors[key] = `${label}은(는) true/false여야 해요.`;
    return v === true;
  }

  raw(key: string) {
    return this.body[key];
  }

  /** 틀린 칸이 있으면 400으로 돌려보낸다 */
  check() {
    if (Object.keys(this.errors).length) {
      throw new BadRequestException({ message: '입력한 내용을 다시 확인해 주세요.', errors: this.errors });
    }
  }
}

/** 업무 규칙에 어긋날 때 (백엔드가 거절) */
export function reject(message: string, code?: string): never {
  throw new BadRequestException({ message, code });
}
