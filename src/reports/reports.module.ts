import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { Transfer } from '../transfers/transfer.entity';
import { User } from '../users/user.entity';
import { WalletTransaction } from '../wallet/transaction.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Transfer, User, WalletTransaction]),
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}