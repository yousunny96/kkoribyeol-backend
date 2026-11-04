import './env.js';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import pg from 'pg';

// date 컬럼은 'YYYY-MM-DD' 문자열 그대로 받는다 (서버 시간대 때문에 날짜가 하루 밀리지 않게)
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
// id(bigint), count(*), 몸무게(numeric)는 숫자로 받는다
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));

// 테이블은 db/schema.sql로 미리 만든다. 서버는 hw2 공간만 본다
@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: true,
    max: 5,
    options: '-c search_path=hw2',
  });

  /** 여러 쿼리를 한 덩어리로 실행한다. 중간에 실패하면 모두 되돌린다 */
  async tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const result = await fn(c);
      await c.query('COMMIT');
      return result;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
