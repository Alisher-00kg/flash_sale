import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

describe('AuthService', () => {
  let service: AuthService;

  const usersService = {
    findByEmail: jest.fn(),
    create: jest.fn(),
  };

  const jwtService = {
    signAsync: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    it('should register a new user and return public fields', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
      usersService.create.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        role: 'USER',
        passwordHash: 'hashed-password',
      });

      await expect(
        service.register('user@example.com', 'password123'),
      ).resolves.toEqual({
        id: 'user-1',
        email: 'user@example.com',
        role: 'USER',
      });

      expect(usersService.findByEmail).toHaveBeenCalledWith('user@example.com');
      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 10);
      expect(usersService.create).toHaveBeenCalledWith(
        'user@example.com',
        'hashed-password',
      );
    });

    it('should throw ConflictException if the user already exists', async () => {
      usersService.findByEmail.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
      });

      await expect(
        service.register('user@example.com', 'password123'),
      ).rejects.toThrow(ConflictException);

      expect(bcrypt.hash).not.toHaveBeenCalled();
      expect(usersService.create).not.toHaveBeenCalled();
    });
    it('should propagate an error if password hashing fails', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockRejectedValue(new Error('Hashing failed'));

      await expect(
        service.register('user@example.com', 'password123'),
      ).rejects.toThrow('Hashing failed');

      expect(usersService.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    const user = {
      id: 'user-1',
      email: 'user@example.com',
      role: 'USER',
      passwordHash: 'hashed-password',
    };

    it('should return an access token and public user fields', async () => {
      usersService.findByEmail.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      jwtService.signAsync.mockResolvedValue('jwt-token');

      await expect(
        service.login('user@example.com', 'password123'),
      ).resolves.toEqual({
        accessToken: 'jwt-token',
        user: {
          id: 'user-1',
          email: 'user@example.com',
          role: 'USER',
        },
      });

      expect(bcrypt.compare).toHaveBeenCalledWith(
        'password123',
        'hashed-password',
      );
      expect(jwtService.signAsync).toHaveBeenCalledWith({
        sub: 'user-1',
        email: 'user@example.com',
        role: 'USER',
      });
    });

    it('should throw UnauthorizedException if the user does not exist', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        service.login('missing@example.com', 'password123'),
      ).rejects.toThrow(UnauthorizedException);

      expect(bcrypt.compare).not.toHaveBeenCalled();
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException if the password is incorrect', async () => {
      usersService.findByEmail.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login('user@example.com', 'wrong-password'),
      ).rejects.toThrow(UnauthorizedException);

      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });
  });
});
