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
  HttpCode,
  HttpStatus
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';

import { AuthGuard } from '@nestjs/passport';
import { FavoritesService } from './favorites.service';
import { CreateFavoriteDto, UpdateFavoriteDto } from './dto/create-favorite.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('المفضلة')
@Controller('favorites')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class FavoritesController {
  constructor(private favoritesService: FavoritesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'إضافة مستخدم إلى المفضلة' })
  @ApiResponse({ status: 201, description: 'تمت الإضافة بنجاح' })
  @ApiResponse({ status: 400, description: 'لا يمكن إضافة نفسك' })
  @ApiResponse({ status: 409, description: 'المستخدم موجود مسبقاً' })
  async addFavorite(
    @CurrentUser() user: any,
    @Body() createFavoriteDto: CreateFavoriteDto,
  ) {
    return this.favoritesService.addFavorite(user.id, createFavoriteDto);
  }

  @Get()
  @ApiOperation({ summary: 'قائمة المفضلة للمستخدم الحالي' })
  async getMyFavorites(
    @CurrentUser() user: any,
    @Query() query: any,
  ) {
    return this.favoritesService.getUserFavorites(user.id, query);
  }

  @Get('popular')
  @ApiOperation({ summary: 'المفضلة الأكثر استخداماً' })
  async getPopularFavorites(@CurrentUser() user: any) {
    return this.favoritesService.getPopularFavorites(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'تفاصيل مفضل محدد' })
  async getFavorite(
    @CurrentUser() user: any,
    @Param('id') id: number,
  ) {
    return this.favoritesService.getFavoriteById(id, user.id);
  }

  @Get(':id/stats')
  @ApiOperation({ summary: 'إحصائيات التحويلات مع مفضل' })
  async getFavoriteStats(
    @CurrentUser() user: any,
    @Param('id') id: number,
  ) {
    // id هنا هو favoriteUserId
    return this.favoritesService.getFavoriteTransferStats(user.id, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'تحديث مفضل' })
  async updateFavorite(
    @CurrentUser() user: any,
    @Param('id') id: number,
    @Body() updateFavoriteDto: UpdateFavoriteDto,
  ) {
    return this.favoritesService.updateFavorite(id, user.id, updateFavoriteDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'حذف من المفضلة' })
  async removeFavorite(
    @CurrentUser() user: any,
    @Param('id') id: number,
  ) {
    await this.favoritesService.removeFavorite(id, user.id);
    return { message: 'تم الحذف من المفضلة بنجاح' };
  }
}