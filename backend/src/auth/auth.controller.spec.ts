import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;

  const authService = {
    register: jest.fn(),
    login: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('register', () => {
    it('should call AuthService.register with email and password', async () => {
      const result = {
        id: 'user-1',
        email: 'user@example.com',
        role: 'USER',
      };

      authService.register.mockResolvedValue(result);

      await expect(
        controller.register({
          email: 'user@example.com',
          password: 'password123',
        }),
      ).resolves.toEqual(result);

      expect(authService.register).toHaveBeenCalledWith(
        'user@example.com',
        'password123',
      );
    });
  });

  describe('login', () => {
    it('should call AuthService.login with email and password', async () => {
      const result = {
        accessToken: 'jwt-token',
        user: {
          id: 'user-1',
          email: 'user@example.com',
          role: 'USER',
        },
      };

      authService.login.mockResolvedValue(result);

      await expect(
        controller.login({
          email: 'user@example.com',
          password: 'password123',
        }),
      ).resolves.toEqual(result);

      expect(authService.login).toHaveBeenCalledWith(
        'user@example.com',
        'password123',
      );
    });
  });
});
