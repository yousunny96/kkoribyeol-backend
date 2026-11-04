import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

// 백엔드 검사를 빠져나가도 DB 제약이 마지막으로 막는다. 그때 500 대신 무엇에 걸렸는지 알려 준다
const MESSAGES: Record<string, string> = {
  reservation_room_no_overlap: '같은 방에 날짜가 겹치는 예약이 있어요.',
  reservation_dates_chk: '체크아웃은 체크인보다 늦어야 해요.',
  reservation_status_times_chk: '예약 상태와 입실·퇴실·취소 기록이 맞지 않아요.',
  reservation_pet_pkey: '같은 반려동물을 한 예약에 두 번 넣을 수 없어요.',
  guardian_email_key: '이미 가입한 이메일이에요.',
  staff_email_key: '이미 있는 직원 이메일이에요.',
};
const STATUS_BY_CODE: Record<string, number> = { '23505': 409, '23P01': 409, '23514': 400, '23503': 400, '23502': 400 };

@Catch()
export class DbErrorFilter implements ExceptionFilter {
  private readonly log = new Logger('Error');

  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (err instanceof HttpException) {
      res.status(err.getStatus()).json(err.getResponse());
      return;
    }
    const e = err as { code?: string; constraint?: string; message?: string };
    const status = e.code ? STATUS_BY_CODE[e.code] : undefined;
    if (status) {
      res.status(status).json({
        message: (e.constraint && MESSAGES[e.constraint]) ?? 'DB 규칙에 맞지 않아 저장하지 않았어요.',
        code: 'DB_CONSTRAINT',
        constraint: e.constraint,
      });
      return;
    }
    this.log.error(e.message, (err as Error).stack);
    res.status(500).json({ message: '서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.' });
  }
}
