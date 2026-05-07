import { 
  Controller, 
  Get, 
  Post, 
  Put,
  Delete,
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
import { NotificationsService } from './notifications.service';
import { CreateNotificationDto, NotificationQueryDto } from './dto/create-notification.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('الإشعارات')
@Controller('notifications')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'قائمة الإشعارات للمستخدم الحالي' })
  @ApiResponse({ status: 200, description: 'قائمة الإشعارات' })
  async getMyNotifications(
    @CurrentUser() user: any,
    @Query() query: NotificationQueryDto,
  ) {
    return this.notificationsService.getUserNotifications(user.id, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'عدد الإشعارات غير المقروءة' })
  async getUnreadCount(@CurrentUser() user: any) {
    const result = await this.notificationsService.getUserNotifications(user.id, {
      read: false,
      limit: 1
    });
    return { unreadCount: result.unreadCount };
  }

  @Get(':id')
  @ApiOperation({ summary: 'تفاصيل إشعار محدد' })
  async getNotification(
    @CurrentUser() user: any,
    @Param('id') id: number,
  ) {
    return this.notificationsService.getNotificationById(id, user.id);
  }

  @Put(':id/read')
  @ApiOperation({ summary: 'تعليم إشعار كمقروء' })
  @HttpCode(HttpStatus.OK)
  async markAsRead(
    @CurrentUser() user: any,
    @Param('id') id: number,
  ) {
    await this.notificationsService.markAsRead(id, user.id);
    return { message: 'تم تعليم الإشعار كمقروء' };
  }

  @Put('read-all')
  @ApiOperation({ summary: 'تعليم جميع الإشعارات كمقروءة' })
  @HttpCode(HttpStatus.OK)
  async markAllAsRead(@CurrentUser() user: any) {
    return this.notificationsService.markAllAsRead(user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'حذف إشعار' })
  @HttpCode(HttpStatus.OK)
  async deleteNotification(
    @CurrentUser() user: any,
    @Param('id') id: number,
  ) {
    await this.notificationsService.deleteNotification(id, user.id);
    return { message: 'تم حذف الإشعار بنجاح' };
  }

  @Delete()
  @ApiOperation({ summary: 'حذف جميع الإشعارات' })
  @HttpCode(HttpStatus.OK)
  async deleteAllNotifications(@CurrentUser() user: any) {
    return this.notificationsService.deleteAllNotifications(user.id);
  }

  @Post('admin/send')
  @UseGuards(RolesGuard)
  @SetMetadata('roles', ['admin', 'moderator'])
  @ApiOperation({ summary: 'إرسال إشعار (للمسؤولين فقط)' })
  @HttpCode(HttpStatus.CREATED)
  async sendNotification(@Body() createNotificationDto: CreateNotificationDto) {
    return this.notificationsService.createNotification(createNotificationDto);
  }

  @Post('admin/bulk-send')
  @UseGuards(RolesGuard)
  @SetMetadata('roles', ['admin'])
  @ApiOperation({ summary: 'إرسال إشعار جماعي (للمسؤول فقط)' })
  @HttpCode(HttpStatus.CREATED)
  async sendBulkNotifications(
    @Body() body: {
      userIds: number[];
      title: string;
      message: string;
      type: string;
      priority?: string;
    }
  ) {
    return this.notificationsService.sendBulkNotifications(
      body.userIds,
      body.title,
      body.message,
      body.type as any,
      body.priority as any
    );
  }
}