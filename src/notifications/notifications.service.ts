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
import { NotificationsGateway } from './notifications.gateway';
import { Expo, ExpoPushMessage } from 'expo-server-sdk';

// استيراد Entity الـ Push Token (سننشئه لاحقاً)
import { UserPushToken } from './user-push-token.entity';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private expo: Expo;

  constructor(
    @InjectRepository(Notification)
    private notificationsRepository: Repository<Notification>,
    @InjectRepository(UserPushToken)
    private pushTokenRepository: Repository<UserPushToken>,
    private gateway: NotificationsGateway,
  ) {
    // تهيئة Expo SDK
    this.expo = new Expo();
  }

  /**
   * إرسال إشعار عبر Expo Push API (يعمل حتى لو التطبيق مغلق)
   */
  async sendExpoPushNotification(
    expoPushToken: string,
    title: string,
    body: string,
    data?: Record<string, any>
  ): Promise<boolean> {
    // التحقق من صحة الـ Token
    if (!Expo.isExpoPushToken(expoPushToken)) {
      this.logger.warn(`⚠️ Invalid Expo push token: ${expoPushToken}`);
      return false;
    }

    const message: ExpoPushMessage = {
      to: expoPushToken,
      sound: 'default',
      title: title,
      body: body,
      data: data || {},
      priority: 'high', // مهم لضمان الوصول عند إغلاق التطبيق
    };

    try {
      const chunks = this.expo.chunkPushNotifications([message]);
      const tickets = [];
      
      for (const chunk of chunks) {
        const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      }
      
      // التحقق من وجود أخطاء في الـ tickets
      for (const ticket of tickets) {
        if (ticket.status === 'error') {
          this.logger.error(`❌ Expo push error: ${ticket.message}`);
          if (ticket.details?.error === 'DeviceNotRegistered') {
            // إذا كان الجهاز غير مسجل، نقوم بتعطيل الـ token
            await this.pushTokenRepository.update(
              { token: expoPushToken, isActive: true },
              { isActive: false }
            );
          }
          return false;
        }
      }
      
      this.logger.log(`📱 Expo push sent successfully for token: ${expoPushToken.substring(0, 20)}...`);
      return true;
    } catch (error) {
      this.logger.error(`❌ Expo push failed: ${error.message}`);
      return false;
    }
  }

  /**
   * تسجيل جهاز المستخدم لاستقبال الإشعارات
   */
  async registerPushToken(
    userId: number, 
    token: string, 
    deviceName?: string
  ): Promise<UserPushToken> {
    // التحقق من صحة الـ token
    if (!Expo.isExpoPushToken(token)) {
      throw new BadRequestException('Invalid Expo push token');
    }

    // تعطيل أي token قديم للمستخدم
    await this.pushTokenRepository.update(
      { userId, isActive: true },
      { isActive: false }
    );
    
    // حفظ الـ token الجديد
    const pushToken = this.pushTokenRepository.create({
      userId,
      token,
      deviceName: deviceName || 'Unknown Device',
      isActive: true,
      type: 'expo'
    });
    
    const savedToken = await this.pushTokenRepository.save(pushToken);
    this.logger.log(`📱 Push token registered for user ${userId}`);
    
    return savedToken;
  }

  /**
   * الحصول على الـ Push Token النشط لمستخدم
   */
  async getUserActivePushToken(userId: number): Promise<string | null> {
    const pushToken = await this.pushTokenRepository.findOne({
      where: { userId, isActive: true },
      order: { createdAt: 'DESC' }
    });
    
    return pushToken?.token || null;
  }

  /**
   * إنشاء إشعار جديد (معدل لدعم Expo Push)
   */
  async createNotification(data: {
    userId: number;
    title: string;
    message: string;
    type: string;
    transferId?: number;
    priority?: string;
    actionUrl?: string;
    metadata?: Record<string, any>;
    expoPushToken?: string; // يمكن تمرير token مباشرة
    skipExpoPush?: boolean; // لتخطي إرسال Expo Push في بعض الحالات
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

      // ✅ إرسال فوري عبر WebSocket (للتطبيق المفتوح)
      this.gateway.sendNotificationToUser(data.userId, savedNotification);
      
      // ✅ إرسال عبر Expo Push (للتطبيق المغلق)
      if (!data.skipExpoPush) {
        let pushToken = data.expoPushToken;
        
        // إذا لم يتم تمرير token، نحاول الحصول عليه من قاعدة البيانات
        if (!pushToken) {
          pushToken = await this.getUserActivePushToken(data.userId);
        }
        
        if (pushToken) {
          await this.sendExpoPushNotification(
            pushToken,
            data.title,
            data.message,
            {
              notificationId: savedNotification.id,
              type: data.type,
              transferId: data.transferId,
              screen: data.actionUrl || 'notifications',
            }
          );
        } else {
          this.logger.warn(`⚠️ No active push token for user ${data.userId}, skipping Expo push`);
        }
      }
      
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

    if (type) {
      queryBuilder.andWhere('notification.type = :type', { type });
    }

    if (read !== undefined) {
      queryBuilder.andWhere('notification.read = :read', { read });
    }

    if (priority) {
      queryBuilder.andWhere('notification.priority = :priority', { priority });
    }

    queryBuilder
      .orderBy('notification.priority', 'DESC')
      .addOrderBy('notification.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [notifications, total] = await queryBuilder.getManyAndCount();

    const unreadCount = await this.notificationsRepository.count({
      where: { userId, read: false, isActive: true }
    });

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
    const notification = await this.notificationsRepository.findOne({ where: { id: notificationId } });
    if (!notification) throw new NotFoundException('الإشعار غير موجود');
    if (notification.userId !== userId) throw new ForbiddenException('غير مصرح لك');

    await this.notificationsRepository.update(notificationId, { read: true, readAt: new Date() });
    this.logger.log(`✅ تم تعليم الإشعار ${notificationId} كمقروء`);
  }

  async markAllAsRead(userId: number): Promise<{ affected: number }> {
    const result = await this.notificationsRepository.update(
      { userId, read: false, isActive: true },
      { read: true, readAt: new Date() }
    );
    return { affected: result.affected || 0 };
  }

  async deleteNotification(notificationId: number, userId: number): Promise<void> {
    const notification = await this.notificationsRepository.findOne({ where: { id: notificationId } });
    if (!notification) throw new NotFoundException('الإشعار غير موجود');
    if (notification.userId !== userId) throw new ForbiddenException('غير مصرح لك');
    await this.notificationsRepository.update(notificationId, { isActive: false });
  }

  async deleteAllNotifications(userId: number): Promise<{ affected: number }> {
    const result = await this.notificationsRepository.update(
      { userId, isActive: true },
      { isActive: false }
    );
    return { affected: result.affected || 0 };
  }

  async getNotificationById(notificationId: number, userId: number): Promise<Notification> {
    const notification = await this.notificationsRepository.findOne({ where: { id: notificationId } });
    if (!notification) throw new NotFoundException('الإشعار غير موجود');
    if (notification.userId !== userId) throw new ForbiddenException('غير مصرح لك');
    return notification;
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupOldNotifications(): Promise<void> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const result = await this.notificationsRepository.update(
      { createdAt: LessThan(thirtyDaysAgo), isActive: true },
      { isActive: false }
    );
    if (result.affected > 0) this.logger.log(`🧹 تم تنظيف ${result.affected} إشعار قديم`);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredNotifications(): Promise<void> {
    const now = new Date();
    const result = await this.notificationsRepository.update(
      { expiresAt: LessThan(now), isActive: true },
      { isActive: false }
    );
    if (result.affected > 0) this.logger.log(`⏰ تم حذف ${result.affected} إشعار منتهي`);
  }

  /**
   * إرسال إشعارات جماعية (معدل لدعم Expo Push)
   */
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
        // الحصول على الـ Expo Push Token النشط للمستخدم
        const pushToken = await this.getUserActivePushToken(userId);
        
        await this.createNotification({ 
          userId, 
          title, 
          message, 
          type, 
          priority: priority || NotificationPriority.MEDIUM,
          expoPushToken: pushToken || undefined
        });
        sent++;
      } catch (error) {
        this.logger.error(`فشل إرسال الإشعار للمستخدم ${userId}: ${error.message}`);
        failed++;
      }
    }
    
    return { sent, failed };
  }
                                                               }
