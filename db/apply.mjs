// hw2 스키마를 만들고 기준 데이터와 첫 관리자 계정을 넣는다.
//   npm run apply   : hw2가 없을 때 한 번
//   npm run reset   : hw2를 지우고 처음부터 다시 (데이터가 모두 사라진다)
import { readFile } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import pg from 'pg';

process.loadEnvFile(new URL('../.env', import.meta.url));
const { DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME = '관리자' } = process.env;
if (!DATABASE_URL || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  throw new Error('.env에 DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD가 필요합니다');
}

const sql = (name) => readFile(new URL(name, import.meta.url), 'utf8');
const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

try {
  await client.query('BEGIN');
  if (process.argv.includes('--reset')) {
    await client.query('DROP SCHEMA IF EXISTS hw2 CASCADE');
  }
  await client.query(await sql('schema.sql'));
  await client.query(await sql('seed.sql'));
  await client.query(
    `INSERT INTO hw2.staff (email, password_hash, name, role) VALUES ($1, $2, $3, 'admin')`,
    [ADMIN_EMAIL.toLowerCase(), await bcrypt.hash(ADMIN_PASSWORD, 10), ADMIN_NAME],
  );
  await client.query('COMMIT');

  const { rows } = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'hw2' ORDER BY 1`,
  );
  console.log(`hw2 테이블 ${rows.length}개:`, rows.map((r) => r.table_name).join(', '));
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  await client.end();
}
