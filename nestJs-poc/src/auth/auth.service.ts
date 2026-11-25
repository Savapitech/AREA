import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from './user.entity.js';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { AuthDto } from './auth.dto.js';
import * as bcrypt from 'bcrypt'

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly JwtService: JwtService,
  ) {}

  async register(dto: AuthDto) {
    const existing = await this.users.findOneBy({
      email: dto.email,
    });

    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = this.users.create({
      email: dto.email,
      passwordHash,
    });
    
    try {
      const saved = await this.users.save(user);
      return {
        id: saved.id,
        email: saved.email,
      };
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
        throw new ConflictException('Email already registered');
      }

      throw error;
    }
  }

  async login(dto: AuthDto) {
    const user = await this.users.findOneBy({
      email: dto.email,
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const access_token = await this.JwtService.signAsync({
      sub: user.id,
      email: user.email,
    });

    return {access_token};
  }
}
