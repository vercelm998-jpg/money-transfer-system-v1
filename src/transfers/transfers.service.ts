import { 
  Injectable, 
  BadRequestException, 
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Transfer, TransferStatus, TransferType } from './transfer.entity';
import { User, UserStatus } from '../users/user.entity';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class TransfersService {
  private readonly logger = new Logger(TransfersService.name);

  constructor(
    @InjectRepository(Transfer)
    private transfersRepository: Repository<Transfer>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private dataSource: DataSource,
    private notificationsService: NotificationsService,
    private auditService: AuditService,
    private walletService: WalletService,
  ) {}

  async createTransfer(
    senderId: number, 
    createTransferDto: CreateTransferDto,
    metadata?: any
  ): Promise<any> {
    const { receiverId, amount, note, commissionAmount, currency } = createTransferDto;

    // التحقق من المدخلات الأساسية
    if (senderId === receiverId) {
      throw new BadRequestException('لا يمكنك التحويل إلى نفسك');
    }

    if (!amount || amount <= 0) {
      throw new BadRequestException('المبلغ يجب أن يكون أكبر من صفر');
    }

    // بدء المعاملة
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    
    try {
      await queryRunner.startTransaction();

      // جلب المستخدمين
      const sender = await queryRunner.manager.findOne(User, {
        where: { id: senderId }
      });

      const receiver = await queryRunner.manager.findOne(User, {
        where: { id: receiverId }
      });

      // التحقق من وجود المستخدمين
      if (!sender) {
        throw new NotFoundException('حسابك غير موجود');
      }

      if (!receiver) {
        throw new NotFoundException('المستلم غير موجود');
      }

      // التحقق من حالة الحسابات
      if (sender.status !== UserStatus.ACTIVE) {
        throw new ForbiddenException('حسابك غير نشط. يرجى التواصل مع الدعم');
      }

      if (receiver.status !== UserStatus.ACTIVE) {
        throw new BadRequestException('حساب المستلم غير نشط');
      }

      // 🆕 حساب العمولة - مبلغ ثابت من المستخدم أو نسبة افتراضية
      let commission: number;
      let commissionRate: number;
      let customCommission = false;

      if (commissionAmount !== undefined && commissionAmount !== null && commissionAmount > 0) {
        // المستخدم أدخل مبلغ العمولة مباشرة
        commission = Number(commissionAmount);
        commissionRate = Number(sender.commissionRate) || 0.01;
        customCommission = true;
      } else {
        // استخدام النسبة الافتراضية
        commissionRate = Number(sender.commissionRate) || 0.01;
        commission = Number((amount * commissionRate).toFixed(2));
      }

      const totalAmount = Number((amount + commission).toFixed(2));

      // التحقق من الرصيد
      const senderBalance = Number(sender.points);
      if (senderBalance < totalAmount) {
        throw new BadRequestException(
          `رصيدك غير كافي. الرصيد المتاح: ${senderBalance.toFixed(2)}`
        );
      }

      // التحقق من الحدود
      const transferCheck = sender.canTransfer(amount);
      if (!transferCheck.can) {
        throw new BadRequestException(transferCheck.reason);
      }

      // 🆕 العملة المختارة
      const selectedCurrency = currency || 'USD';

      // تحديث الأرصدة
      await queryRunner.manager.update(User, senderId, {
        points: Number((senderBalance - totalAmount).toFixed(2)),
        dailyTransferred: Number((Number(sender.dailyTransferred || 0) + amount).toFixed(2)),
        monthlyTransferred: Number((Number(sender.monthlyTransferred || 0) + amount).toFixed(2)),
        totalTransfers: (sender.totalTransfers || 0) + 1,
        lastTransferAt: new Date()
      });

      await queryRunner.manager.update(User, receiverId, {
        points: Number((Number(receiver.points) + amount).toFixed(2))
      });

      // إنشاء سجل التحويل
      const transfer = new Transfer();
      transfer.senderId = senderId;
      transfer.receiverId = receiverId;
      transfer.amount = amount;
      transfer.commission = commission;
      transfer.totalAmount = totalAmount;
      transfer.note = note || null;
      transfer.description = `تحويل من ${sender.username} إلى ${receiver.username}`;
      transfer.type = TransferType.INTERNAL;
      transfer.status = TransferStatus.COMPLETED;
      transfer.completedAt = new Date();
      transfer.metadata = {
        ...metadata,
        commissionRate,
        customCommission,
        currency: selectedCurrency,
      };

      // توليد رقم مرجعي
      const timestamp = Date.now().toString(36);
      const random = Math.random().toString(36).substring(2, 8).toUpperCase();
      transfer.referenceNumber = `TRF-${timestamp}-${random}`;

      const savedTransfer = await queryRunner.manager.save(transfer);

      // جلب الرصيد المحدث للمرسل
      const updatedSender = await queryRunner.manager.findOne(User, {
        where: { id: senderId },
        select: ['id', 'username', 'points']
      });

      // تسجيل في المحفظة
      try {
        await this.walletService.recordTransaction(
          senderId,
          -totalAmount,
          'transfer_out',
          `تحويل ${amount} ${selectedCurrency} إلى ${receiver.username}`,
          savedTransfer.id,
          queryRunner
        );

        await this.walletService.recordTransaction(
          receiverId,
          amount,
          'transfer_in',
          `استلام ${amount} ${selectedCurrency} من ${sender.username}`,
          savedTransfer.id,
          queryRunner
        );
      } catch (walletError) {
        this.logger.warn('فشل تسجيل المحفظة: ' + walletError.message);
      }

      // إرسال الإشعارات
      try {
        await this.notificationsService.createNotification({
          userId: receiverId,
          title: '💰 تحويل جديد',
          message: `تم استلام ${amount.toFixed(2)} ${selectedCurrency} من ${sender.username}`,
          type: 'transfer_received',
          transferId: savedTransfer.id,
        });

        await this.notificationsService.createNotification({
          userId: senderId,
          title: '✅ تم التحويل بنجاح',
          message: `تم تحويل ${amount.toFixed(2)} ${selectedCurrency} إلى ${receiver.username} (العمولة: ${commission.toFixed(2)})`,
          type: 'transfer_sent',
          transferId: savedTransfer.id,
        });
      } catch (notifError) {
        this.logger.warn('فشل إرسال الإشعارات: ' + notifError.message);
      }

      // تسجيل التدقيق
      try {
        await this.auditService.logAction(
          senderId,
          'TRANSFER_COMPLETED',
          `تحويل ${amount} ${selectedCurrency} إلى ${receiver.username} (عمولة: ${commission})`,
          {
            transferId: savedTransfer.id,
            referenceNumber: savedTransfer.referenceNumber,
            currency: selectedCurrency,
            commissionType: customCommission ? 'custom' : 'default',
          }
        );
      } catch (auditError) {
        this.logger.warn('فشل تسجيل التدقيق: ' + auditError.message);
      }

      await queryRunner.commitTransaction();

      this.logger.log(
        `✅ تحويل ناجح: ${amount} ${selectedCurrency} من ${sender.username} إلى ${receiver.username} - REF: ${savedTransfer.referenceNumber}`
      );

      return {
        success: true,
        message: 'تم التحويل بنجاح',
        transfer: {
          id: savedTransfer.id,
          referenceNumber: savedTransfer.referenceNumber,
          amount: savedTransfer.amount,
          commission: savedTransfer.commission,
          totalAmount: savedTransfer.totalAmount,
          currency: selectedCurrency,
          sender: {
            id: sender.id,
            username: sender.username,
            newBalance: updatedSender?.points || (senderBalance - totalAmount)
          },
          receiver: {
            id: receiver.id,
            username: receiver.username
          },
          note: savedTransfer.note,
          status: savedTransfer.status,
          createdAt: savedTransfer.createdAt,
          completedAt: savedTransfer.completedAt,
        }
      };

    } catch (error) {
      this.logger.error(`❌ فشل التحويل: ${error.message}`);
      try {
        await queryRunner.rollbackTransaction();
      } catch (rollbackError) {
        this.logger.error('فشل rollback: ' + rollbackError.message);
      }
      throw error;
    } finally {
      try {
        await queryRunner.release();
      } catch (releaseError) {
        this.logger.error('فشل release: ' + releaseError.message);
      }
    }
  }

  async findById(id: number): Promise<Transfer> {
    const transfer = await this.transfersRepository.findOne({
      where: { id },
      relations: ['sender', 'receiver']
    });

    if (!transfer) {
      throw new NotFoundException('التحويل غير موجود');
    }

    return transfer;
  }

  async findByReference(referenceNumber: string): Promise<Transfer> {
    const transfer = await this.transfersRepository.findOne({
      where: { referenceNumber },
      relations: ['sender', 'receiver']
    });

    if (!transfer) {
      throw new NotFoundException('التحويل غير موجود');
    }

    return transfer;
  }

  async getTransferHistory(
    userId: number, 
    role: string, 
    filters?: any
  ): Promise<any> {
    const queryBuilder = this.transfersRepository
      .createQueryBuilder('transfer')
      .leftJoinAndSelect('transfer.sender', 'sender')
      .leftJoinAndSelect('transfer.receiver', 'receiver');

    if (role !== 'admin' && role !== 'moderator') {
      queryBuilder.where(
        '(transfer.senderId = :userId OR transfer.receiverId = :userId)',
        { userId }
      );
    }

    if (filters?.startDate && filters?.endDate) {
      queryBuilder.andWhere(
        'transfer.createdAt BETWEEN :startDate AND :endDate',
        { 
          startDate: new Date(filters.startDate), 
          endDate: new Date(filters.endDate) 
        }
      );
    }

    if (filters?.status) {
      queryBuilder.andWhere('transfer.status = :status', { status: filters.status });
    }

    const sortBy = filters?.sortBy || 'createdAt';
    const sortOrder = filters?.sortOrder || 'DESC';
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;

    queryBuilder
      .orderBy(`transfer.${sortBy}`, sortOrder)
      .skip((page - 1) * limit)
      .take(limit);

    const [transfers, total] = await queryBuilder.getManyAndCount();

    return {
      transfers,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      summary: {
        totalAmount: transfers.reduce((sum, t) => sum + Number(t.amount), 0),
        totalCommission: transfers.reduce((sum, t) => sum + Number(t.commission), 0),
        totalCount: transfers.length,
      }
    };
  }

  // 🆕 تأكيد استلام التحويل
  async confirmDelivery(transferId: number, userId: number, deliveryNote?: string): Promise<any> {
    const transfer = await this.transfersRepository.findOne({
      where: { id: transferId },
      relations: ['sender', 'receiver']
    });

    if (!transfer) {
      throw new NotFoundException('التحويل غير موجود');
    }

    if (transfer.receiverId !== userId) {
      throw new ForbiddenException('فقط المستلم يمكنه تأكيد الاستلام');
    }

    if (transfer.status !== TransferStatus.COMPLETED) {
      throw new BadRequestException('لا يمكن تأكيد استلام تحويل غير مكتمل');
    }

    if (transfer.isDelivered) {
      throw new BadRequestException('تم تأكيد استلام هذا التحويل مسبقاً');
    }

    transfer.isDelivered = true;
    transfer.deliveredAt = new Date();
    transfer.deliveryNote = deliveryNote || null;
    transfer.status = TransferStatus.DELIVERED;

    await this.transfersRepository.save(transfer);

    try {
      await this.notificationsService.createNotification({
        userId: transfer.senderId,
        title: '✅ تم تأكيد الاستلام',
        message: `تم تأكيد استلام ${transfer.receiver.username} لمبلغ ${transfer.amount}`,
        type: 'transfer_delivered',
        transferId: transfer.id,
      });
    } catch (error) {
      this.logger.warn('فشل إرسال إشعار تأكيد الاستلام');
    }

    return {
      success: true,
      message: 'تم تأكيد استلام التحويل بنجاح',
      transfer: {
        id: transfer.id,
        referenceNumber: transfer.referenceNumber,
        amount: transfer.amount,
        isDelivered: transfer.isDelivered,
        deliveredAt: transfer.deliveredAt,
        deliveryNote: transfer.deliveryNote,
        status: transfer.status,
      }
    };
  }

  // 🆕 التحويلات التي لم يتم تأكيد استلامها
  async getPendingDeliveryTransfers(userId: number): Promise<any> {
    const transfers = await this.transfersRepository.find({
      where: [
        { receiverId: userId, isDelivered: false, status: TransferStatus.COMPLETED },
        { senderId: userId, isDelivered: false, status: TransferStatus.COMPLETED }
      ],
      relations: ['sender', 'receiver'],
      order: { createdAt: 'DESC' }
    });

    const receivedPending = transfers.filter(t => t.receiverId === userId);
    const sentPending = transfers.filter(t => t.senderId === userId);

    return {
      receivedPending,
      sentPending,
      summary: {
        totalReceivedPending: receivedPending.length,
        totalSentPending: sentPending.length,
        totalAmountReceivedPending: receivedPending.reduce((sum, t) => sum + Number(t.amount), 0),
        totalAmountSentPending: sentPending.reduce((sum, t) => sum + Number(t.amount), 0)
      }
    };
  }

  async cancelTransfer(transferId: number, userId: number, role: string): Promise<any> {
    const transfer = await this.transfersRepository.findOne({
      where: { id: transferId },
      relations: ['sender', 'receiver']
    });

    if (!transfer) {
      throw new NotFoundException('التحويل غير موجود');
    }

    if (transfer.sender.id !== userId && role !== 'admin') {
      throw new ForbiddenException('غير مصرح لك بإلغاء هذا التحويل');
    }

    if (transfer.status !== TransferStatus.PENDING) {
      throw new BadRequestException('يمكن إلغاء التحويلات المعلقة فقط');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    
    try {
      await queryRunner.startTransaction();

      await queryRunner.manager.update(User, transfer.sender.id, {
        points: Number(transfer.sender.points) + Number(transfer.totalAmount)
      });

      await queryRunner.manager.update(User, transfer.receiver.id, {
        points: Number(transfer.receiver.points) - Number(transfer.amount)
      });

      await queryRunner.manager.update(Transfer, transferId, {
        status: TransferStatus.CANCELLED,
        cancelledAt: new Date()
      });

      await queryRunner.commitTransaction();

      return { success: true, message: 'تم إلغاء التحويل وإرجاع المبلغ' };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}