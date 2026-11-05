-- DBeaver에서 과제 4번(DB 확인)을 캡처하기 위한 SQL
-- 실행 방법: 문장 하나에 커서를 두고 ⌘+Enter (한 문장씩 실행)
-- 마지막 "5. 정리"까지 실행하면 넣은 시험 데이터가 모두 지워진다

SET search_path TO hw2;


-- ============================================================
-- 1. 둘러보기
-- ============================================================

-- 테이블 9개
SELECT table_name FROM information_schema.tables WHERE table_schema = 'hw2' ORDER BY 1;

-- 객실 종류와 방
SELECT rt.name, rt.min_weight, rt.max_weight, rt.weekday_price, rt.weekend_price, r.room_no
FROM room_type rt JOIN room r ON r.room_type_id = rt.id
ORDER BY rt.min_weight, r.room_no;

-- 비밀번호가 어떤 모양으로 저장됐나 (원문이 아니라 bcrypt 해시 $2b$...)
SELECT email, role, password_hash FROM staff;


-- ============================================================
-- 2. 시험 데이터 준비 (보호자 2명, 반려동물 3마리, 예약 1건)
-- ============================================================

INSERT INTO guardian (email, password_hash, name, phone, emergency_name, emergency_phone) VALUES
  ('dbeaver-kim@test.com', 'x', '김철수', '010-1111-1111', '김가족', '010-1111-2222'),
  ('dbeaver-lee@test.com', 'x', '이영희', '010-3333-3333', '이가족', '010-3333-4444');

INSERT INTO pet (guardian_id, name, species, birth_date, weight_kg)
SELECT id, '초코', '말티즈', '2023-01-01'::date, 4 FROM guardian WHERE email = 'dbeaver-kim@test.com'
UNION ALL
SELECT id, '태풍', '리트리버', '2020-01-01'::date, 25 FROM guardian WHERE email = 'dbeaver-kim@test.com'
UNION ALL
SELECT id, '보리', '비숑', '2022-01-01'::date, 6 FROM guardian WHERE email = 'dbeaver-lee@test.com';

-- 김철수가 S-101을 12/10 ~ 12/12로 예약 (초코)
INSERT INTO reservation (guardian_id, room_id, check_in, check_out, weekday_rate, weekend_rate)
SELECT g.id, r.id, '2026-12-10', '2026-12-12', 40000, 50000
FROM guardian g, room r WHERE g.email = 'dbeaver-kim@test.com' AND r.room_no = 'S-101';

INSERT INTO reservation_pet (reservation_id, pet_id)
SELECT r.id, p.id FROM reservation r JOIN guardian g ON g.id = r.guardian_id JOIN pet p ON p.guardian_id = g.id
WHERE g.email = 'dbeaver-kim@test.com' AND p.name = '초코';


-- ============================================================
-- 3. DB가 거절하는 것 (하나씩 실행하고 오류 화면을 캡처)
-- ============================================================

-- 3-1. 같은 방 날짜 겹침 → reservation_room_no_overlap (EXCLUDE)
INSERT INTO reservation (guardian_id, room_id, check_in, check_out, weekday_rate, weekend_rate)
SELECT g.id, r.id, '2026-12-11', '2026-12-13', 40000, 50000
FROM guardian g, room r WHERE g.email = 'dbeaver-kim@test.com' AND r.room_no = 'S-101';

-- 3-2. 체크아웃이 체크인보다 빠르지 않음 → reservation_dates_chk (CHECK)
INSERT INTO reservation (guardian_id, room_id, check_in, check_out, weekday_rate, weekend_rate)
SELECT g.id, r.id, '2026-12-20', '2026-12-20', 40000, 50000
FROM guardian g, room r WHERE g.email = 'dbeaver-kim@test.com' AND r.room_no = 'S-102';

-- 3-3. 없는 상태값 → reservation_status_check (CHECK)
UPDATE reservation SET status = 'noshow'
WHERE guardian_id = (SELECT id FROM guardian WHERE email = 'dbeaver-kim@test.com');

-- 3-4. 입실로 바꾸면서 입실 시각을 안 남김 → reservation_status_times_chk (CHECK)
UPDATE reservation SET status = 'checked_in'
WHERE guardian_id = (SELECT id FROM guardian WHERE email = 'dbeaver-kim@test.com');

-- 3-5. 이메일 중복 → guardian_email_key (UNIQUE)
INSERT INTO guardian (email, password_hash, name, phone, emergency_name, emergency_phone)
VALUES ('dbeaver-kim@test.com', 'x', '가짜', '010', '가', '010');

-- 3-6. 몸무게 0kg → pet_weight_kg_check (CHECK)
INSERT INTO pet (guardian_id, name, species, birth_date, weight_kg)
SELECT id, '유령', '개', '2023-01-01', 0 FROM guardian WHERE email = 'dbeaver-kim@test.com';


-- ============================================================
-- 4. DB는 막지 못하고 들어가 버리는 것 → 그래서 백엔드가 막는다
--    (다른 테이블을 함께 봐야 판단할 수 있는 규칙)
-- ============================================================

-- 4-1. 김철수의 예약에 이영희의 반려동물(보리)을 넣기 → 들어감
INSERT INTO reservation_pet (reservation_id, pet_id)
SELECT r.id, p.id
FROM reservation r JOIN guardian g ON g.id = r.guardian_id, pet p
WHERE g.email = 'dbeaver-kim@test.com' AND p.name = '보리';

-- 4-2. 25kg 태풍을 소형방(S-102, 7kg 미만)에 넣기, 접종 기록도 없음 → 들어감
INSERT INTO reservation (guardian_id, room_id, check_in, check_out, weekday_rate, weekend_rate)
SELECT g.id, r.id, '2026-12-10', '2026-12-12', 40000, 50000
FROM guardian g, room r WHERE g.email = 'dbeaver-kim@test.com' AND r.room_no = 'S-102';

INSERT INTO reservation_pet (reservation_id, pet_id)
SELECT r.id, p.id
FROM reservation r JOIN room rm ON rm.id = r.room_id JOIN pet p ON p.guardian_id = r.guardian_id
WHERE rm.room_no = 'S-102' AND p.name = '태풍'
  AND r.guardian_id = (SELECT id FROM guardian WHERE email = 'dbeaver-kim@test.com');

-- 들어가 버린 결과 확인: 한 예약에 남의 반려동물, 소형방에 25kg
SELECT r.id AS reservation_id, rm.room_no, g.name AS 예약자, p.name AS 반려동물,
       owner.name AS 반려동물_주인, p.weight_kg
FROM reservation r
JOIN room rm ON rm.id = r.room_id
JOIN guardian g ON g.id = r.guardian_id
JOIN reservation_pet rp ON rp.reservation_id = r.id
JOIN pet p ON p.id = rp.pet_id
JOIN guardian owner ON owner.id = p.guardian_id
WHERE g.email = 'dbeaver-kim@test.com'
ORDER BY r.id, p.name;


-- ============================================================
-- 5. 정리 (시험 데이터 모두 지우기)
-- ============================================================

DELETE FROM reservation WHERE guardian_id IN (SELECT id FROM guardian WHERE email LIKE 'dbeaver-%@test.com');
DELETE FROM pet WHERE guardian_id IN (SELECT id FROM guardian WHERE email LIKE 'dbeaver-%@test.com');
DELETE FROM guardian WHERE email LIKE 'dbeaver-%@test.com';
