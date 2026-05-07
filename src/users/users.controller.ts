import { 
  Controller, 
  Get, 
  Post, 
  Put, 
  Param,
  Body, 
  Query,
  UseGuards,
  SetMetadata,
  HttpCode,
  HttpStatus
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';

import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/roles.guard';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserStatus } from './user.entity';

@ApiTags('المستخدمين')
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('profile')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'الحصول على الملف الشخصي' })
  async getProfile(@CurrentUser() user: any) {
    return this.usersService.getProfile(user.id);
  }

  @Get('statistics')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'إحصائيات المستخدم' })
  async getStatistics(@CurrentUser() user: any) {
    return this.usersService.getStatistics(user.id);
  }

  @Get('transfer-history')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'سجل التحويلات للمستخدم الحالي' })
  async getMyTransferHistory(@CurrentUser() user: any) {
    return this.usersService.getTransferHistory(user.id);
  }

  @Get()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @SetMetadata('roles', ['admin', 'moderator'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'قائمة المستخدمين (للمسؤولين)' })
  async findAll(@Query() query: any) {
    return this.usersService.findAll(query);
  }

  @Get(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @SetMetadata('roles', ['admin', 'moderator'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'معلومات مستخدم محدد (للمسؤولين)' })
  async findById(@Param('id') id: number) {
    return this.usersService.findById(id);
  }

  @Get(':id/transfer-history')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @SetMetadata('roles', ['admin', 'moderator'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'سجل تحويلات مستخدم محدد (للمسؤولين)' })
  async getUserTransferHistory(@Param('id') id: number) {
    return this.usersService.getTransferHistory(id);
  }

  @Post()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @SetMetadata('roles', ['admin'])
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'إنشاء مستخدم جديد (للمسؤول)' })
  async create(
    @Body() createUserDto: CreateUserDto,
    @CurrentUser() admin: any,
  ) {
    return this.usersService.create(createUserDto);
  }

  @Put(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @SetMetadata('roles', ['admin'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'تحديث مستخدم (للمسؤول)' })
  async update(
    @Param('id') id: number,
    @Body() updateUserDto: UpdateUserDto,
    @CurrentUser() admin: any,
  ) {
    return this.usersService.update(id, updateUserDto, admin.id);
  }

  @Post(':id/status')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @SetMetadata('roles', ['admin'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'تغيير حالة المستخدم (للمسؤول)' })
  async updateStatus(
    @Param('id') id: number,
    @Body('status') status: UserStatus,
    @CurrentUser() admin: any,
  ) {
    return this.usersService.updateStatus(id, status, admin.id);
  }
}