import { Test, TestingModule } from '@nestjs/testing';
import * as nodemailer from 'nodemailer';
import { NotificationsService } from './notifications.service';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

describe('NotificationsService', () => {
  let service: NotificationsService;
  let sendMail: jest.Mock;

  beforeEach(async () => {
    sendMail = jest.fn().mockResolvedValue({ messageId: 'test-message' });

    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [NotificationsService],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should send an email with the provided details', async () => {
    await expect(
      service.sendEmail('user@example.com', 'Test subject', 'Test message'),
    ).resolves.toBeUndefined();

    expect(sendMail).toHaveBeenCalledWith({
      from: process.env.MAIL_FROM ?? 'flash-sale@example.com',
      to: 'user@example.com',
      subject: 'Test subject',
      text: 'Test message',
    });
  });

  it('should log and rethrow an error when sending fails', async () => {
    const error = new Error('SMTP unavailable');
    sendMail.mockRejectedValue(error);

    await expect(
      service.sendEmail('user@example.com', 'Test subject', 'Test message'),
    ).rejects.toBe(error);
  });
});
