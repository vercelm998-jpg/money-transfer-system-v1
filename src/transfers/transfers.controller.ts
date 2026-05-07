import { 
  Controller, 
  Get, 
  Post, 
  Delete, 
  Body, 
  Param, 
  Query, 
  UseGuards,
  SetMetadata,
  HttpCode,
  HttpStatus,
  Request
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';

import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/roles.guard';
import { TransfersService } from './transfers.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('التحويلات')
@Controller('transfers')
export class TransfersController {
  constructor(private transfersService: TransfersService) {}

  @Post()
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'إنشاء تحويل جديد' })
  @ApiResponse({ status: 201, description: 'تم التحويل بنجاح' })
  @ApiResponse({ status: 400, description: 'بيانات غير صحيحة أو رصيد غير كافي' })
  async createTransfer(
    @CurrentUser() user: any,
    @Body() createTransferDto: CreateTransferDto,
    @Request() req: any,
  ) {
    const metadata = {
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.headers['user-agent'],
      createdBy: user.username,
    };

    return this.transfersService.createTransfer(user.id, createTransferDto, metadata);
  }

  @Get('history')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'سجل التحويلات للمستخدم الحالي' })
  async getMyTransferHistory(
    @CurrentUser() user: any,
    @Query() filters: any,
  ) {
    return this.transfersService.getTransferHistory(user.id, user.role, filters);
  }

  @Get('pending-delivery')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'التحويلات التي لم يتم تأكيد استلامها بعد' })
  async getPendingDelivery(@CurrentUser() user: any) {
    return this.transfersService.getPendingDeliveryTransfers(user.id);
  }

  @Get('delivery-stats')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'إحصائيات تأكيد التسليم' })
  async getDeliveryStats(@CurrentUser() user: any) {
    return this.transfersService.getDeliveryStats(user.id);
  }

  @Get('all')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @SetMetadata('roles', ['admin', 'moderator'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'جميع التحويلات (للمسؤولين)' })
  async getAllTransfers(@Query() filters: any) {
    return this.transfersService.getTransferHistory(null, 'admin', filters);
  }

  @Get('reference/:reference')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'البحث عن تحويل برقم المرجع' })
  async getByReference(
    @CurrentUser() user: any,
    @Param('reference') reference: string,
  ) {
    const transfer = await this.transfersService.findByReference(reference);
    
    // التحقق من الصلاحية
    if (user.role !== 'admin' && user.role !== 'moderator' &&
        transfer.sender.id !== user.id &&
        transfer.receiver.id !== user.id) {
      return { message: 'غير مصرح لك بمشاهدة هذا التحويل' };
    }

    return transfer;
  }

  @Get(':id')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'تفاصيل تحويل محدد' })
  async getTransferById(
    @CurrentUser() user: any,
    @Param('id') id: number,
  ) {
    const transfer = await this.transfersService.findById(id);
    
    // التحقق من الصلاحية
    if (user.role !== 'admin' && user.role !== 'moderator' &&
        transfer.sender.id !== user.id &&
        transfer.receiver.id !== user.id) {
      return { message: 'غير مصرح لك بمشاهدة هذا التحويل' };
    }

    return transfer;
  }

  @Post(':id/confirm-delivery')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تأكيد استلام التحويل (للمستلم فقط - مرة واحدة)' })
  @ApiResponse({ status: 200, description: 'تم تأكيد الاستلام بنجاح' })
  @ApiResponse({ status: 400, description: 'تم التأكيد مسبقاً أو التحويل غير مكتمل' })
  @ApiResponse({ status: 403, description: 'فقط المستلم يمكنه التأكيد' })
  async confirmDelivery(
    @CurrentUser() user: any,
    @Param('id') id: number,
    @Body('deliveryNote') deliveryNote?: string,
  ) {
    return this.transfersService.confirmDelivery(id, user.id, deliveryNote);
  }

  @Delete(':id/cancel')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'إلغاء تحويل' })
  async cancelTransfer(
    @CurrentUser() user: any,
    @Param('id') id: number,
  ) {
    return this.transfersService.cancelTransfer(id, user.id, user.role);
  }
}