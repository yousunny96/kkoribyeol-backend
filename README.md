# 꼬리별 backend

반려동물 호텔 "꼬리별" 예약·운영 관리 API (NestJS + Render PostgreSQL `hw2` 스키마)

## 실행

```bash
npm install
cp .env.example .env   # 값 채우기
npm run db:apply       # hw2 스키마·기준 데이터·첫 관리자 (처음 한 번)
npm run start:dev      # http://localhost:4000
```

- `npm run db:verify` : DB 제약이 막는 것 / 못 막는 것 확인 (시험 데이터는 ROLLBACK)
- `npm run db:reset` : hw2를 지우고 다시 만든다 (데이터 모두 삭제)
- `npm test` : 숙박비·환불 계산 단위 테스트

Render 배포: Build `npm install && npm run build`, Start `npm run start:prod`, 환경변수는 `.env.example` 참고.

## 인증

로그인하면 `token`이 나온다. 이후 요청에 `Authorization: Bearer <token>` 헤더를 붙인다.
역할은 `guardian`(코어 웹 고객) / `staff`(일반 직원) / `admin`(관리자).
임시 비밀번호로 로그인한 직원은 `user.mustChangePassword = true`이고, 비밀번호를 바꾸기 전에는 다른 API가 `403 MUST_CHANGE_PASSWORD`를 돌려준다.

오류 응답: `{ message, code?, errors? }` — `errors`는 칸별 입력 오류 (`{ email: '...' }`).

## API

| 메서드 | 경로 | 누가 | 설명 |
|---|---|---|---|
| GET | `/health` | 누구나 | 서버·DB 상태 |
| POST | `/auth/signup` | 누구나 | 보호자 회원가입 `{email, password, name, phone, emergencyName, emergencyPhone}` |
| POST | `/auth/login` | 누구나 | 보호자 로그인 `{email, password}` |
| POST | `/auth/staff/login` | 누구나 | 직원 로그인 `{email, password}` |
| GET | `/auth/me` | 로그인 | 내 정보 |
| POST | `/auth/change-password` | 로그인 | `{currentPassword, newPassword}` |
| GET | `/services` | 누구나 | 추가 서비스 목록 |
| GET | `/availability?date=YYYY-MM-DD` | 누구나 | 객실 종류별 몸무게 기준·요금·빈 방 수 |
| GET | `/pets` | 보호자 | 내 반려동물 |
| POST | `/pets` | 보호자 | `{name, species, birthDate, weightKg, lastVaccineDate?, lastRabiesDate?, food?, allergy?}` |
| GET·PATCH | `/pets/:id` | 보호자 | 내 반려동물 보기·고치기 |
| GET | `/reservations` | 보호자 | 내 예약 (금액·환불 포함) |
| POST | `/reservations` | 보호자 | `{roomTypeId, checkIn, checkOut, petIds: [1~2개], services: [{serviceId, quantity}]}` — 빈 방은 자동 배정 |
| GET | `/reservations/:id` | 보호자 | 내 예약 상세 |
| POST | `/reservations/:id/cancel` | 보호자 | 취소 → `refund` |
| GET | `/admin/today` | 직원 | 오늘 입실·퇴실 예정 (사료·알레르기·비상 연락처) |
| GET | `/admin/availability?date=` | 직원 | 빈 방 수 |
| GET | `/admin/sales?month=YYYY-MM` | 직원 | 객실 종류별 매출 (숙박한 밤 + 서비스 + 위약금) |
| GET | `/admin/reservations?status=&date=` | 직원 | 전체 예약 |
| GET | `/admin/reservations/:id` | 직원 | 예약 상세 |
| POST | `/admin/reservations/:id/check-in` | 직원 | 입실 처리 (숙박 기간 안에만) |
| POST | `/admin/reservations/:id/check-out` | 직원 | 퇴실 처리 |
| POST | `/admin/reservations/:id/cancel` | 직원 | 취소·노쇼 처리 |
| GET | `/admin/staff` | 관리자 | 직원 목록 |
| POST | `/admin/staff` | 관리자 | `{email, name, role}` → `temporaryPassword` |
| PATCH | `/admin/staff/:id` | 관리자 | `{name?, role?, isActive?}` |
| POST | `/admin/staff/:id/reset-password` | 관리자 | → `temporaryPassword` |

예약 상태값: `booked`(예약됨) `checked_in`(입실) `checked_out`(퇴실) `cancelled`(취소)

## 백엔드가 거절하는 규칙 (`code`)

| code | 규칙 |
|---|---|
| `NOT_OWN_PET` (403) | 내 반려동물만 예약 |
| `WEIGHT_MISMATCH` | 무거운 쪽 몸무게가 객실 종류 기준에 맞아야 함 |
| `TOO_YOUNG` | 체크인 날 생후 5개월 이상 |
| `VACCINE_MISSING` / `VACCINE_EXPIRED` | 체크인 날 기준 종합백신·광견병 1년 이내 |
| `PET_ALREADY_BOOKED` | 같은 반려동물이 겹치는 기간에 다른 예약 |
| `NO_ROOM` (409) | 그 기간 그 종류에 빈 방 없음 |
| `INVALID_STATUS` | 상태 순서 (예약됨 → 입실 → 퇴실, 예약됨 → 취소) |
| `MUST_CHANGE_PASSWORD` (403) | 임시 비밀번호 변경 전 |
| `DB_CONSTRAINT` | 백엔드를 빠져나가도 DB 제약이 막은 경우 |
