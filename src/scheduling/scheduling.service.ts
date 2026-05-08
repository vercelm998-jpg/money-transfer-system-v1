import { 
  Injectable, 
  BadRequestException, 
  NotFoundException,
  Logger,
  ForbiddenException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, In } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ScheduledTransfer, ScheduleStatus, ScheduleFrequency } from './scheduled-transfer.entity';
import { CreateScheduledTransferDto, UpdateScheduledTransferDto } from './dto/create-scheduled-transfer.dto';
import { User } from '../users/user.entity';
import { TransfersService } from '../transfers/transfers.service';
import { NotificationsService } from '../notifications/notifications.service';



@Injectable()
export class SchedulingService {
  private readonly logger = new Logger(SchedulingService.name);

  constructor(
    @InjectRepository(ScheduledTransfer)
    private scheduledTransfersRepository: Repository<ScheduledTransfer>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private transfersService: TransfersService,
    private notificationsService: NotificationsService,
  ) {}

  async createScheduledTransfer(
    userId: number, 
    createDto: CreateScheduledTransferDto
  ): Promise<ScheduledTransfer> {
    // التحقق من صحة البيانات
    if (userId === createDto.receiverId) {
      throw new BadRequestException('لا يمكن جدولة تحويل إلى نفسك');
    }

    const receiver = await this.usersRepository.findOne({
      where: { id: createDto.receiverId }
    });

    if (!receiver) {
      throw new NotFoundException('المستلم غير موجود');
    }

    const nextExecution = new Date(createDto.nextExecution);
    if (nextExecution <= new Date()) {
      throw new BadRequestException('يجب أن يكون تاريخ التنفيذ في المستقبل');
    }

    // إنشاء الجدولة
    const scheduled = this.scheduledTransfersRepository.create({
      userId,
      receiverId: createDto.receiverId,
      amount: createDto.amount,
      frequency: createDto.frequency,
      nextExecution,
      note: createDto.note,
      maxExecutions: createDto.maxExecutions,
      endDate: createDto.endDate,
      status: ScheduleStatus.ACTIVE,
      metadata: {
        createdBy: userId,
        createdAt: new Date()
      }
    });

    const savedSchedule = await this.scheduledTransfersRepository.save(scheduled);

    // إشعار
    await this.notificationsService.createNotification({
      userId,
      title: '📅 تم إنشاء جدولة تحويل',
      message: `تم جدولة تحويل ${createDto.amount} إلى ${receiver.username} - ${createDto.frequency}`,
      type: 'system'
    });

    this.logger.log(`✅ تم إنشاء جدولة تحويل: ${savedSchedule.scheduleReference}`);

    return savedSchedule;
  }

  async getUserSchedules(
    userId: number, 
    role: string,
    query: any = {}
  ): Promise<{ schedules: ScheduledTransfer[]; total: number }> {
    const { 
      page = 1, 
      limit = 20, 
      status, 
      frequency,
      sortBy = 'nextExecution',
      sortOrder = 'ASC'
    } = query;

    const queryBuilder = this.scheduledTransfersRepository
      .createQueryBuilder('schedule')
      .leftJoinAndSelect('schedule.receiver', 'receiver')
      .where('schedule.isActive = :isActive', { isActive: true });

    // المستخدم العادي يرى جدولته فقط
    if (role !== 'admin') {
      queryBuilder.andWhere('schedule.userId = :userId', { userId });
    }

    // الفلاتر
    if (status) {
      queryBuilder.andWhere('schedule.status = :status', { status });
    }

    if (frequency) {
      queryBuilder.andWhere('schedule.frequency = :frequency', { frequency });
    }

    // الترتيب والصفحات
    queryBuilder
      .orderBy(`schedule.${sortBy}`, sortOrder)
      .skip((page - 1) * limit)
      .take(limit);

    const [schedules, total] = await queryBuilder.getManyAndCount();

    return { schedules, total };
  }

