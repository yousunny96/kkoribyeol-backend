import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AllowBeforePasswordChange, AuthGuard, CurrentUser } from './auth.guard.js';
import { AuthService, type AuthUser } from './auth.service.js';
import { Fields } from './fields.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** 코어 웹 회원가입 (보호자). 직원은 회원가입이 없다 */
  @Post('signup')
  signup(@Body() body: unknown) {
    const f = new Fields(body);
    const input = {
      email: f.email(),
      password: f.password('password'),
      name: f.text('name', '이름', { max: 30 })!,
      phone: f.text('phone', '연락처', { max: 20 })!,
      emergencyName: f.text('emergencyName', '비상 연락처 이름', { max: 30 })!,
      emergencyPhone: f.text('emergencyPhone', '비상 연락처', { max: 20 })!,
    };
    f.check();
    return this.auth.signup(input);
  }

  /** 코어 웹 로그인 (보호자) */
  @Post('login')
  @HttpCode(200)
  login(@Body() body: unknown) {
    const f = new Fields(body);
    const email = f.email();
    const password = f.text('password', '비밀번호') ?? '';
    f.check();
    return this.auth.loginGuardian(email, password);
  }

  /** 어드민 로그인 (직원, 관리자) */
  @Post('staff/login')
  @HttpCode(200)
  staffLogin(@Body() body: unknown) {
    const f = new Fields(body);
    const email = f.email();
    const password = f.text('password', '비밀번호') ?? '';
    f.check();
    return this.auth.loginStaff(email, password);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @AllowBeforePasswordChange()
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Post('change-password')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @AllowBeforePasswordChange()
  changePassword(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const f = new Fields(body);
    const current = f.text('currentPassword', '지금 비밀번호') ?? '';
    const next = f.password('newPassword', '새 비밀번호');
    f.check();
    return this.auth.changePassword(user, current, next);
  }
}
