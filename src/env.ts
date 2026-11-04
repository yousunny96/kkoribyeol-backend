// .env 파일을 가장 먼저 읽는다. (ES 모듈은 import가 먼저 실행되므로, 환경변수를 쓰는 파일이 맨 위에서 이 파일을 불러온다)
try {
  process.loadEnvFile('.env');
} catch {
  // .env가 없으면 서버 환경변수를 그대로 쓴다 (Render 등)
}

export {};
