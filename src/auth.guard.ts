import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService, type AuthUser, type Role } from './auth.service.js';

/** 이 역할만 들어올 수 있다. 'staff'를 허용하면 관리자도 들어온다. 붙이지 않으면 로그인한 사람 누구나 */
export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);

/** 임시 비밀번호로 로그인한 직원도 쓸 수 있는 곳 (내 정보, 비밀번호 변경) */
export const AllowBeforePasswordChange = () => SetMetadata('allowBeforePasswordChange', true);

/** 요청한 사람(로그인한 사용자)을 꺼내 쓴다 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().user as AuthUser;
});

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const user = token ? await this.auth.userFromToken(token) : null;
    if (!user) throw new UnauthorizedException({ message: '로그인이 필요해요. 다시 로그인해 주세요.' });

    const targets = [ctx.getHandler(), ctx.getClass()];
    if (user.mustChangePassword && !this.reflector.getAllAndOverride<boolean>('allowBeforePasswordChange', targets)) {
      throw new ForbiddenException({ message: '임시 비밀번호를 새 비밀번호로 바꿔 주세요.', code: 'MUST_CHANGE_PASSWORD' });
    }

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>('roles', targets);
    const allowed = !roles?.length || roles.includes(user.role) || (roles.includes('staff') && user.role === 'admin');
    if (!allowed) {
      const message =
        roles!.includes('guardian') && roles!.length === 1
          ? '고객만 쓸 수 있는 기능이에요.'
          : roles!.includes('admin') && !roles!.includes('staff')
            ? '관리자만 할 수 있는 일이에요.'
            : '직원만 쓸 수 있는 기능이에요.';
      throw new ForbiddenException({ message });
    }
    req.user = user;
    return true;
  }
}
