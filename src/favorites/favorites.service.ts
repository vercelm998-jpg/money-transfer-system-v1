import { 
  Injectable, 
  BadRequestException, 
  NotFoundException,
  Logger,
  ConflictException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Favorite } from './favorite.entity';
import { User } from '../users/user.entity';
import { CreateFavoriteDto, UpdateFavoriteDto } from './dto/create-favorite.dto';

@Injectable()
export class FavoritesService {
  private readonly logger = new Logger(FavoritesService.name);

  constructor(
    @InjectRepository(Favorite)
    private favoritesRepository: Repository<Favorite>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  async addFavorite(userId: number, createFavoriteDto: CreateFavoriteDto): Promise<Favorite> {
    const { favoriteUserId, nickname, note, tags } = createFavoriteDto;

    if (userId === favoriteUserId) {
      throw new BadRequestException('لا يمكن إضافة نفسك إلى المفضلة');
    }

    const favoriteUser = await this.usersRepository.findOne({
      where: { id: favoriteUserId }
    });

    if (!favoriteUser) {
      throw new NotFoundException('المستخدم المراد إضافته غير موجود');
    }

    const existingFavorite = await this.favoritesRepository.findOne({
      where: { userId, favoriteUserId }
    });

    if (existingFavorite) {
      throw new ConflictException('هذا المستخدم موجود بالفعل في قائمة المفضلة');
    }

    // إنشاء المفضل - استخدم spread بدلاً من الكائن المباشر
    const favorite = new Favorite();
    favorite.userId = userId;
    favorite.favoriteUserId = favoriteUserId;
    favorite.nickname = nickname || favoriteUser.username;
    favorite.note = note || null;
    favorite.tags = tags || [];

    const savedFavorite = await this.favoritesRepository.save(favorite);

    this.logger.log(`✅ تمت إضافة المستخدم ${favoriteUserId} إلى مفضلة المستخدم ${userId}`);

    // savedFavorite هو كائن واحد وليس مصفوفة
    return await this.favoritesRepository.findOne({
      where: { id: savedFavorite.id },
      relations: ['favoriteUser']
    });
  }

  async getUserFavorites(
    userId: number, 
    query: any = {}
  ): Promise<{ favorites: Favorite[]; total: number }> {
    const { 
      page = 1, 
      limit = 20, 
      search,
      tags,
      sortBy = 'createdAt',
      sortOrder = 'DESC'
    } = query;

    const queryBuilder = this.favoritesRepository
      .createQueryBuilder('favorite')
      .leftJoinAndSelect('favorite.favoriteUser', 'favoriteUser')
      .where('favorite.userId = :userId', { userId });

    if (search) {
      queryBuilder.andWhere(
        '(favorite.nickname LIKE :search OR favorite.note LIKE :search OR favoriteUser.username LIKE :search)',
        { search: `%${search}%` }
      );
    }

    if (tags) {
      const tagsArray = Array.isArray(tags) ? tags : [tags];
      tagsArray.forEach((tag, index) => {
        queryBuilder.andWhere(`JSON_CONTAINS(favorite.tags, :tag${index})`, {
          [`tag${index}`]: JSON.stringify(tag)
        });
      });
    }

    queryBuilder
      .orderBy(`favorite.${sortBy}`, sortOrder)
      .skip((page - 1) * limit)
      .take(limit);

    const [favorites, total] = await queryBuilder.getManyAndCount();

    return { favorites, total };
  }

  async getFavoriteById(favoriteId: number, userId: number): Promise<Favorite> {
    const favorite = await this.favoritesRepository.findOne({
      where: { id: favoriteId, userId },
      relations: ['favoriteUser']
    });

    if (!favorite) {
      throw new NotFoundException('المفضل غير موجود');
    }

    return favorite;
  }

  async updateFavorite(
    favoriteId: number, 
    userId: number, 
    updateFavoriteDto: UpdateFavoriteDto
  ): Promise<Favorite> {
    const favorite = await this.getFavoriteById(favoriteId, userId);

    Object.assign(favorite, updateFavoriteDto);

    const updatedFavorite = await this.favoritesRepository.save(favorite);

    this.logger.log(`✅ تم تحديث المفضل ${favoriteId}`);

    return await this.favoritesRepository.findOne({
      where: { id: updatedFavorite.id },
      relations: ['favoriteUser']
    });
  }

  async removeFavorite(favoriteId: number, userId: number): Promise<void> {
    const favorite = await this.getFavoriteById(favoriteId, userId);

    // حذف فعلي بدلاً من soft delete
    await this.favoritesRepository.remove(favorite);

    this.logger.log(`🗑️ تم حذف المفضل ${favoriteId}`);
  }

  async incrementTransferStats(userId: number, favoriteUserId: number, amount: number): Promise<void> {
    const favorite = await this.favoritesRepository.findOne({
      where: { userId, favoriteUserId }
    });

    if (favorite) {
      favorite.transferCount += 1;
      favorite.totalTransferred = Number(favorite.totalTransferred) + amount;
      favorite.lastTransferAt = new Date();
      await this.favoritesRepository.save(favorite);
      
      this.logger.log(`✅ تم تحديث إحصائيات المفضل للمستخدم ${favoriteUserId}`);
    }
  }

  async getFavoriteTransferStats(userId: number, favoriteUserId: number): Promise<any> {
    const favorite = await this.favoritesRepository.findOne({
      where: { userId, favoriteUserId }
    });

    if (!favorite) {
      throw new NotFoundException('المفضل غير موجود');
    }

    return {
      transferCount: favorite.transferCount,
      totalTransferred: favorite.totalTransferred,
      lastTransferAt: favorite.lastTransferAt,
      since: favorite.createdAt,
      averageTransfer: favorite.transferCount > 0 
        ? Number(favorite.totalTransferred) / favorite.transferCount 
        : 0
    };
  }

  async getPopularFavorites(userId: number): Promise<Favorite[]> {
    return this.favoritesRepository.find({
      where: { userId },
      relations: ['favoriteUser'],
      order: { transferCount: 'DESC', totalTransferred: 'DESC' },
      take: 10
    });
  }
}