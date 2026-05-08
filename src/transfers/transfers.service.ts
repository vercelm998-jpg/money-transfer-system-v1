import { 
  Injectable, 
  BadRequestException, 
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
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

    if (senderId === receiverId) {
      throw new BadRequestException('لا يمكنك التحويل إلى نفسك');
    }

    if (!amount || amount <= 0) {
      throw new BadRequestException('المبلغ يجب أن يكون أكبر من صفر');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    
    try {
      await queryRunner.startTransaction();

      const sender = await queryRunner.manager.findOne(User, { where: { id: senderId } });
      const receiver = await queryRunner.manager.findOne(User, { where: { id: receiverId } });

      if (!sender) throw new NotFoundException('حسابك غير موجود');
      if (!receiver) throw new NotFoundException('المستلم غير موجود');
      if (sender.status !== UserStatus.ACTIVE) throw new ForbiddenException('حسابك غير نشط');
      if (receiver.status !== UserStatus.ACTIVE) throw new BadRequestException('حساب المستلم غير نشط');

      // 🆕 حساب العمولة - FIXED
      let commission: number;
      let commissionRate: number;
      let customCommission = false;

      if (commissionAmount !== undefined && commissionAmount !== null) {
        // المستخدم حدد العمولة يدوياً (حتى لو 0)
        commission = Number(commissionAmount);
        commissionRate = amount > 0 ? commission / amount : 0;
        customCommission = true;
      } else {
        // النسبة الافتراضية
        commissionRate = Number(sender.commissionRate) || 0.01;
        commission = Number((amount * commissionRate).toFixed(2));
      }

      const totalAmount = Number((amount + commission).toFixed(2));

      // ✅ DEBUG LOGS
      this.logger.log(`💰 SENDER: ${sender.username} | Balance BEFORE: ${sender.points} | Amount: ${amount} | Commission: ${commission} | Total: ${totalAmount}`);
      this.logger.log(`💰 RECEIVER: ${receiver.username} | Balance BEFORE: ${receiver.points}`);

      // التحقق من الرصيد
      const senderBalance = Number(sender.points);
      if (senderBalance < totalAmount) {
        throw new BadRequestException(`رصيدك غير كافي. الرصيد المتاح: ${senderBalance.toFixed(2)}`);
      }

      // التحقق من الحدود
      const transferCheck = sender.canTransfer(totalAmount);
      if (!transferCheck.can) {
        throw new BadRequestException(transferCheck.reason);
      }

      const selectedCurrency = currency || 'USD';

      // ✅ تحديث الأرصدة - مرة واحدة فقط
      const newSenderBalance = Number((senderBalance - totalAmount).toFixed(2));
      const newReceiverBalance = Number((Number(receiver.points) + amount).toFixed(2));

      await queryRunner.manager.update(User, senderId, {
        points: newSenderBalance,
        dailyTransferred: Number((Number(sender.dailyTransferred || 0) + amount).toFixed(2)),
        monthlyTransferred: Number((Number(sender.monthlyTransferred || 0) + amount).toFixed(2)),
        totalTransfers: (sender.totalTransfers || 0) + 1,
        lastTransferAt: new Date(),
      });

      await queryRunner.manager.update(User, receiverId, {
        points: newReceiverBalance,
      });

      this.logger.log(`✅ SENDER: ${sender.username} | Balance AFTER: ${newSenderBalance}`);
      this.logger.log(`✅ RECEIVER: ${receiver.username} | Balance AFTER: ${newReceiverBalance}`);

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
      transfer.metadata = { ...metadata, commissionRate, customCommission, currency: selectedCurrency };

      const timestamp = Date.now().toString(36);
      const random = Math.random().toString(36).substring(2, 8).toUpperCase();
      transfer.referenceNumber = `TRF-${timestamp}-${random}`;

      const savedTransfer = await queryRunner.manager.save(transfer);

      // محفظة - إشعارات - تدقيق
      try {
        await this.walletService.recordTransaction(senderId, -totalAmount, 'transfer_out', `تحويل ${amount} إلى ${receiver.username}`, savedTransfer.id, queryRunner);
        await this.walletService.recordTransaction(receiverId, amount, 'transfer_in', `استلام ${amount} من ${sender.username}`, savedTransfer.id, queryRunner);
      } catch (e) { this.logger.warn('Wallet error: ' + e.message); }

      try {
        await this.notificationsService.createNotification({ userId: receiverId, title: '💰 تحويل جديد', message: `تم استلام ${amount} من ${sender.username}`, type: 'transfer_received', transferId: savedTransfer.id });
        await this.notificationsService.createNotification({ userId: senderId, title: '✅ تم التحويل', message: `تم تحويل ${amount} إلى ${receiver.username}`, type: 'transfer_sent', transferId: savedTransfer.id });
      } catch (e) { this.logger.warn('Notification error: ' + e.message); }

      try {
        await this.auditService.logAction(senderId, 'TRANSFER_COMPLETED', `تحويل ${amount} إلى ${receiver.username}`, { transferId: savedTransfer.id, referenceNumber: savedTransfer.referenceNumber });
      } catch (e) { this.logger.warn('Audit error: ' + e.message); }

      await queryRunner.commitTransaction();

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
          sender: { id: sender.id, username: sender.username, newBalance: newSenderBalance },
          receiver: { id: receiver.id, username: receiver.username },
          note: savedTransfer.note,
          status: savedTransfer.status,
          createdAt: savedTransfer.createdAt,
          completedAt: savedTransfer.completedAt,
        },
      };
    } catch (error) {
      this.logger.error(`❌ فشل التحويل: ${error.message}`);
      try { await queryRunner.rollbackTransaction(); } catch (e) {}
      throw error;
    } finally {
      try { await queryRunner.release(); } catch (e) {}
    }
  }

  async findById(id: number): Promise<Transfer> {
    const transfer = await this.transfersRepository.findOne({ where: { id }, relations: ['sender', 'receiver'] });
    if (!transfer) throw new NotFoundException('التحويل غير موجود');
    return transfer;
  }

  async findByReference(referenceNumber: string): Promise<Transfer> {
    const transfer = await this.transfersRepository.findOne({ where: { referenceNumber }, relations: ['sender', 'receiver'] });
    if (!transfer) throw new NotFoundException('التحويل غير موجود');
    return transfer;
  }

  async getTransferHistory(userId: number, role: string, filters?: any): Promise<any> {
    const queryBuilder = this.transfersRepository.createQueryBuilder('transfer')
      .leftJoinAndSelect('transfer.sender', 'sender')
      .leftJoinAndSelect('transfer.receiver', 'receiver');

    if (role !== 'admin' && role !== 'moderator') {
      queryBuilder.where('(transfer.senderId = :userId OR transfer.receiverId = :userId)', { userId });
    }

    if (filters?.startDate && filters?.endDate) {
      queryBuilder.andWhere('transfer.createdAt BETWEEN :startDate AND :endDate', { startDate: new Date(filters.startDate), endDate: new Date(filters.endDate) });
    }
    if (filters?.status) queryBuilder.andWhere('transfer.status = :status', { status: filters.status });

    const sortBy = filters?.sortBy || 'createdAt';
    const sortOrder = filters?.sortOrder || 'DESC';
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;

    queryBuilder.orderBy(`transfer.${sortBy}`, sortOrder).skip((page - 1) * limit).take(limit);

    const [transfers, total] = await queryBuilder.getManyAndCount();

    return {
      transfers, total, page, limit,
      totalPages: Math.ceil(total / limit),
      summary: {
        totalAmount: transfers.reduce((sum, t) => sum + Number(t.amount), 0),
        totalCommission: transfers.reduce((sum, t) => sum + Number(t.commission), 0),
        totalCount: transfers.length,
      },
    };
  }

  async confirmDelivery(transferId: number, userId: number, deliveryNote?: string): Promise<any> {
    const transfer = await this.transfersRepository.findOne({ where: { id: transferId }, relations: ['sender', 'receiver'] });
    if (!transfer) throw new NotFoundException('التحويل غير موجود');
    if (transfer.receiverId !== userId) throw new ForbiddenException('فقط المستلم يمكنه تأكيد الاستلام');
    if (transfer.status !== TransferStatus.COMPLETED) throw new BadRequestException('لا يمكن تأكيد استلام تحويل غير مكتمل');
    if (transfer.isDelivered) throw new BadRequestException('تم تأكيد استلام هذا التحويل مسبقاً');

    transfer.isDelivered = true;
    transfer.deliveredAt = new Date();
    transfer.deliveryNote = deliveryNote || null;
    transfer.status = TransferStatus.DELIVERED;
    await this.transfersRepository.save(transfer);

    return { success: true, message: 'تم تأكيد استلام التحويل بنجاح' };
  }

  async getPendingDeliveryTransfers(userId: number): Promise<any> {
    const transfers = await this.transfersRepository.find({
      where: [
        { receiverId: userId, isDelivered: false, status: TransferStatus.COMPLETED },
        { senderId: userId, isDelivered: false, status: TransferStatus.COMPLETED },
      ],
      relations: ['sender', 'receiver'],
      order: { createdAt: 'DESC' },
    });

    return {
      receivedPending: transfers.filter(t => t.receiverId === userId),
      sentPending: transfers.filter(t => t.senderId === userId),
      summary: {
        totalReceivedPending: transfers.filter(t => t.receiverId === userId).length,
        totalSentPending: transfers.filter(t => t.senderId === userId).length,
      },
    };
  }

  async getDeliveryStats(userId: number): Promise<any> {
    const transfers = await this.transfersRepository.find({
      where: [
        { receiverId: userId, status: In([TransferStatus.COMPLETED, TransferStatus.DELIVERED]) },
        { senderId: userId, status: In([TransferStatus.COMPLETED, TransferStatus.DELIVERED]) },
      ],
    });
    return {
      received: { total: transfers.filter(t => t.receiverId === userId).length, delivered: transfers.filter(t => t.receiverId === userId && t.isDelivered).length },
      sent: { total: transfers.filter(t => t.senderId === userId).length, delivered: transfers.filter(t => t.senderId === userId && t.isDelivered).length },
    };
  }

  async cancelTransfer(transferId: number, userId: number, role: string): Promise<any> {
    const transfer = await this.transfersRepository.findOne({ where: { id: transferId }, relations: ['sender', 'receiver'] });
    if (!transfer) throw new NotFoundException('التحويل غير موجود');
    if (transfer.sender.id !== userId && role !== 'admin') throw new ForbiddenException('غير مصرح لك');

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await queryRunner.startTransaction();
      await queryRunner.manager.update(User, transfer.sender.id, { points: Number(transfer.sender.points) + Number(transfer.totalAmount) });
      await queryRunner.manager.update(User, transfer.receiver.id, { points: Number(transfer.receiver.points) - Number(transfer.amount) });
      await queryRunner.manager.update(Transfer, transferId, { status: TransferStatus.CANCELLED, cancelledAt: new Date() });
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