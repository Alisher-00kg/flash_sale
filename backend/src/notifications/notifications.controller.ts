import { Controller, Post } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('test')
  async sendTestEmail() {
    await this.notificationsService.sendEmail(
      'buyer@example.com',
      'Flash Sale — test email',
      'If you can see this message in MailHog, email delivery is working.',
    );

    return { message: 'Test email sent' };
  }
}
