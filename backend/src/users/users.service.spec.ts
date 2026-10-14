import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

describe('UsersService', () => {
  let service: UsersService;

  const prisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findByEmail', () => {
    it('should find a user by email', async () => {
      const user = {
        id: 'user-1',
        email: 'user@example.com',
        passwordHash: 'hashed-password',
      };

      prisma.user.findUnique.mockResolvedValue(user);

      await expect(service.findByEmail('user@example.com')).resolves.toEqual(
        user,
      );

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'user@example.com' },
      });
    });

    it('should return null when the user is not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.findByEmail('missing@example.com'),
      ).resolves.toBeNull();
    });

    it('should propagate Prisma errors', async () => {
      const error = new Error('Database error');
      prisma.user.findUnique.mockRejectedValue(error);

      await expect(service.findByEmail('user@example.com')).rejects.toThrow(
        'Database error',
      );
    });
  });

  describe('findById', () => {
    it('should find a user by id', async () => {
      const user = {
        id: 'user-1',
        email: 'user@example.com',
        passwordHash: 'hashed-password',
      };

      prisma.user.findUnique.mockResolvedValue(user);

      await expect(service.findById('user-1')).resolves.toEqual(user);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
    });

    it('should return null when the user is not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findById('missing-user')).resolves.toBeNull();
    });
  });

  describe('create', () => {
    it('should create a user with email and password hash', async () => {
      const user = {
        id: 'user-1',
        email: 'user@example.com',
        passwordHash: 'hashed-password',
      };

      prisma.user.create.mockResolvedValue(user);

      await expect(
        service.create('user@example.com', 'hashed-password'),
      ).resolves.toEqual(user);

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: 'user@example.com',
          passwordHash: 'hashed-password',
        },
      });
    });

    it('should propagate Prisma errors', async () => {
      prisma.user.create.mockRejectedValue(new Error('Create failed'));

      await expect(
        service.create('user@example.com', 'hashed-password'),
      ).rejects.toThrow('Create failed');
    });
  });
});