  async getScheduleById(scheduleId: number, userId: number, role: string): Promise<ScheduledTransfer> {
    const schedule = await this.scheduledTransfersRepository.findOne({
      where: { id: scheduleId, isActive: true },
      relations: ['receiver']
    });

    if (!schedule) {
      throw new NotFoundException('الجدولة غير موجودة');
    }

    // التحقق من الصلاحية
    if (schedule.userId !== userId && role !== 'admin') {
      throw new ForbiddenException('غير مصرح لك بمشاهدة هذه الجدولة');
    }

    return schedule;
  }

  async updateSchedule(
    scheduleId: number, 
    userId: number, 
    updateDto: UpdateScheduledTransferDto
  ): Promise<ScheduledTransfer> {
    const schedule = await this.scheduledTransfersRepository.findOne({
      where: { id: scheduleId, userId, isActive: true }
    });

    if (!schedule) {
      throw new NotFoundException('الجدولة غير موجودة');
    }

    if (schedule.status !== ScheduleStatus.ACTIVE && schedule.status !== ScheduleStatus.PAUSED) {
      throw new BadRequestException('يمكن تحديث الجدولات النشطة أو المتوقفة فقط');
    }

    Object.assign(schedule, updateDto);
    const updated = await this.scheduledTransfersRepository.save(schedule);

    this.logger.log(`✅ تم تحديث الجدولة: ${updated.scheduleReference}`);

    return updated;
  }

  async pauseSchedule(scheduleId: number, userId: number): Promise<ScheduledTransfer> {
    const schedule = await this.scheduledTransfersRepository.findOne({
      where: { id: scheduleId, userId, isActive: true }
    });

    if (!schedule) {
      throw new NotFoundException('الجدولة غير موجودة');
    }

    if (schedule.status !== ScheduleStatus.ACTIVE) {
      throw new BadRequestException('يمكن إيقاف الجدولات النشطة فقط');
    }

    schedule.status = ScheduleStatus.PAUSED;
    const updated = await this.scheduledTransfersRepository.save(schedule);

    this.logger.log(`⏸️ تم إيقاف الجدولة: ${updated.scheduleReference}`);

    return updated;
  }

  async resumeSchedule(scheduleId: number, userId: number): Promise<ScheduledTransfer> {
    const schedule = await this.scheduledTransfersRepository.findOne({
      where: { id: scheduleId, userId, isActive: true }
    });

    if (!schedule) {
      throw new NotFoundException('الجدولة غير موجودة');
    }

    if (schedule.status !== ScheduleStatus.PAUSED) {
      throw new BadRequestException('يمكن استئناف الجدولات المتوقفة فقط');
    }

    // حساب موعد التنفيذ التالي
    const nextExecution = this.calculateNextExecution(
      new Date(),
      schedule.frequency
    );

    schedule.status = ScheduleStatus.ACTIVE;
    schedule.nextExecution = nextExecution;
    const updated = await this.scheduledTransfersRepository.save(schedule);

    this.logger.log(`▶️ تم استئناف الجدولة: ${updated.scheduleReference}`);

    return updated;
  }

  async cancelSchedule(scheduleId: number, userId: number): Promise<ScheduledTransfer> {
    const schedule = await this.scheduledTransfersRepository.findOne({
      where: { id: scheduleId, userId, isActive: true }
    });

    if (!schedule) {
      throw new NotFoundException('الجدولة غير موجودة');
    }

    schedule.status = ScheduleStatus.CANCELLED;
    const updated = await this.scheduledTransfersRepository.save(schedule);

    await this.notificationsService.createNotification({
      userId,
      title: '❌ تم إلغاء جدولة تحويل',
      message: `تم إلغاء جدولة تحويل ${schedule.amount} إلى المستلم ${schedule.receiverId}`,
      type: 'system'
    });

    this.logger.log(`❌ تم إلغاء الجدولة: ${updated.scheduleReference}`);

    return updated;
  }

