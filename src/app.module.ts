import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TransfersModule } from './transfers/transfers.module';
import { NotificationsModule } from './notifications/notifications.module';
import { WalletModule } from './wallet/wallet.module';
import { FavoritesModule } from './favorites/favorites.module';
import { ReportsModule } from './reports/reports.module';
import { AuditModule } from './audit/audit.module';
import { SchedulingModule } from './scheduling/scheduling.module';

@Module({
  imports: [
    // تكوين المتغيرات البيئية
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // تكوين قاعدة البيانات
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'mysql',
        host: configService.get('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 3306),
        username: configService.get('DB_USERNAME', 'root'),
        password: configService.get('DB_PASSWORD', ''),
        database: configService.get('DB_DATABASE', 'money_transfer_db'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: configService.get('NODE_ENV') !== 'production',
        logging: configService.get('NODE_ENV') === 'development',
        charset: 'utf8mb4',
        timezone: '+00:00',
      }),
      inject: [ConfigService],
    }),

    // جدولة المهام
    ScheduleModule.forRoot(),

    // وحدات التطبيق
    AuthModule,
    UsersModule,
    TransfersModule,
    NotificationsModule,
    WalletModule,
    FavoritesModule,
    ReportsModule,
    AuditModule,
    SchedulingModule,
  ],
})
export class AppModule {}