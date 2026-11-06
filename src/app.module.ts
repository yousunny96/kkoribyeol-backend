import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { DbService } from './db.service.js';
import { HealthController } from './health.controller.js';
import { PetsController } from './pets.controller.js';
import { AdminReservationsController, CatalogController, ReservationsController } from './reservations.controller.js';
import { ReservationsService } from './reservations.service.js';
import { RulesController } from './rules.controller.js';
import { StaffController } from './staff.controller.js';

@Module({
  controllers: [
    HealthController,
    AuthController,
    StaffController,
    CatalogController,
    PetsController,
    ReservationsController,
    AdminReservationsController,
    RulesController,
  ],
  providers: [DbService, AuthService, AuthGuard, ReservationsService],
})
export class AppModule {}
