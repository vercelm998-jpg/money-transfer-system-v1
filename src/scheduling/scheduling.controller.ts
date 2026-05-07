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
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { RolesGuard } from '../auth/roles.guard';
import { SchedulingService } from './scheduling.service';
import { CreateScheduledTransferDto, UpdateScheduledTransferDto } from './dto/create-scheduled-transfer.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('جدولة التحويلات')
@Controller('schedules')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class SchedulingController {
  constructor(private schedulingService: SchedulingService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'إنشاء جدولة تحويل جديدة' })
  @ApiResponse({ status: 201, description: 'تم إنشاء الجدولة بنجاح' })
  async createSchedule(
    @CurrentUser() user: any,
    @Body() createDto: CreateScheduledTransferDto,
  ) {
    return this.schedulingService.createScheduledTransfer(user.id, createDto);
  }

  @Get()
  @ApiOperation({ summary: 'قائمة الجدولات للمستخدم الحالي' })
  async getMySchedules(
    @CurrentUser() user: any,
    @Query() query: any,
  ) {
    return this.schedulingService.getUserSchedules(user.id, user.role, query);
  }

  @Get('upcoming')
  @ApiOperation({ summary: 'الجدولات القادمة (خلال 24 ساعة)' })
  async getUpcomingSchedules(@CurrentUser() user: any) {
    return this.schedulingService.getUpcomingSchedules(user.id);
  }

  @Get('all')
  @UseGuards(RolesGuard)
  @SetMetadata('roles', ['admin'])
  @ApiOperation({ summary: 'جميع الجدولات (للمسؤول فقط)' })
  async getAllSchedules(@Query() query: any) {
    return this.schedulingService.getUserSchedules(null, 'admin', query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'تفاصيل جدولة محددة' })
  async getSchedule(
    @CurrentUser() user: any,
    @Param('id') id: number,
  ) {
    return this.schedulingService.getScheduleById(id, user.id, user.role);
  }

  @Put(':id')
  @ApiOperation({ summary: 'تحديث جدولة' })
  async updateSchedule(
    @CurrentUser() user: any,
    @Param('id') id: number,
    @Body() updateDto: UpdateScheduledTransferDto,
  ) {
    return this.schedulingService.updateSchedule(id, user.id, updateDto);
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'إيقاف جدولة مؤقتاً' })
  async pauseSchedule(
    @CurrentUser() user: any,
    @Param('id') id: number,
  ) {
    return this.schedulingService.pauseSchedule(id, user.id);
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'استئناف جدولة متوقفة' })
  async resumeSchedule(
    @CurrentUser() user: any,
    @Param('id') id: number,
  ) {
    return this.schedulingService.resumeSchedule(id, user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'إلغاء جدولة' })
  async cancelSchedule(
    @CurrentUser() user: any,
    @Param('id') id: number,
  ) {
    return this.schedulingService.cancelSchedule(id, user.id);
  }
}