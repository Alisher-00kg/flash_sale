import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

describe('UsersController', () => {
  let controller: UsersController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getMe', () => {
    it('should return the authenticated user from the request', () => {
      const user = {
        id: 'user-1',
        email: 'user@example.com',
        role: 'USER',
      };

      const request = { user };

      expect(controller.getMe(request)).toBe(user);
    });

    it('should return undefined when request has no user', () => {
      const request = {};

      expect(controller.getMe(request)).toBeUndefined();
    });
  });
});
