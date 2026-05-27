import { Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class MailService {
  constructor(private mailerService: MailerService) {}

  async sendEmail(to: string, subject: string, text: string, html?: string) {
    try {
      const result = await this.mailerService.sendMail({
        to,
        subject,
        text,
        html: html || text,
      });
      console.log('تم إرسال البريد بنجاح:', result.messageId);
      return result;
    } catch (error) {
      console.error('خطأ في إرسال البريد:', error);
      throw error;
    }
  }

  // إرسال بريد ترحيبي
  async sendWelcomeEmail(to: string, name: string) {
    return this.sendEmail(
      to,
      'مرحباً بك في منصتنا',
      `مرحباً ${name}،
      
نرحب بك في منصتنا. يسعدنا انضمامك إلينا.

تحياتنا،
فريق الدعم`,
      `<h1>مرحباً ${name}!</h1>
       <p>نرحب بك في منصتنا. يسعدنا انضمامك إلينا.</p>
       <p>تحياتنا،<br>فريق الدعم</p>`,
    );
  }
}