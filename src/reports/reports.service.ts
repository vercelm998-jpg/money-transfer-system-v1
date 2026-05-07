import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';
import { Transfer, TransferStatus } from '../transfers/transfer.entity';
import { User } from '../users/user.entity';
import { WalletTransaction, TransactionType } from '../wallet/transaction.entity';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @InjectRepository(Transfer)
    private transfersRepository: Repository<Transfer>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(WalletTransaction)
    private walletTransactionRepository: Repository<WalletTransaction>,
  ) {}

  // ================ تقرير يومي ================
  async getDailyReport(date?: string): Promise<any> {
    const reportDate = date ? new Date(date) : new Date();
    const startOfDay = new Date(reportDate);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(reportDate);
    endOfDay.setHours(23, 59, 59, 999);

    return this.generateReport(startOfDay, endOfDay, 'يومي', reportDate);
  }

  // ================ تقرير أسبوعي ================
  async getWeeklyReport(startDate?: string): Promise<any> {
    const today = new Date();
    const startOfWeek = startDate ? new Date(startDate) : this.getStartOfWeek(today);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    return this.generateReport(startOfWeek, endOfWeek, 'أسبوعي');
  }

  // ================ تقرير شهري ================
  async getMonthlyReport(year?: number, month?: number): Promise<any> {
    const today = new Date();
    const reportYear = year || today.getFullYear();
    const reportMonth = month !== undefined ? month : today.getMonth() + 1;

    const startOfMonth = new Date(reportYear, reportMonth - 1, 1);
    const endOfMonth = new Date(reportYear, reportMonth, 0);
    endOfMonth.setHours(23, 59, 59, 999);

    return this.generateReport(startOfMonth, endOfMonth, 'شهري');
  }

  // ================ تقرير نصف سنوي ================
  async getSemiAnnualReport(year?: number, half?: number): Promise<any> {
    const today = new Date();
    const reportYear = year || today.getFullYear();
    const reportHalf = half || (today.getMonth() < 6 ? 1 : 2);

    const startMonth = reportHalf === 1 ? 0 : 6;
    const startOfPeriod = new Date(reportYear, startMonth, 1);
    const endOfPeriod = new Date(reportYear, startMonth + 5, 0);
    endOfPeriod.setHours(23, 59, 59, 999);

    const periodName = reportHalf === 1 ? 'النصف الأول' : 'النصف الثاني';
    return this.generateReport(startOfPeriod, endOfPeriod, `نصف سنوي - ${periodName}`);
  }

  // ================ تقرير سنوي ================
  async getAnnualReport(year?: number): Promise<any> {
    const reportYear = year || new Date().getFullYear();
    const startOfYear = new Date(reportYear, 0, 1);
    const endOfYear = new Date(reportYear, 11, 31);
    endOfYear.setHours(23, 59, 59, 999);

    return this.generateReport(startOfYear, endOfYear, 'سنوي');
  }

  // ================ تقرير مخصص (أي فترة) ================
  async getCustomReport(startDate: string, endDate: string): Promise<any> {
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    return this.generateReport(start, end, 'مخصص');
  }

  // ================ تقرير مستخدم محدد ================
  async getUserReport(userId: number, period: string, date?: string): Promise<any> {
    let startDate: Date;
    let endDate: Date = new Date();
    const today = new Date();

    switch (period) {
      case 'daily':
        startDate = new Date(date || today);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(date || today);
        endDate.setHours(23, 59, 59, 999);
        break;
      case 'weekly':
        startDate = this.getStartOfWeek(date ? new Date(date) : today);
        endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 6);
        endDate.setHours(23, 59, 59, 999);
        break;
      case 'monthly':
        const d = date ? new Date(date) : today;
        startDate = new Date(d.getFullYear(), d.getMonth(), 1);
        endDate = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        endDate.setHours(23, 59, 59, 999);
        break;
      case 'yearly':
        const year = date ? new Date(date).getFullYear() : today.getFullYear();
        startDate = new Date(year, 0, 1);
        endDate = new Date(year, 11, 31);
        endDate.setHours(23, 59, 59, 999);
        break;
      default:
        startDate = new Date(today);
        startDate.setHours(0, 0, 0, 0);
    }

    return this.generateUserReport(userId, startDate, endDate, period);
  }

  // ================ تقرير العمولات ================
  async getCommissionReport(period: string, date?: string): Promise<any> {
    const { startDate, endDate } = this.getDateRange(period, date);
    
    const transfers = await this.transfersRepository.find({
      where: {
        createdAt: Between(startDate, endDate),
        status: TransferStatus.COMPLETED
      },
      relations: ['sender']
    });

    const totalCommission = transfers.reduce((sum, t) => sum + Number(t.commission), 0);
    const totalTransfers = transfers.length;
    const totalAmount = transfers.reduce((sum, t) => sum + Number(t.amount), 0);

    // تجميع العمولات حسب اليوم
    const commissionByDay = {};
    transfers.forEach(t => {
      const day = t.createdAt.toISOString().split('T')[0];
      if (!commissionByDay[day]) {
        commissionByDay[day] = { date: day, transfers: 0, amount: 0, commission: 0 };
      }
      commissionByDay[day].transfers++;
      commissionByDay[day].amount += Number(t.amount);
      commissionByDay[day].commission += Number(t.commission);
    });

    return {
      title: `تقرير العمولات - ${this.getPeriodName(period)}`,
      period: { startDate, endDate },
      summary: {
        totalTransfers,
        totalAmount: Number(totalAmount.toFixed(2)),
        totalCommission: Number(totalCommission.toFixed(2)),
        averageCommission: totalTransfers > 0 ? Number((totalCommission / totalTransfers).toFixed(2)) : 0,
        commissionRate: totalAmount > 0 ? ((totalCommission / totalAmount) * 100).toFixed(2) + '%' : '0%'
      },
      dailyBreakdown: Object.values(commissionByDay).sort((a: any, b: any) => a.date.localeCompare(b.date)),
      timestamp: new Date().toISOString()
    };
  }

  // ================ تقرير مقارنة الفترات ================
  async getComparisonReport(): Promise<any> {
    const today = new Date();
    
    // الفترة الحالية (هذا الشهر)
    const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const currentMonthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59);
    
    // الفترة السابقة (الشهر الماضي)
    const previousMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const previousMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59);
    
    // هذا الأسبوع
    const thisWeekStart = this.getStartOfWeek(today);
    const thisWeekEnd = new Date(thisWeekStart);
    thisWeekEnd.setDate(thisWeekEnd.getDate() + 6);
    thisWeekEnd.setHours(23, 59, 59, 999);
    
    // الأسبوع الماضي
    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const lastWeekEnd = new Date(thisWeekStart);
    lastWeekEnd.setDate(lastWeekEnd.getDate() - 1);
    lastWeekEnd.setHours(23, 59, 59, 999);

    const currentMonth = await this.getStatsForPeriod(currentMonthStart, currentMonthEnd);
    const previousMonth = await this.getStatsForPeriod(previousMonthStart, previousMonthEnd);
    const thisWeek = await this.getStatsForPeriod(thisWeekStart, thisWeekEnd);
    const lastWeek = await this.getStatsForPeriod(lastWeekStart, lastWeekEnd);

    return {
      title: 'تقرير مقارنة الفترات',
      monthly: {
        current: { period: `${today.getFullYear()}/${today.getMonth() + 1}`, ...currentMonth },
        previous: { period: `${today.getFullYear()}/${today.getMonth()}`, ...previousMonth },
        change: {
          transfers: this.calculateChange(previousMonth.totalTransfers, currentMonth.totalTransfers),
          amount: this.calculateChange(previousMonth.totalAmount, currentMonth.totalAmount),
          commission: this.calculateChange(previousMonth.totalCommission, currentMonth.totalCommission)
        }
      },
      weekly: {
        current: { ...thisWeek },
        previous: { ...lastWeek },
        change: {
          transfers: this.calculateChange(lastWeek.totalTransfers, thisWeek.totalTransfers),
          amount: this.calculateChange(lastWeek.totalAmount, thisWeek.totalAmount),
          commission: this.calculateChange(lastWeek.totalCommission, thisWeek.totalCommission)
        }
      },
      timestamp: new Date().toISOString()
    };
  }

  // ================ ملخص النظام الكامل ================
  async getSystemSummary(): Promise<any> {
    const totalUsers = await this.usersRepository.count();
    const activeUsers = await this.usersRepository.count({ where: { status: 'active' as any } });
    
    const totalTransfers = await this.transfersRepository.count();
    const completedTransfers = await this.transfersRepository.count({ 
      where: { status: TransferStatus.COMPLETED } 
    });

    const allTransfers = await this.transfersRepository.find({
      where: { status: TransferStatus.COMPLETED }
    });

    const totalVolume = allTransfers.reduce((sum, t) => sum + Number(t.amount), 0);
    const totalCommission = allTransfers.reduce((sum, t) => sum + Number(t.commission), 0);

    // أكبر 5 مرسلين
    const topSenders = await this.getTopUsers('sender', 5);
    
    // أكبر 5 مستقبلين
    const topReceivers = await this.getTopUsers('receiver', 5);

    // آخر 10 تحويلات
    const recentTransfers = await this.transfersRepository.find({
      relations: ['sender', 'receiver'],
      order: { createdAt: 'DESC' },
      take: 10
    });

    return {
      title: 'ملخص النظام',
      users: {
        total: totalUsers,
        active: activeUsers,
        inactive: totalUsers - activeUsers
      },
      transfers: {
        total: totalTransfers,
        completed: completedTransfers,
        pending: totalTransfers - completedTransfers,
        totalVolume: Number(totalVolume.toFixed(2)),
        totalCommission: Number(totalCommission.toFixed(2))
      },
      topSenders: topSenders.map(u => ({
        id: u.id,
        username: u.username,
        transfers: u.transferCount,
        volume: Number(u.totalAmount.toFixed(2))
      })),
      topReceivers: topReceivers.map(u => ({
        id: u.id,
        username: u.username,
        transfers: u.transferCount,
        volume: Number(u.totalAmount.toFixed(2))
      })),
      recentTransfers: recentTransfers.map(t => ({
        id: t.id,
        reference: t.referenceNumber,
        from: t.sender.username,
        to: t.receiver.username,
        amount: Number(t.amount),
        date: t.createdAt
      })),
      timestamp: new Date().toISOString()
    };
  }

  // ================ الدوال المساعدة ================
  
  private async generateReport(startDate: Date, endDate: Date, periodName: string, specificDate?: Date): Promise<any> {
    // إحصائيات التحويلات
    const transfers = await this.transfersRepository.find({
      where: {
        createdAt: Between(startDate, endDate),
        status: TransferStatus.COMPLETED
      },
      relations: ['sender', 'receiver']
    });

    // المستخدمين الجدد في الفترة
    const newUsers = await this.usersRepository.count({
      where: { createdAt: Between(startDate, endDate) }
    });

    // إجمالي التحويلات
    const totalTransfers = transfers.length;
    const totalAmount = transfers.reduce((sum, t) => sum + Number(t.amount), 0);
    const totalCommission = transfers.reduce((sum, t) => sum + Number(t.commission), 0);
    
    // متوسط قيمة التحويل
    const averageAmount = totalTransfers > 0 ? totalAmount / totalTransfers : 0;
    
    // أعلى تحويل
    const maxTransfer = transfers.length > 0 ? 
      Math.max(...transfers.map(t => Number(t.amount))) : 0;
    
    // أقل تحويل
    const minTransfer = transfers.length > 0 ? 
      Math.min(...transfers.map(t => Number(t.amount))) : 0;

    // توزيع التحويلات حسب اليوم
    const dailyBreakdown = this.getDailyBreakdown(transfers);
    
    // توزيع التحويلات حسب الساعة
    const hourlyBreakdown = this.getHourlyBreakdown(transfers);

    // أكثر المستخدمين إرسالاً
    const topSenders = this.getTopUsersFromTransfers(transfers, 'sender', 10);
    
    // أكثر المستخدمين استقبالاً
    const topReceivers = this.getTopUsersFromTransfers(transfers, 'receiver', 10);

    // نسبة النجاح
    const totalAttempts = await this.transfersRepository.count({
      where: { createdAt: Between(startDate, endDate) }
    });
    const successRate = totalAttempts > 0 ? ((totalTransfers / totalAttempts) * 100).toFixed(2) + '%' : '0%';

    return {
      title: `التقرير الـ${periodName}`,
      period: {
        name: periodName,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        days: Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
      },
      summary: {
        totalTransfers,
        totalAmount: Number(totalAmount.toFixed(2)),
        totalCommission: Number(totalCommission.toFixed(2)),
        averageAmount: Number(averageAmount.toFixed(2)),
        maxTransfer: Number(maxTransfer.toFixed(2)),
        minTransfer: Number(minTransfer.toFixed(2)),
        successRate,
        newUsers,
        netProfit: Number(totalCommission.toFixed(2))
      },
      charts: {
        dailyBreakdown,
        hourlyBreakdown
      },
      rankings: {
        topSenders,
        topReceivers
      },
      generatedAt: new Date().toISOString()
    };
  }

  private async generateUserReport(userId: number, startDate: Date, endDate: Date, period: string): Promise<any> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    
    if (!user) {
      throw new Error('المستخدم غير موجود');
    }

    // التحويلات المرسلة
    const sentTransfers = await this.transfersRepository.find({
      where: {
        senderId: userId,
        createdAt: Between(startDate, endDate)
      },
      relations: ['receiver']
    });

    // التحويلات المستلمة
    const receivedTransfers = await this.transfersRepository.find({
      where: {
        receiverId: userId,
        createdAt: Between(startDate, endDate)
      },
      relations: ['sender']
    });

    const totalSent = sentTransfers.reduce((sum, t) => sum + Number(t.amount), 0);
    const totalReceived = receivedTransfers.reduce((sum, t) => sum + Number(t.amount), 0);
    const totalCommission = sentTransfers.reduce((sum, t) => sum + Number(t.commission), 0);

    return {
      title: `تقرير المستخدم: ${user.username} - ${period}`,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        currentBalance: Number(user.points),
        status: user.status
      },
      period: { startDate, endDate },
      sent: {
        count: sentTransfers.length,
        totalAmount: Number(totalSent.toFixed(2)),
        totalCommission: Number(totalCommission.toFixed(2)),
        transfers: sentTransfers.slice(0, 20).map(t => ({
          id: t.id,
          reference: t.referenceNumber,
          to: t.receiver.username,
          amount: Number(t.amount),
          commission: Number(t.commission),
          date: t.createdAt,
          status: t.status
        }))
      },
      received: {
        count: receivedTransfers.length,
        totalAmount: Number(totalReceived.toFixed(2)),
        transfers: receivedTransfers.slice(0, 20).map(t => ({
          id: t.id,
          reference: t.referenceNumber,
          from: t.sender.username,
          amount: Number(t.amount),
          date: t.createdAt,
          status: t.status
        }))
      },
      summary: {
        netChange: Number((totalReceived - totalSent - totalCommission).toFixed(2)),
        totalTransactions: sentTransfers.length + receivedTransfers.length
      },
      timestamp: new Date().toISOString()
    };
  }

  private getDailyBreakdown(transfers: Transfer[]): any[] {
    const breakdown: Record<string, any> = {};
    
    transfers.forEach(t => {
      const day = t.createdAt.toISOString().split('T')[0];
      if (!breakdown[day]) {
        breakdown[day] = {
          date: day,
          count: 0,
          amount: 0,
          commission: 0
        };
      }
      breakdown[day].count++;
      breakdown[day].amount += Number(t.amount);
      breakdown[day].commission += Number(t.commission);
    });

    return Object.values(breakdown).sort((a: any, b: any) => a.date.localeCompare(b.date));
  }

  private getHourlyBreakdown(transfers: Transfer[]): any[] {
    const hours = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      count: 0,
      amount: 0
    }));

    transfers.forEach(t => {
      const hour = t.createdAt.getHours();
      hours[hour].count++;
      hours[hour].amount += Number(t.amount);
    });

    return hours;
  }

  private getTopUsersFromTransfers(transfers: Transfer[], type: 'sender' | 'receiver', limit: number): any[] {
    const userStats: Record<number, any> = {};

    transfers.forEach(t => {
      const user = t[type];
      if (!userStats[user.id]) {
        userStats[user.id] = {
          id: user.id,
          username: user.username,
          transferCount: 0,
          totalAmount: 0
        };
      }
      userStats[user.id].transferCount++;
      userStats[user.id].totalAmount += Number(t.amount);
    });

    return Object.values(userStats)
      .sort((a: any, b: any) => b.totalAmount - a.totalAmount)
      .slice(0, limit);
  }

  private async getTopUsers(type: 'sender' | 'receiver', limit: number): Promise<any[]> {
    const transfers = await this.transfersRepository.find({
      where: { status: TransferStatus.COMPLETED },
      relations: [type]
    });

    const userStats: Record<number, any> = {};

    transfers.forEach(t => {
      const user = t[type];
      if (!userStats[user.id]) {
        userStats[user.id] = {
          id: user.id,
          username: user.username,
          transferCount: 0,
          totalAmount: 0
        };
      }
      userStats[user.id].transferCount++;
      userStats[user.id].totalAmount += Number(t.amount);
    });

    return Object.values(userStats)
      .sort((a: any, b: any) => b.totalAmount - a.totalAmount)
      .slice(0, limit);
  }

  private async getStatsForPeriod(startDate: Date, endDate: Date): Promise<any> {
    const transfers = await this.transfersRepository.find({
      where: {
        createdAt: Between(startDate, endDate),
        status: TransferStatus.COMPLETED
      }
    });

    return {
      totalTransfers: transfers.length,
      totalAmount: Number(transfers.reduce((sum, t) => sum + Number(t.amount), 0).toFixed(2)),
      totalCommission: Number(transfers.reduce((sum, t) => sum + Number(t.commission), 0).toFixed(2))
    };
  }

  private calculateChange(oldValue: number, newValue: number): any {
    if (oldValue === 0) return { value: 0, percentage: '+100%', direction: 'up' };
    const change = ((newValue - oldValue) / oldValue) * 100;
    return {
      value: Number((newValue - oldValue).toFixed(2)),
      percentage: (change >= 0 ? '+' : '') + change.toFixed(2) + '%',
      direction: change >= 0 ? 'up' : 'down'
    };
  }

  private getStartOfWeek(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private getDateRange(period: string, date?: string): { startDate: Date; endDate: Date } {
    const today = new Date();
    let startDate: Date;
    let endDate: Date = new Date(today);
    endDate.setHours(23, 59, 59, 999);

    switch (period) {
      case 'daily':
        startDate = new Date(date || today);
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'weekly':
        startDate = this.getStartOfWeek(date ? new Date(date) : today);
        endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 6);
        endDate.setHours(23, 59, 59, 999);
        break;
      case 'monthly':
        const d = date ? new Date(date) : today;
        startDate = new Date(d.getFullYear(), d.getMonth(), 1);
        endDate = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        endDate.setHours(23, 59, 59, 999);
        break;
      default:
        startDate = new Date(today);
        startDate.setHours(0, 0, 0, 0);
    }

    return { startDate, endDate };
  }

  private getPeriodName(period: string): string {
    const names: Record<string, string> = {
      'daily': 'يومي',
      'weekly': 'أسبوعي',
      'monthly': 'شهري',
      'semiAnnual': 'نصف سنوي',
      'annual': 'سنوي'
    };
    return names[period] || period;
  }
}