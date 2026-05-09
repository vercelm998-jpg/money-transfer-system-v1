import { 
  Injectable, 
  BadRequestException, 
  NotFoundException,
  Logger,
  ForbiddenException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, QueryRunner } from 'typeorm';
import { WalletTransaction, TransactionType, TransactionStatus } from './transaction.entity';
import { User } from '../users/user.entity';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @InjectRepository(WalletTransaction)
    private walletTransactionRepository: Repository<WalletTransaction>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  async recordTransaction(
    userId: number,
    amount: number,
    type: string,
    description: string,
    referenceId?: number,
    queryRunner?: QueryRunner,
    options?: {
      referenceType?: string;
      metadata?: Record<string, any>;
      fee?: number;
      currency?: string;
    }
  ): Promise<WalletTransaction> {
    const manager = queryRunner ? queryRunner.manager : this.walletTransactionRepository.manager;
    const userRepo = queryRunner 
      ? queryRunner.manager.getRepository(User) 
      : this.usersRepository;
    
    const transactionRepo = queryRunner 
      ? queryRunner.manager.getRepository(WalletTransaction) 
      : this.walletTransactionRepository;

    // جلب المستخدم للحصول على الرصيد الحالي
    const user = await userRepo.findOne({ 
      where: { id: userId },
      select: ['id', 'points']
    });

    if (!user) {
      throw new NotFoundException('المستخدم غير موجود');
    }

    const balanceBefore = Number(user.points);
    const balanceAfter = balanceBefore + amount;

    // التحقق من الرصيد للسحب
    if (amount < 0 && balanceAfter < 0) {
      throw new BadRequestException('رصيد غير كافي');
    }

    // إنشاء سجل المعاملة
    const transaction = transactionRepo.create({
      userId,
      amount,
      balanceBefore,
      balanceAfter,
      type: type as TransactionType,
      status: TransactionStatus.COMPLETED,
      description,
      referenceId,
      referenceType: options?.referenceType,
      metadata: options?.metadata || {},
      fee: options?.fee,
      currency: options?.currency || 'USD',
      completedAt: new Date()
    });

    const savedTransaction = await transactionRepo.save(transaction);

    // // تحديث رصيد المستخدم
    // await userRepo.update(userId, { 
    //   points: balanceAfter 
    // });

    this.logger.log(
      `💰 محفظة - ${type}: ${amount} | المستخدم ${userId} | الرصيد: ${balanceBefore} -> ${balanceAfter} | REF: ${savedTransaction.transactionReference}`
    );

    return savedTransaction;
  }

  async getBalance(userId: number): Promise<any> {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      select: ['id', 'points', 'frozenPoints']
    });

    if (!user) {
      throw new NotFoundException('المستخدم غير موجود');
    }

    return {
      totalBalance: Number(user.points),
      availableBalance: Number(user.points) - Number(user.frozenPoints),
      frozenBalance: Number(user.frozenPoints),
    };
  }

  async getTransactionHistory(
    userId: number,
    role: string,
    query: any = {}
  ): Promise<{ transactions: WalletTransaction[]; total: number }> {
    const { 
      page = 1, 
      limit = 20, 
      type,
      status,
      startDate,
      endDate,
      minAmount,
      maxAmount,
      sortBy = 'createdAt',
      sortOrder = 'DESC',
      search
    } = query;

    const queryBuilder = this.walletTransactionRepository
      .createQueryBuilder('transaction')
      .leftJoinAndSelect('transaction.user', 'user');

    // المستخدم العادي يرى معاملاته فقط
    if (role !== 'admin' && role !== 'moderator') {
      queryBuilder.where('transaction.userId = :userId', { userId });
    }

    // الفلاتر
    if (type) {
      queryBuilder.andWhere('transaction.type = :type', { type });
    }

    if (status) {
      queryBuilder.andWhere('transaction.status = :status', { status });
    }

    if (startDate && endDate) {
      queryBuilder.andWhere(
        'transaction.createdAt BETWEEN :startDate AND :endDate',
        { 
          startDate: new Date(startDate), 
          endDate: new Date(endDate) 
        }
      );
    }

    if (minAmount) {
      queryBuilder.andWhere('ABS(transaction.amount) >= :minAmount', { minAmount });
    }

    if (maxAmount) {
      queryBuilder.andWhere('ABS(transaction.amount) <= :maxAmount', { maxAmount });
    }

    if (search) {
      queryBuilder.andWhere(
        '(transaction.description LIKE :search OR transaction.transactionReference LIKE :search)',
        { search: `%${search}%` }
      );
    }

    // الترتيب والصفحات
    queryBuilder
      .orderBy(`transaction.${sortBy}`, sortOrder)
      .skip((page - 1) * limit)
      .take(limit);

    const [transactions, total] = await queryBuilder.getManyAndCount();

    return { transactions, total };
  }

  async getTransactionById(transactionId: number, userId: number, role: string): Promise<WalletTransaction> {
    const transaction = await this.walletTransactionRepository.findOne({
      where: { id: transactionId },
      relations: ['user']
    });

    if (!transaction) {
      throw new NotFoundException('المعاملة غير موجودة');
    }

    // التحقق من الصلاحية
    if (transaction.userId !== userId && role !== 'admin' && role !== 'moderator') {
      throw new ForbiddenException('غير مصرح لك بمشاهدة هذه المعاملة');
    }

    return transaction;
  }

  async getTransactionSummary(userId: number, period?: string): Promise<any> {
    const queryBuilder = this.walletTransactionRepository
      .createQueryBuilder('transaction')
      .where('transaction.userId = :userId', { userId })
      .andWhere('transaction.status = :status', { status: TransactionStatus.COMPLETED });

    // تحديد الفترة
    if (period) {
      const dateFrom = this.getPeriodStartDate(period);
      if (dateFrom) {
        queryBuilder.andWhere('transaction.createdAt >= :dateFrom', { dateFrom });
      }
    }

    // إحصائيات حسب النوع
    const typeStats = await queryBuilder
      .select('transaction.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .addSelect('SUM(transaction.amount)', 'totalAmount')
      .addSelect('SUM(transaction.fee)', 'totalFees')
      .groupBy('transaction.type')
      .getRawMany();

    // المجاميع
    const totals = await queryBuilder
      .select('SUM(transaction.amount)', 'totalAmount')
      .addSelect('SUM(transaction.fee)', 'totalFees')
      .addSelect('COUNT(*)', 'totalTransactions')
      .getRawOne();

    // الرصيد الحالي
    const balance = await this.getBalance(userId);

    return {
      balance,
      period: period || 'all_time',
      summary: {
        totalCredits: typeStats
          .filter(s => Number(s.totalAmount) > 0)
          .reduce((sum, s) => sum + Number(s.totalAmount), 0),
        totalDebits: Math.abs(
          typeStats
            .filter(s => Number(s.totalAmount) < 0)
            .reduce((sum, s) => sum + Number(s.totalAmount), 0)
        ),
        totalFees: Number(totals.totalFees) || 0,
        totalTransactions: Number(totals.totalTransactions) || 0,
      },
      byType: typeStats.map(s => ({
        type: s.type,
        count: Number(s.count),
        totalAmount: Math.abs(Number(s.totalAmount)),
        totalFees: Number(s.totalFees) || 0
      }))
    };
  }

  private getPeriodStartDate(period: string): Date | null {
    const now = new Date();
    
    switch (period) {
      case 'today':
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
      case 'week':
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        return weekAgo;
      case 'month':
        const monthAgo = new Date();
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        return monthAgo;
      case 'quarter':
        const quarterAgo = new Date();
        quarterAgo.setMonth(quarterAgo.getMonth() - 3);
        return quarterAgo;
      case 'year':
        const yearAgo = new Date();
        yearAgo.setFullYear(yearAgo.getFullYear() - 1);
        return yearAgo;
      default:
        return null; // all time
    }
  }

  async refundTransaction(transactionId: number, reason: string, adminId: number): Promise<WalletTransaction> {
    const originalTransaction = await this.walletTransactionRepository.findOne({
      where: { id: transactionId }
    });

    if (!originalTransaction) {
      throw new NotFoundException('المعاملة غير موجودة');
    }

    if (originalTransaction.status !== TransactionStatus.COMPLETED) {
      throw new BadRequestException('يمكن استرداد المعاملات المكتملة فقط');
    }

    // إنشاء معاملة استرداد
    const refundTransaction = await this.recordTransaction(
      originalTransaction.userId,
      -originalTransaction.amount, // عكس المبلغ
      TransactionType.REFUND,
      `استرداد: ${reason} (REF: ${originalTransaction.transactionReference})`,
      originalTransaction.id,
      null,
      {
        referenceType: 'wallet_transaction',
        metadata: {
          originalTransactionId: originalTransaction.id,
          refundedBy: adminId,
          reason
        }
      }
    );

    // تحديث حالة المعاملة الأصلية
await this.walletTransactionRepository.update(transactionId, {
  status: TransactionStatus.REVERSED,
  metadata: () => JSON.stringify({
    ...(originalTransaction.metadata || {}),
    reversedAt: new Date(),
    reversedBy: adminId,
    reason
  })
} as any);
    this.logger.log(
      `↩️ استرداد - TXN ${transactionId} | المستخدم ${originalTransaction.userId} | السبب: ${reason}`
    );

    return refundTransaction;
  }

  async getDailyReport(startDate: Date, endDate: Date): Promise<any> {
    const transactions = await this.walletTransactionRepository
      .createQueryBuilder('transaction')
      .select('DATE(transaction.createdAt)', 'date')
      .addSelect('transaction.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .addSelect('SUM(transaction.amount)', 'totalAmount')
      .addSelect('SUM(transaction.fee)', 'totalFees')
      .where('transaction.createdAt BETWEEN :startDate AND :endDate', {
        startDate,
        endDate
      })
      .andWhere('transaction.status = :status', { 
        status: TransactionStatus.COMPLETED 
      })
      .groupBy('DATE(transaction.createdAt)')
      .addGroupBy('transaction.type')
      .orderBy('date', 'ASC')
      .getRawMany();

    // تجميع النتائج حسب التاريخ
    const dailyReport = {};
    transactions.forEach(t => {
      if (!dailyReport[t.date]) {
        dailyReport[t.date] = {
          date: t.date,
          totalTransactions: 0,
          totalVolume: 0,
          totalFees: 0,
          byType: {}
        };
      }
      
      dailyReport[t.date].totalTransactions += Number(t.count);
      dailyReport[t.date].totalVolume += Math.abs(Number(t.totalAmount));
      dailyReport[t.date].totalFees += Number(t.totalFees) || 0;
      dailyReport[t.date].byType[t.type] = {
        count: Number(t.count),
        amount: Math.abs(Number(t.totalAmount))
      };
    });

    return {
      startDate,
      endDate,
      days: Object.values(dailyReport)
    };
  }
}