-- 꼬리별 예약·운영 관리 시스템 / hw2 스키마
-- 설계 근거: 꼬리별_설계결정.md
--
-- 규칙을 지키는 곳
--   DB      : 한 행만 보면 되는 규칙(CHECK), 중복 금지(UNIQUE), 같은 테이블 행끼리 겹침 금지(EXCLUDE)
--   백엔드  : 다른 테이블을 함께 봐야 하는 규칙(몸무게↔객실 종류, 같은 보호자, 최대 2마리),
--             날짜에 따라 결과가 바뀌는 규칙(접종 1년, 생후 5개월), 권한

-- 같은 방 날짜 겹침 금지(EXCLUDE)에서 bigint를 = 로 비교하려면 필요하다
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA hw2;
SET search_path TO hw2;

-- 고객 계정 겸 보호자 (결정 1: 한 테이블)
CREATE TABLE guardian (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email           text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash   text NOT NULL,
  name            text NOT NULL,
  phone           text NOT NULL,
  emergency_name  text NOT NULL,
  emergency_phone text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 직원 계정 (회원가입 없음, 관리자가 만든다)
CREATE TABLE staff (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email                text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash        text NOT NULL,
  name                 text NOT NULL,
  role                 text NOT NULL CHECK (role IN ('admin', 'staff')),
  is_active            boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pet (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  guardian_id       bigint NOT NULL REFERENCES guardian (id),
  name              text NOT NULL,
  species           text NOT NULL,
  birth_date        date NOT NULL,
  weight_kg         numeric(5, 2) NOT NULL CHECK (weight_kg > 0),
  -- 접종 기록이 아직 없는 아이도 등록은 할 수 있다. 예약할 때 백엔드가 막는다
  last_vaccine_date date CHECK (last_vaccine_date >= birth_date),
  last_rabies_date  date CHECK (last_rabies_date >= birth_date),
  food              text,
  allergy           text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pet_guardian_id_idx ON pet (guardian_id);

-- 몸무게 범위는 [min_weight, max_weight). 대형은 상한 없음(NULL) (결정 6)
CREATE TABLE room_type (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          text NOT NULL UNIQUE,
  min_weight    numeric(5, 2) NOT NULL CHECK (min_weight >= 0),
  max_weight    numeric(5, 2) CHECK (max_weight > min_weight),
  weekday_price integer NOT NULL CHECK (weekday_price > 0),
  weekend_price integer NOT NULL CHECK (weekend_price >= weekday_price),
  -- 객실 종류끼리 몸무게 범위가 겹치면 한 아이가 두 종류에 다 들어갈 수 있게 된다
  EXCLUDE USING gist (numrange(min_weight, max_weight) WITH &&)
);

CREATE TABLE room (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_type_id bigint NOT NULL REFERENCES room_type (id),
  room_no      text NOT NULL UNIQUE
);

-- 상태: booked(예약됨) / checked_in(입실) / checked_out(퇴실) / cancelled(취소, 노쇼 포함)
CREATE TABLE reservation (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- 누가 예약했는지는 예약 자체의 기록이다 (반려동물 주인이 바뀌어도 그대로)
  guardian_id    bigint NOT NULL REFERENCES guardian (id),
  room_id        bigint NOT NULL REFERENCES room (id),
  check_in       date NOT NULL,
  check_out      date NOT NULL,
  status         text NOT NULL DEFAULT 'booked'
                 CHECK (status IN ('booked', 'checked_in', 'checked_out', 'cancelled')),
  -- 예약 당시 단가. 요금표가 바뀌어도 지난 예약 금액은 그대로 (결정 3)
  weekday_rate   integer NOT NULL CHECK (weekday_rate > 0),
  weekend_rate   integer NOT NULL CHECK (weekend_rate > 0),
  checked_in_at  timestamptz,
  checked_out_at timestamptz,
  cancelled_on   date,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT reservation_dates_chk CHECK (check_out > check_in),

  -- 상태와 시각이 서로 맞아야 한다 (결정 4)
  CONSTRAINT reservation_status_times_chk CHECK (
    CASE status
      WHEN 'booked'      THEN checked_in_at IS NULL AND checked_out_at IS NULL AND cancelled_on IS NULL
      WHEN 'checked_in'  THEN checked_in_at IS NOT NULL AND checked_out_at IS NULL AND cancelled_on IS NULL
      WHEN 'checked_out' THEN checked_in_at IS NOT NULL AND checked_out_at >= checked_in_at AND cancelled_on IS NULL
      WHEN 'cancelled'   THEN cancelled_on IS NOT NULL AND checked_in_at IS NULL AND checked_out_at IS NULL
    END
  ),

  -- 같은 방은 날짜가 겹치게 예약할 수 없다. 체크아웃 날은 비어 있는 것으로 본다 [check_in, check_out) (결정 9)
  CONSTRAINT reservation_room_no_overlap EXCLUDE USING gist (
    room_id WITH =,
    daterange(check_in, check_out) WITH &&
  ) WHERE (status <> 'cancelled')
);
CREATE INDEX reservation_guardian_id_idx ON reservation (guardian_id);
CREATE INDEX reservation_check_in_idx ON reservation (check_in);
CREATE INDEX reservation_check_out_idx ON reservation (check_out);

-- 예약 ↔ 반려동물 (N:M). 최대 2마리, 같은 보호자인지는 백엔드가 확인한다
CREATE TABLE reservation_pet (
  reservation_id bigint NOT NULL REFERENCES reservation (id) ON DELETE CASCADE,
  pet_id         bigint NOT NULL REFERENCES pet (id),
  PRIMARY KEY (reservation_id, pet_id)
);
CREATE INDEX reservation_pet_pet_id_idx ON reservation_pet (pet_id);

CREATE TABLE service (
  id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name  text NOT NULL UNIQUE,
  price integer NOT NULL CHECK (price > 0)
);

-- 예약 ↔ 추가 서비스 (N:M). 횟수와 신청 당시 단가는 이 조합에만 붙는 값이다
CREATE TABLE reservation_service (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reservation_id bigint NOT NULL REFERENCES reservation (id) ON DELETE CASCADE,
  service_id     bigint NOT NULL REFERENCES service (id),
  quantity       integer NOT NULL CHECK (quantity > 0),
  unit_price     integer NOT NULL CHECK (unit_price >= 0),
  UNIQUE (reservation_id, service_id)
);