  // المهمة المجدولة الأهم: تنفيذ التحويلات المجدولة
  @Cron(CronExpression.EVERY_MINUTE)
  async processScheduledTransfers(): Promise<void> {
    const now = new Date();
    
    const dueSchedules = await this.scheduledTransfersRepository.find({
      where: {
        status: ScheduleStatus.ACTIVE,
        isActive: true,
        nextExecution: LessThan(now)
      },
      relations: ['user']
    });

    this.logger.log(`📋 جدول التنفيذ: ${dueSchedules.length} تحويلات مستحقة`);

    for (const schedule of dueSchedules) {
      await this.executeScheduledTransfer(schedule);
    }
  }

  private async executeScheduledTransfer(schedule: ScheduledTransfer): Promise<void> {
    try {
      // تنفيذ التحويل
      await this.transfersService.createTransfer(
        schedule.userId,
        {
          receiverId: schedule.receiverId,
          amount: schedule.amount,
          note: schedule.note || 'تحويل مجدول تلقائي',
          
        },
        { scheduledTransferId: schedule.id }
      );

      // تحديث الإحصائيات
      schedule.executionCount += 1;
      schedule.totalTransferred = Number(schedule.totalTransferred) + Number(schedule.amount);
      schedule.lastExecution = new Date();

      // التحقق من اكتمال الجدولة
      if (schedule.isExpired) {
        schedule.status = ScheduleStatus.COMPLETED;
        
        await this.notificationsService.createNotification({
          userId: schedule.userId,
          title: '✅ اكتملت جدولة التحويل',
          message: `تم اكتمال جميع تحويلات الجدولة (${schedule.executionCount} تحويلات)`,
          type: 'system'
        });
      } else {
        // حساب موعد التنفيذ التالي
        schedule.nextExecution = this.calculateNextExecution(
          schedule.nextExecution,
          schedule.frequency
        );
      }

      await this.scheduledTransfersRepository.save(schedule);
      
      this.logger.log(`✅ تم تنفيذ التحويل المجدول: ${schedule.scheduleReference}`);
      
    } catch (error) {
      this.logger.error(
        `❌ فشل تنفيذ التحويل المجدول ${schedule.scheduleReference}: ${error.message}`,
        error.stack
      );

      // إذا فشل التنفيذ، حاول مرة أخرى في الدقيقة التالية
      schedule.nextExecution = new Date(Date.now() + 60000); // +1 دقيقة
      await this.scheduledTransfersRepository.save(schedule);

      await this.notificationsService.createNotification({
        userId: schedule.userId,
        title: '⚠️ فشل تنفيذ تحويل مجدول',
        message: `فشل تنفيذ تحويل ${schedule.amount} - ${error.message}`,
        type: 'transfer_failed',
        priority: 'high'
      });
    }
  }

  private calculateNextExecution(currentDate: Date, frequency: ScheduleFrequency): Date {
    const next = new Date(currentDate);

    switch (frequency) {
      case ScheduleFrequency.DAILY:
        next.setDate(next.getDate() + 1);
        break;
      case ScheduleFrequency.WEEKLY:
        next.setDate(next.getDate() + 7);
        break;
      case ScheduleFrequency.BIWEEKLY:
        next.setDate(next.getDate() + 14);
        break;
      case ScheduleFrequency.MONTHLY:
        next.setMonth(next.getMonth() + 1);
        break;
      case ScheduleFrequency.QUARTERLY:
        next.setMonth(next.getMonth() + 3);
        break;
      case ScheduleFrequency.YEARLY:
        next.setFullYear(next.getFullYear() + 1);
        break;
      case ScheduleFrequency.ONCE:
      default:
        return null; // مرة واحدة فقط
    }

    return next;
  }

  async getUpcomingSchedules(userId: number): Promise<ScheduledTransfer[]> {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    return this.scheduledTransfersRepository.find({
      where: {
        userId,
        status: ScheduleStatus.ACTIVE,
        isActive: true,
        nextExecution: LessThan(tomorrow)
      },
      relations: ['receiver'],
      order: { nextExecution: 'ASC' }
    });
  }
}