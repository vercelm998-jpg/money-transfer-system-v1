import { Controller, Post, Body } from '@nestjs/common';
import { MailService } from './mail.service';

class SendEmailDto {
  to: string;
  subject: string;
  message: string;
}

@Controller('mail')
export class MailController {
  constructor(private readonly mailService: MailService) {}

  @Post('send')
  async sendEmail(@Body() body: SendEmailDto) {
    await this.mailService.sendEmail(
      body.to,
      body.subject,
      body.message,
      `<p>${body.message}</p>`,
    );
    return { status: 'ok', message: 'تم إرسال البريد بنجاح' };
  }

  @Post('welcome')
  async sendWelcome(@Body() body: { email: string; name: string }) {
    await this.mailService.sendWelcomeEmail(body.email, body.name);
    return { status: 'ok', message: 'تم إرسال البريد الترحيبي' };
  }
}