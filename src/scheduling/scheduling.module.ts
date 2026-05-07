import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SchedulingController } from './scheduling.controller';
import { SchedulingService } from './scheduling.service';
import { ScheduledTransfer } from './scheduled-transfer.entity';
import { User } from '../users/user.entity';
import { TransfersModule } from '../transfers/transfers.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ScheduledTransfer, User]),
    TransfersModule,
    NotificationsModule,
  ],
  controllers: [SchedulingController],
  providers: [SchedulingService],
  exports: [SchedulingService],
})
export class SchedulingModule {}