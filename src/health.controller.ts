import { Controller, Get } from '@nestjs/common';
import { DbService } from './db.service.js';

/** Render가 서버가 살아 있는지 확인하고, 발표 전에 잠든 서버를 깨울 때 연다 */
@Controller()
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Get(['', 'health'])
  async health() {
    const { rows } = await this.db.pool.query(`SELECT count(*) AS rooms FROM room`);
    return { ok: true, service: '꼬리별 backend', rooms: rows[0].rooms };
  }
}
