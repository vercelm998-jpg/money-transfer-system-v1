import { 
  Controller, 
  Get, 
  Post,
  Body, 
  Param, 
  Query, 
  UseGuards,
  SetMetadata,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';

import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/roles.guard';
import { WalletService } from './wallet.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('المحفظة')
@Controller('wallet')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class WalletController {
  constructor(private walletService: WalletService) {}

  @Get('balance')
  @ApiOperation({ summary: 'الرصيد الحالي' })
  async getBalance(@CurrentUser() user: any) {
    return this.walletService.getBalance(user.id);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'سجل المعاملات' })
  async getTransactionHistory(
    @CurrentUser() user: any,
    @Query() query: any,
  ) {
    return this.walletService.getTransactionHistory(user.id, user.role, query);
  }

  @Get('transactions/:id')
  @ApiOperation({ summary: 'تفاصيل معاملة' })
  async getTransaction(
    @CurrentUser() user: any,
    @Param('id') id: number,
  ) {
    return this.walletService.getTransactionById(id, user.id, user.role);
  }

  @Get('summary')
  @ApiOperation({ summary: 'ملخص المحفظة' })
  async getTransactionSummary(
    @CurrentUser() user: any,
    @Query('period') period?: string,
  ) {
    return this.walletService.getTransactionSummary(user.id, period);
  }

  @Post('transactions/:id/refund')
  @UseGuards(RolesGuard)
  @SetMetadata('roles', ['admin'])
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'استرداد معاملة (للمسؤول فقط)' })
  async refundTransaction(
    @Param('id') id: number,
    @Body('reason') reason: string,
    @CurrentUser() admin: any,
  ) {
    return this.walletService.refundTransaction(id, reason, admin.id);
  }

  @Get('admin/transactions')
  @UseGuards(RolesGuard)
  @SetMetadata('roles', ['admin'])
  @ApiOperation({ summary: 'جميع معاملات المحفظة (للمسؤول فقط)' })
  async getAllTransactions(@Query() query: any) {
    return this.walletService.getTransactionHistory(null, 'admin', query);
  }

  @Get('admin/daily-report')
  @UseGuards(RolesGuard)
  @SetMetadata('roles', ['admin'])
  @ApiOperation({ summary: 'تقرير يومي للمحفظة (للمسؤول فقط)' })
  async getDailyReport(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.walletService.getDailyReport(
      new Date(startDate),
      new Date(endDate)
    );
  }
}