-- 기준 데이터. 첫 관리자 계정은 apply.mjs가 .env 값으로 넣는다 (비밀번호를 해시해야 해서)
SET search_path TO hw2;

-- 규정: 소형 7kg 미만 40,000원 / 중형 7~15kg 55,000원 / 대형 15kg 이상 70,000원, 주말 +10,000원
INSERT INTO room_type (name, min_weight, max_weight, weekday_price, weekend_price) VALUES
  ('소형', 0,  7,    40000, 50000),
  ('중형', 7,  15,   55000, 65000),
  ('대형', 15, NULL, 70000, 80000);

-- 소형 4개, 중형 3개, 대형 2개
INSERT INTO room (room_type_id, room_no)
SELECT rt.id, r.room_no
FROM (VALUES
  ('소형', 'S-101'), ('소형', 'S-102'), ('소형', 'S-103'), ('소형', 'S-104'),
  ('중형', 'M-201'), ('중형', 'M-202'), ('중형', 'M-203'),
  ('대형', 'L-301'), ('대형', 'L-302')
) AS r (type_name, room_no)
JOIN room_type rt ON rt.name = r.type_name;

-- 서비스 가격은 요구사항에 없어 가정한 값이다
INSERT INTO service (name, price) VALUES
  ('산책', 10000),
  ('목욕', 30000);
