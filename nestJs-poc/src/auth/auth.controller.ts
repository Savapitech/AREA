import { Body, Controller, Post, Headers, Get,  UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { JwtService } from '@nestjs/jwt';
import { AuthDto } from './auth.dto.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly jwtService: JwtService,
  ) {}

  @Post('register')
  register(@Body() dto: AuthDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  login(@Body() dto: AuthDto) {
    return this.authService.login(dto);
  }

  @Get('me')
  async me(@Headers('authorization') authorization?: string) {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;

    if (!token) {
      throw new UnauthorizedException();
    }

    try {
      const payload = await this.jwtService.verifyAsync(token);

      return {
        id: payload.sub,
        email: payload.email,
      };
    } catch {
      throw new UnauthorizedException();
    }
  }
}
