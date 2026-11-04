// DB가 지키는 규칙과 지키지 않는 규칙을 확인한다.
// 하나의 트랜잭션 안에서 시험 데이터를 넣고, 끝나면 모두 ROLLBACK 한다 (실제 데이터는 남지 않음).
import pg from 'pg';

process.loadEnvFile(new URL('../.env', import.meta.url));
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const one = async (text, params) => (await client.query(text, params)).rows[0];
let failed = 0;

// expect: 'reject' 면 DB가 거절해야 통과, 'accept' 면 들어가야 통과
async function check(label, expect, text, params) {
  await client.query('SAVEPOINT t');
  let outcome;
  try {
    await client.query(text, params);
    outcome = 'accept';
  } catch (err) {
    outcome = 'reject';
    label += `  → ${err.code} ${err.constraint ?? err.message}`;
  }
  await client.query(outcome === 'accept' ? 'RELEASE SAVEPOINT t' : 'ROLLBACK TO SAVEPOINT t');
  const ok = outcome === expect;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${outcome === 'reject' ? 'DB 거절' : '들어감'}] ${label}`);
}

try {
  await client.query('BEGIN');
  await client.query('SET LOCAL search_path TO hw2');

  const kim = await one(`INSERT INTO guardian (email, password_hash, name, phone, emergency_name, emergency_phone)
    VALUES ('kim@test.com', 'x', '김철수', '010-1111-1111', '김부모', '010-1111-2222') RETURNING id`);
  const lee = await one(`INSERT INTO guardian (email, password_hash, name, phone, emergency_name, emergency_phone)
    VALUES ('lee@test.com', 'x', '이영희', '010-3333-3333', '이부모', '010-3333-4444') RETURNING id`);
  const choco = await one(`INSERT INTO pet (guardian_id, name, species, birth_date, weight_kg, last_vaccine_date, last_rabies_date)
    VALUES ($1, '초코', '개', '2023-01-01', 5, '2026-06-01', '2026-06-01') RETURNING id`, [kim.id]);
  const dubu = await one(`INSERT INTO pet (guardian_id, name, species, birth_date, weight_kg)
    VALUES ($1, '두부', '개', '2024-01-01', 4) RETURNING id`, [kim.id]);
  const bori = await one(`INSERT INTO pet (guardian_id, name, species, birth_date, weight_kg)
    VALUES ($1, '보리', '개', '2022-01-01', 6) RETURNING id`, [lee.id]);
  const room = await one(`SELECT id FROM room WHERE room_no = 'S-101'`);
  const resv = await one(`INSERT INTO reservation (guardian_id, room_id, check_in, check_out, weekday_rate, weekend_rate)
    VALUES ($1, $2, '2026-12-10', '2026-12-12', 40000, 50000) RETURNING id`, [kim.id, room.id]);
  await client.query(`INSERT INTO reservation_pet VALUES ($1, $2)`, [resv.id, choco.id]);

  const newResv = (checkIn, checkOut, extra = '') =>
    `INSERT INTO reservation (guardian_id, room_id, check_in, check_out, weekday_rate, weekend_rate${extra ? ', status, cancelled_on' : ''})
     VALUES (${kim.id}, ${room.id}, '${checkIn}', '${checkOut}', 40000, 50000${extra})`;

  console.log('\n── DB가 막아야 하는 것 ──');
  await check('이메일 중복', 'reject',
    `INSERT INTO guardian (email, password_hash, name, phone, emergency_name, emergency_phone)
     VALUES ('kim@test.com', 'x', '가짜', '010', '가', '010')`);
  await check('이메일 대문자', 'reject',
    `INSERT INTO staff (email, password_hash, name, role) VALUES ('Boss@Test.com', 'x', '가', 'staff')`);
  await check('직원 역할이 admin/staff 아님', 'reject',
    `INSERT INTO staff (email, password_hash, name, role) VALUES ('owner@test.com', 'x', '가', 'owner')`);
  await check('몸무게 0kg', 'reject',
    `INSERT INTO pet (guardian_id, name, species, birth_date, weight_kg) VALUES ($1, '가', '개', '2024-01-01', 0)`, [kim.id]);
  await check('체크아웃 = 체크인', 'reject', newResv('2026-12-20', '2026-12-20'));
  await check('같은 방 날짜 겹침 (12/11~12/13)', 'reject', newResv('2026-12-11', '2026-12-13'));
  await check('없는 상태값 noshow', 'reject',
    `UPDATE reservation SET status = 'noshow' WHERE id = $1`, [resv.id]);
  await check('입실인데 입실 시각 없음', 'reject',
    `UPDATE reservation SET status = 'checked_in' WHERE id = $1`, [resv.id]);
  await check('취소인데 취소 날짜 없음', 'reject',
    `UPDATE reservation SET status = 'cancelled' WHERE id = $1`, [resv.id]);
  await check('같은 예약에 같은 반려동물 두 번', 'reject',
    `INSERT INTO reservation_pet VALUES ($1, $2)`, [resv.id, choco.id]);
  await check('추가 서비스 횟수 0', 'reject',
    `INSERT INTO reservation_service (reservation_id, service_id, quantity, unit_price)
     VALUES ($1, (SELECT id FROM service WHERE name = '목욕'), 0, 30000)`, [resv.id]);
  await check('객실 종류 몸무게 범위 겹침 (10~20kg)', 'reject',
    `INSERT INTO room_type (name, min_weight, max_weight, weekday_price, weekend_price) VALUES ('특대', 10, 20, 90000, 100000)`);

  console.log('\n── 들어가야 하는 것 ──');
  await check('퇴실하는 날 같은 방 입실 (12/12~12/14)', 'accept', newResv('2026-12-12', '2026-12-14'));
  await check('취소된 예약과는 겹쳐도 됨', 'accept', newResv('2026-12-10', '2026-12-11', `, 'cancelled', '2026-12-01'`));
  await check('같은 보호자 두 마리 합방', 'accept', `INSERT INTO reservation_pet VALUES ($1, $2)`, [resv.id, dubu.id]);
  await check('입실 처리 (상태 + 시각)', 'accept',
    `UPDATE reservation SET status = 'checked_in', checked_in_at = now() WHERE id = $1`, [resv.id]);

  console.log('\n── DB는 통과시킨다 → 백엔드가 막아야 하는 것 ──');
  await check('남의 반려동물(보리)을 김철수 예약에 넣기 → 이 예약은 3마리가 됨', 'accept',
    `INSERT INTO reservation_pet VALUES ($1, $2)`, [resv.id, bori.id]);
  const big = await one(`INSERT INTO pet (guardian_id, name, species, birth_date, weight_kg)
    VALUES ($1, '태풍', '개', '2020-01-01', 25) RETURNING id`, [kim.id]);
  await check('25kg 태풍을 소형방(S-102) 예약에 넣기, 접종 기록도 없음', 'accept',
    `WITH r AS (
       INSERT INTO reservation (guardian_id, room_id, check_in, check_out, weekday_rate, weekend_rate)
       VALUES ($1, (SELECT id FROM room WHERE room_no = 'S-102'), '2026-12-10', '2026-12-12', 40000, 50000)
       RETURNING id)
     INSERT INTO reservation_pet SELECT id, $2 FROM r`, [kim.id, big.id]);
} finally {
  await client.query('ROLLBACK');
  await client.end();
}

console.log(failed ? `\n${failed}건 실패` : '\n모두 기대대로 동작 (시험 데이터는 ROLLBACK 됨)');
process.exitCode = failed ? 1 : 0;
