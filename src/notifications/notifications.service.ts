import { 
  Injectable, 
  NotFoundException,
  BadRequestException,
  Logger,
  ForbiddenException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, LessThan, MoreThan } from 'typeorm';
import { Notification, NotificationType, NotificationPriority } from './notification.entity';
import { CreateNotificationDto, NotificationQueryDto } from './dto/create-notification.dto';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification)
    private notificationsRepository: Repository<Notification>,
  ) {}

  async createNotification(data: {
    userId: number;
    title: string;
    message: string;
    type: string;
    transferId?: number;
    priority?: string;
    actionUrl?: string;
    metadata?: Record<string, any>;
  }): Promise<Notification> {
    try {
      const notification = this.notificationsRepository.create({
        userId: data.userId,
        title: data.title,
        message: data.message,
        type: data.type as NotificationType,
        transferId: data.transferId,
        priority: (data.priority as NotificationPriority) || NotificationPriority.MEDIUM,
        actionUrl: data.actionUrl,
        metadata: data.metadata || {},
      });

      const savedNotification = await this.notificationsRepository.save(notification);
      
      this.logger.log(`✅ تم إنشاء إشعار للمستخدم ${data.userId}: ${data.title}`);
      
      return savedNotification;
    } catch (error) {
      this.logger.error(`❌ فشل إنشاء الإشعار: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getUserNotifications(
    userId: number, 
    query: NotificationQueryDto
  ): Promise<any> {
    const { 
      page = 1, 
      limit = 20, 
      type, 
      read, 
      priority 
    } = query;

    const queryBuilder = this.notificationsRepository
      .createQueryBuilder('notification')
      .where('notification.userId = :userId', { userId })
      .andWhere('notification.isActive = :isActive', { isActive: true });

    // الفلاتر
    if (type) {
      queryBuilder.andWhere('notification.type = :type', { type });
    }

    if (read !== undefined) {
      queryBuilder.andWhere('notification.read = :read', { read });
    }

    if (priority) {
      queryBuilder.andWhere('notification.priority = :priority', { priority });
    }

    // الترتيب حسب الأولوية والتاريخ
    queryBuilder
      .orderBy('notification.priority', 'DESC')
      .addOrderBy('notification.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [notifications, total] = await queryBuilder.getManyAndCount();

    // عدد الإشعارات غير المقروءة
    const unreadCount = await this.notificationsRepository.count({
      where: { 
        userId, 
        read: false,
        isActive: true 
      }
    });

    // إحصائيات الإشعارات
    const stats = await this.getNotificationStats(userId);

    return {
      notifications,
      unreadCount,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      stats
    };
  }

  private async getNotificationStats(userId: number): Promise<any> {
    const stats = await this.notificationsRepository
      .createQueryBuilder('notification')
      .select('notification.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .where('notification.userId = :userId', { userId })
      .andWhere('notification.read = :read', { read: false })
      .groupBy('notification.type')
      .getRawMany();

    return stats.reduce((acc, stat) => {
      acc[stat.type] = parseInt(stat.count);
      return acc;
    }, {});
  }

  async markAsRead(notificationId: number, userId: number): Promise<void> {
    const notification = await this.notificationsRepository.findOne({
      where: { id: notificationId }
    });

    if (!notification) {
      throw new NotFoundException('الإشعار غير موجود');
    }

    if (notification.userId !== userId) {
      throw new ForbiddenException('غير مصرح لك بتعديل هذا الإشعار');
    }

    await this.notificationsRepository.update(notificationId, {
      read: true,
      readAt: new Date()
    });

    this.logger.log(`✅ تم تعليم الإشعار ${notificationId} كمقروء`);
  }

  async markAllAsRead(userId: number): Promise<{ affected: number }> {
    const result = await this.notificationsRepository.update(
      { userId, read: false, isActive: true },
      { 
        read: true,
        readAt: new Date()
      }
    );

    this.logger.log(`✅ تم تعليم ${result.affected} إشعار كمقروء للمستخدم ${userId}`);

    return { affected: result.affected || 0 };
  }

  async deleteNotification(notificationId: number, userId: number): Promise<void> {
    const notification = await this.notificationsRepository.findOne({
      where: { id: notificationId }
    });

    if (!notification) {
      throw new NotFoundException('الإشعار غير موجود');
    }

    if (notification.userId !== userId) {
      throw new ForbiddenException('غير مصرح لك بحذف هذا الإشعار');
    }

    // Soft delete
    await this.notificationsRepository.update(notificationId, {
      isActive: false
    });

    this.logger.log(`🗑️ تم حذف الإشعار ${notificationId}`);
  }

  async deleteAllNotifications(userId: number): Promise<{ affected: number }> {
    const result = await this.notificationsRepository.update(
      { userId, isActive: true },
      { isActive: false }
    );

    this.logger.log(`🗑️ تم حذف ${result.affected} إشعار للمستخدم ${userId}`);

    return { affected: result.affected || 0 };
  }

  async getNotificationById(notificationId: number, userId: number): Promise<Notification> {
    const notification = await this.notificationsRepository.findOne({
      where: { id: notificationId }
    });

    if (!notification) {
      throw new NotFoundException('الإشعار غير موجود');
    }

    if (notification.userId !== userId) {
      throw new ForbiddenException('غير مصرح لك بمشاهدة هذا الإشعار');
    }

    return notification;
  }

  // مهمة مجدولة: حذف الإشعارات القديمة
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupOldNotifications(): Promise<void> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const result = await this.notificationsRepository.update(
      { 
        createdAt: LessThan(thirtyDaysAgo),
        isActive: true 
      },
      { isActive: false }
    );

    if (result.affected > 0) {
      this.logger.log(`🧹 تم تنظيف ${result.affected} إشعار قديم`);
    }
  }

  // مهمة مجدولة: حذف الإشعارات منتهية الصلاحية
  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredNotifications(): Promise<void> {
    const now = new Date();

    const result = await this.notificationsRepository.update(
      { 
        expiresAt: LessThan(now),
        isActive: true 
      },
      { isActive: false }
    );

    if (result.affected > 0) {
      this.logger.log(`⏰ تم حذف ${result.affected} إشعار منتهي الصلاحية`);
    }
  }

  async sendBulkNotifications(
    userIds: number[],
    title: string,
    message: string,
    type: NotificationType,
    priority?: NotificationPriority
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;

    for (const userId of userIds) {
      try {
        await this.createNotification({
          userId,
          title,
          message,
          type,
priority: priority || 'medium' as NotificationPriority        });
        sent++;
      } catch (error) {
        this.logger.error(`فشل إرسال الإشعار للمستخدم ${userId}: ${error.message}`);
        failed++;
      }
    }

    return { sent, failed };
  }
}