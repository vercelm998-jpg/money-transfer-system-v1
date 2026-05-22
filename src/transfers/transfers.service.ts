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
import * as PDFDocument from 'pdfkit';
import { Response } from 'express';  // ✅ أضف هذا في الأعلى

@Injectable()
export class TransfersService {
  private readonly logger = new Logger(TransfersService.name);

  constructor(
    @InjectRepository(Transfer) private transfersRepository: Repository<Transfer>,
    @InjectRepository(User) private usersRepository: Repository<User>,
    private dataSource: DataSource,
    private notificationsService: NotificationsService,
    private auditService: AuditService,
    private walletService: WalletService,
  ) {}

  async createTransfer(senderId: number, dto: CreateTransferDto, metadata?: any): Promise<any> {
    const { receiverId, amount, note, commissionAmount, currency, beneficiaryName } = dto;

    if (senderId === receiverId) throw new BadRequestException('لا يمكنك التحويل إلى نفسك');
    if (!amount || amount <= 0) throw new BadRequestException('المبلغ يجب أن يكون أكبر من صفر');

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    try {
      await qr.startTransaction();

      const sender = await qr.manager.findOne(User, { where: { id: senderId } });
      const receiver = await qr.manager.findOne(User, { where: { id: receiverId } });
      if (!sender) throw new NotFoundException('حسابك غير موجود');
      if (!receiver) throw new NotFoundException('المستلم غير موجود');
      if (sender.status !== UserStatus.ACTIVE) throw new ForbiddenException('حسابك غير نشط');
      if (receiver.status !== UserStatus.ACTIVE) throw new BadRequestException('حساب المستلم غير نشط');

      const commission = commissionAmount != null ? Number(commissionAmount) : 0;
      const totalAmount = Number((amount + commission).toFixed(2));
      const senderBalance = Number(sender.points);
      if (senderBalance < totalAmount) throw new BadRequestException(`رصيد غير كافي: ${senderBalance}`);

      await qr.manager.update(User, senderId, {
        points: Number((senderBalance - totalAmount).toFixed(2)),
        dailyTransferred: Number((Number(sender.dailyTransferred || 0) + amount).toFixed(2)),
        monthlyTransferred: Number((Number(sender.monthlyTransferred || 0) + amount).toFixed(2)),
        totalTransfers: (sender.totalTransfers || 0) + 1,
        lastTransferAt: new Date(),
      });

      await qr.manager.update(User, receiverId, {
        points: Number((Number(receiver.points) + amount).toFixed(2)),
      });

      const transfer = new Transfer();
      transfer.senderId = senderId;
      transfer.receiverId = receiverId;
      transfer.amount = amount;
      transfer.commission = commission;
      transfer.totalAmount = totalAmount;
      transfer.note = note || null;
      transfer.beneficiaryName = beneficiaryName || receiver.username;
      transfer.description = `تحويل من ${sender.username} إلى ${receiver.username}`;
      transfer.type = TransferType.INTERNAL;
      transfer.status = TransferStatus.COMPLETED;
      transfer.completedAt = new Date();
      transfer.metadata = { ...metadata, currency: currency || 'USD' };
      transfer.referenceNumber = `TRF-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

      const saved = await qr.manager.save(transfer);

      try { await this.walletService.recordTransaction(senderId, -totalAmount, 'transfer_out', `تحويل ${amount} إلى ${receiver.username}`, saved.id, qr); } catch (e) {}
      try {
        await this.notificationsService.createNotification({ userId: receiverId, title: '💰 تحويل', message: `استلام ${amount} من ${sender.username}`, type: 'transfer_received', transferId: saved.id });
        await this.notificationsService.createNotification({ userId: senderId, title: '✅ تحويل', message: `تحويل ${amount} إلى ${receiver.username}`, type: 'transfer_sent', transferId: saved.id });
      } catch (e) {}

      await qr.commitTransaction();

      return {
        success: true, message: 'تم التحويل بنجاح',
        transfer: {
          id: saved.id, referenceNumber: saved.referenceNumber,
          amount: saved.amount, commission: saved.commission, totalAmount: saved.totalAmount,
          beneficiaryName: saved.beneficiaryName,
          sender: { id: sender.id, username: sender.username },
          receiver: { id: receiver.id, username: receiver.username },
          note: saved.note, status: saved.status, createdAt: saved.createdAt,
        },
      };
    } catch (e) {
      await qr.rollbackTransaction();
      throw e;
    } finally {
      await qr.release();
    }
  }

  async findById(id: number) { return this.transfersRepository.findOne({ where: { id }, relations: ['sender', 'receiver'] }) || (() => { throw new NotFoundException(); })(); }
  async findByReference(ref: string) { return this.transfersRepository.findOne({ where: { referenceNumber: ref }, relations: ['sender', 'receiver'] }) || (() => { throw new NotFoundException(); })(); }

  async getTransferHistory(userId: number, role: string, filters?: any) {
    const qb = this.transfersRepository.createQueryBuilder('t').leftJoinAndSelect('t.sender', 's').leftJoinAndSelect('t.receiver', 'r');
    if (role !== 'admin' && role !== 'moderator') qb.where('(t.senderId = :uid OR t.receiverId = :uid)', { uid: userId });
    if (filters?.search) qb.andWhere('(t.referenceNumber LIKE :s OR t.note LIKE :s OR s.username LIKE :s OR r.username LIKE :s OR CAST(t.createdAt AS TEXT) LIKE :s)', { s: `%${filters.search}%` });
    if (filters?.status) qb.andWhere('t.status = :st', { st: filters.status });
    const [transfers, total] = await qb.orderBy(`t.${filters?.sortBy || 'createdAt'}`, filters?.sortOrder || 'DESC').skip(((filters?.page || 1) - 1) * (filters?.limit || 20)).take(filters?.limit || 20).getManyAndCount();
    return { transfers, total, page: filters?.page || 1, limit: filters?.limit || 20, totalPages: Math.ceil(total / (filters?.limit || 20)), summary: { totalAmount: transfers.reduce((s, t) => s + Number(t.amount), 0), totalCommission: transfers.reduce((s, t) => s + Number(t.commission), 0), totalCount: transfers.length } };
  }

  async confirmDelivery(tid: number, uid: number, note?: string) {
    const t = await this.transfersRepository.findOne({ where: { id: tid }, relations: ['sender', 'receiver'] });
    if (!t) throw new NotFoundException();
    if (t.receiverId !== uid) throw new ForbiddenException();
    if (t.isDelivered) throw new BadRequestException('تم التأكيد مسبقاً');
    t.isDelivered = true; t.deliveredAt = new Date(); t.deliveryNote = note || null; t.status = TransferStatus.DELIVERED;
    await this.transfersRepository.save(t);
    return { success: true, message: 'تم تأكيد الاستلام' };
  }


  

async generateReceipt(transferId: number, userId: number, role: string, res: any): Promise<void> {
  const transfer = await this.transfersRepository.findOne({
    where: { id: transferId },
    relations: ['sender', 'receiver'],
  });

  if (!transfer) throw new NotFoundException('التحويل غير موجود');
  if (transfer.sender.id !== userId && transfer.receiver.id !== userId && role !== 'admin') {
    throw new ForbiddenException('غير مصرح لك');
  }

  const currency = transfer.metadata?.currency || 'USD';
  const currencySymbols = { USD: '$', EUR: '€', SYP: 'ل.س', TRY: '₺', SAR: 'ر.س' };
  const currencySymbol = currencySymbols[currency] || currency;

  // إنشاء PDF
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=receipt-${transfer.referenceNumber}.pdf`);
  doc.pipe(res);

  // ✅ رأسية الإيصال
  doc.fontSize(22).font('Helvetica-Bold').text('إيصال تحويل', { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(12).font('Helvetica').text('نظام التحويلات المالية', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(8).fillColor('#999').text(`تاريخ الإصدار: ${new Date().toLocaleDateString('ar-SA')}`, { align: 'center' });
  doc.fillColor('#000');

  // خط فاصل
  doc.moveDown(0.5);
  doc.strokeColor('#6C63FF').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(0.5);

  // ✅ رقم المرجع والتاريخ
  doc.fontSize(14).font('Helvetica-Bold').text(`رقم المرجع: ${transfer.referenceNumber}`, { align: 'center' });
  doc.moveDown(0.2);
  doc.fontSize(10).font('Helvetica').fillColor('#666').text(
    `تاريخ التحويل: ${new Date(transfer.createdAt).toLocaleDateString('ar-SA')} - ${new Date(transfer.createdAt).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}`,
    { align: 'center' }
  );
  doc.fillColor('#000');
  doc.moveDown(1);

  // ✅ حالة التحويل
  const statusColor = transfer.status === 'completed' ? '#4CAF50' : transfer.isDelivered ? '#2196F3' : '#FF9800';
  const statusText = transfer.isDelivered ? '✅ تم التسليم' : transfer.status === 'completed' ? '✅ مكتمل' : '⏳ قيد الانتظار';
  doc.fontSize(12).font('Helvetica-Bold').fillColor(statusColor).text(statusText, { align: 'center' });
  doc.fillColor('#000');
  doc.moveDown(0.8);

  // ✅ المبلغ
  doc.strokeColor('#E0E0E0').lineWidth(0.5).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(0.5);
  doc.fontSize(16).font('Helvetica-Bold').text('المبلغ', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(32).font('Helvetica-Bold').fillColor('#6C63FF').text(
    `${Number(transfer.amount).toLocaleString('ar-SA')} ${currencySymbol}`,
    { align: 'center' }
  );
  doc.fillColor('#000');
  
  if (transfer.commission > 0) {
    doc.moveDown(0.2);
    doc.fontSize(11).font('Helvetica').fillColor('#FF9800').text(
      `العمولة: ${Number(transfer.commission).toLocaleString('ar-SA')} ${currencySymbol}`,
      { align: 'center' }
    );
    doc.fillColor('#000');
  }
  
  doc.moveDown(0.3);
  doc.strokeColor('#E0E0E0').lineWidth(0.5).moveTo(200, doc.y).lineTo(395, doc.y).stroke();
  doc.moveDown(0.3);
  doc.fontSize(10).font('Helvetica').fillColor('#666').text(
    `الإجمالي: ${Number(transfer.totalAmount).toLocaleString('ar-SA')} ${currencySymbol}`,
    { align: 'center' }
  );
  doc.fillColor('#000');
  doc.moveDown(1);

  // ✅ المرسل والمستلم
  doc.strokeColor('#E0E0E0').lineWidth(0.5).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(0.8);
  
  // المرسل (يسار) والمستلم (يمين)
  const startY = doc.y;
  
  // المرسل
  doc.fontSize(11).font('Helvetica-Bold').text('المرسل', 50, startY);
  doc.fontSize(10).font('Helvetica').text(transfer.sender?.username || 'غير معروف', 50, startY + 20);
  doc.fontSize(8).fillColor('#999').text(transfer.sender?.email || '', 50, startY + 36);
  doc.fillColor('#000');
  
  // المستلم
  doc.fontSize(11).font('Helvetica-Bold').text('المستلم', 320, startY);
  doc.fontSize(10).font('Helvetica').text(transfer.receiver?.username || 'غير معروف', 320, startY + 20);
  doc.fontSize(8).fillColor('#999').text(transfer.receiver?.email || '', 320, startY + 36);
  doc.fillColor('#000');
  
  // اسم المستفيد
  if (transfer.beneficiaryName && transfer.beneficiaryName !== transfer.receiver?.username) {
    doc.fontSize(9).font('Helvetica').fillColor('#1565C0').text(`المستفيد: ${transfer.beneficiaryName}`, 320, startY + 50);
    doc.fillColor('#000');
  }
  
  doc.moveDown(4);

  // ✅ ملاحظات
  if (transfer.note) {
    doc.strokeColor('#E0E0E0').lineWidth(0.5).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica-Bold').text('ملاحظات:');
    doc.moveDown(0.2);
    doc.fontSize(9).font('Helvetica').fillColor('#666').text(transfer.note);
    doc.fillColor('#000');
    doc.moveDown(0.5);
  }

  // ✅ تذييل
  doc.moveDown(1);
  doc.strokeColor('#6C63FF').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(0.5);
  doc.fontSize(7).font('Helvetica').fillColor('#999').text(
    'هذا الإيصال صادر من نظام التحويلات المالية - للتحقق من صحة الإيصال، امسح QR Code أو استخدم رقم المرجع',
    { align: 'center' }
  );
  doc.fillColor('#000');

  doc.end();
}
  async getPendingDeliveryTransfers(uid: number) {
    const t = await this.transfersRepository.find({ where: [{ receiverId: uid, isDelivered: false, status: TransferStatus.COMPLETED }, { senderId: uid, isDelivered: false, status: TransferStatus.COMPLETED }], relations: ['sender', 'receiver'], order: { createdAt: 'DESC' } });
    return { receivedPending: t.filter(x => x.receiverId === uid), sentPending: t.filter(x => x.senderId === uid) };
  }

  async getDeliveryStats(uid: number) {
    const t = await this.transfersRepository.find({ where: [{ receiverId: uid, status: In([TransferStatus.COMPLETED, TransferStatus.DELIVERED]) }, { senderId: uid, status: In([TransferStatus.COMPLETED, TransferStatus.DELIVERED]) }] });
    return { received: { total: t.filter(x => x.receiverId === uid).length, delivered: t.filter(x => x.receiverId === uid && x.isDelivered).length }, sent: { total: t.filter(x => x.senderId === uid).length, delivered: t.filter(x => x.senderId === uid && x.isDelivered).length } };
  }

  async cancelTransfer(tid: number, uid: number, role: string) {
    const t = await this.transfersRepository.findOne({ where: { id: tid }, relations: ['sender', 'receiver'] });
    if (!t) throw new NotFoundException();
    if (t.sender.id !== uid && role !== 'admin') throw new ForbiddenException();
    const qr = this.dataSource.createQueryRunner(); await qr.connect();
    try {
      await qr.startTransaction();
      await qr.manager.update(User, t.sender.id, { points: Number(t.sender.points) + Number(t.totalAmount) });
      await qr.manager.update(User, t.receiver.id, { points: Number(t.receiver.points) - Number(t.amount) });
      await qr.manager.update(Transfer, tid, { status: TransferStatus.CANCELLED, cancelledAt: new Date() });
      await qr.commitTransaction();
      return { success: true, message: 'تم الإلغاء' };
    } catch (e) { await qr.rollbackTransaction(); throw e; } finally { await qr.release(); }
  }
}
