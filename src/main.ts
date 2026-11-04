import './env.js';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { DbErrorFilter } from './db-error.filter.js';

const app = await NestFactory.create(AppModule);
// 코어 웹과 어드민 두 주소를 쉼표로 이어서 넣는다
const origins = (process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000,http://localhost:3001')
  .split(',')
  .map((o) => o.trim());
app.enableCors({ origin: origins });
app.useGlobalFilters(new DbErrorFilter());
await app.listen(process.env.PORT ?? 4000);
