import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { join } from 'path';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TransfersModule } from './transfers/transfers.module';
import { NotificationsModule } from './notifications/notifications.module';
import { WalletModule } from './wallet/wallet.module';
import { FavoritesModule } from './favorites/favorites.module';
import { ReportsModule } from './reports/reports.module';
import { AuditModule } from './audit/audit.module';
import { MailModule } from './mail/mail.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      synchronize: true,
      ssl: { rejectUnauthorized: false },
    }),

    // ✅ إضافة تكوين MailerModule
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        transport: {
          host: configService.get<string>('MAIL_HOST'),
          port: configService.get<number>('MAIL_PORT'),
          secure: configService.get<boolean>('MAIL_SECURE') || false, // true للـ 465
          auth: {
            user: configService.get<string>('MAIL_USER'),
            pass: configService.get<string>('MAIL_PASSWORD'),
          },
        },
        defaults: {
          from: `"${configService.get<string>('MAIL_FROM_NAME') || 'No Reply'}" <${configService.get<string>('MAIL_FROM')}>`,
        },
        template: {
          dir: join(__dirname, 'templates'), // مجلد القوالب
          adapter: new HandlebarsAdapter(), // استخدام Handlebars للقوالب
          options: {
            strict: true,
          },
        },
      }),
    }),

    AuthModule, 
    UsersModule, 
    TransfersModule, 
    NotificationsModule,
    WalletModule, 
    FavoritesModule, 
    ReportsModule, 
    AuditModule, MailModule,
  ],
})
export class AppModule {}