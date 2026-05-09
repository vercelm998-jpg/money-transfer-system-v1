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

      // ✅ لا عمولة إلا إذا أدخلها المستخدم
      let commission = 0;
      if (commissionAmount !== undefined && commissionAmount !== null) {
        commission = Number(commissionAmount);
      }

      const totalAmount = Number((amount + commission).toFixed(2));

      this.logger.log(`💰 المبلغ=${amount} | العمولة=${commission} | الإجمالي=${totalAmount}`);

      // التحقق من الرصيد
      const senderBalance = Number(sender.points);
      if (senderBalance < totalAmount) {
        throw new BadRequestException(`رصيدك غير كافي. الرصيد: ${senderBalance.toFixed(2)}`);
      }

      // ✅ تحديث رصيد المرسل - مرة واحدة فقط
      const newSenderBalance = Number((senderBalance - totalAmount).toFixed(2));
      await queryRunner.manager.update(User, senderId, {
        points: newSenderBalance,
        dailyTransferred: Number((Number(sender.dailyTransferred || 0) + amount).toFixed(2)),
        monthlyTransferred: Number((Number(sender.monthlyTransferred || 0) + amount).toFixed(2)),
        totalTransfers: (sender.totalTransfers || 0) + 1,
        lastTransferAt: new Date(),
      });

      // ✅ تحديث رصيد المستلم - مرة واحدة فقط
      const currentReceiverBalance = Number(receiver.points);
      const newReceiverBalance = Number((currentReceiverBalance + amount).toFixed(2));
      await queryRunner.manager.update(User, receiverId, {
        points: newReceiverBalance,
      });

      this.logger.log(`✅ SENDER: ${sender.username} | ${senderBalance} → ${newSenderBalance}`);
      this.logger.log(`✅ RECEIVER: ${receiver.username} | ${currentReceiverBalance} → ${newReceiverBalance}`);

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
      transfer.metadata = { ...metadata, currency: currency || 'USD' };
  

// 🆕 اسم المستفيد - إذا أرسله المستخدم أو استخدم اسم المستلم
transfer.beneficiaryName = createTransferDto.beneficiaryName || receiver.username;
      const timestamp = Date.now().toString(36);
      const random = Math.random().toString(36).substring(2, 8).toUpperCase();
      transfer.referenceNumber = `TRF-${timestamp}-${random}`;

      const savedTransfer = await queryRunner.manager.save(transfer);

      // ✅ سجل في المحفظة للمرسل فقط
      try {
        await this.walletService.recordTransaction(
          senderId, -totalAmount, 'transfer_out',
          `تحويل ${amount} إلى ${receiver.username}`,
          savedTransfer.id, queryRunner
        );
      } catch (e) { this.logger.warn('Wallet sender: ' + e.message); }

      // إشعارات
      try {
        await this.notificationsService.createNotification({
          userId: receiverId, title: '💰 تحويل جديد',
          message: `تم استلام ${amount} من ${sender.username}`,
          type: 'transfer_received', transferId: savedTransfer.id,
        });
        await this.notificationsService.createNotification({
          userId: senderId, title: '✅ تم التحويل',
          message: `تم تحويل ${amount} إلى ${receiver.username}`,
          type: 'transfer_sent', transferId: savedTransfer.id,
        });
      } catch (e) { this.logger.warn('Notif: ' + e.message); }

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
          sender: { id: sender.id, username: sender.username, newBalance: newSenderBalance },
          receiver: { id: receiver.id, username: receiver.username },
          note: savedTransfer.note,
          status: savedTransfer.status,
          createdAt: savedTransfer.createdAt,
        },
      };
    } catch (error) {
      this.logger.error(`❌ فشل: ${error.message}`);
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

  // ✅ تحديث getTransferHistory مع البحث المتقدم
  async getTransferHistory(userId: number, role: string, filters?: any): Promise<any> {
    const queryBuilder = this.transfersRepository.createQueryBuilder('transfer')
      .leftJoinAndSelect('transfer.sender', 'sender')
      .leftJoinAndSelect('transfer.receiver', 'receiver');

    if (role !== 'admin' && role !== 'moderator') {
      queryBuilder.where('(transfer.senderId = :userId OR transfer.receiverId = :userId)', { userId });
    }

    // ✅ بحث متقدم
    if (filters?.search) {
      queryBuilder.andWhere(
        `(transfer.referenceNumber LIKE :search 
          OR transfer.note LIKE :search 
          OR sender.username LIKE :search 
          OR receiver.username LIKE :search
          OR CAST(transfer.createdAt AS TEXT) LIKE :search)`,
        { search: `%${filters.search}%` }
      );
    }

    if (filters?.startDate && filters?.endDate) {
      queryBuilder.andWhere('transfer.createdAt BETWEEN :startDate AND :endDate', {
        startDate: new Date(filters.startDate), endDate: new Date(filters.endDate),
      });
    }
    if (filters?.status) queryBuilder.andWhere('transfer.status = :status', { status: filters.status });

    queryBuilder.orderBy(`transfer.${filters?.sortBy || 'createdAt'}`, filters?.sortOrder || 'DESC')
      .skip(((filters?.page || 1) - 1) * (filters?.limit || 20))
      .take(filters?.limit || 20);

    const [transfers, total] = await queryBuilder.getManyAndCount();

    return {
      transfers, total,
      page: filters?.page || 1,
      limit: filters?.limit || 20,
      totalPages: Math.ceil(total / (filters?.limit || 20)),
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
