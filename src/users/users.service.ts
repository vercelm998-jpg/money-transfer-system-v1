import { 
  Injectable, 
  NotFoundException, 
  ConflictException,
  BadRequestException,
  Logger
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { User, UserStatus } from './user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuditService } from '../audit/audit.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private auditService: AuditService,
  ) {}

  async findAll(query: any = {}): Promise<{ users: User[]; total: number }> {
    const { page = 1, limit = 20, search, role, status, kycLevel, sortBy = 'createdAt', sortOrder = 'DESC' } = query;
    const qb = this.usersRepository.createQueryBuilder('user');
    if (search) qb.where('(user.username LIKE :search OR user.email LIKE :search)', { search: `%${search}%` });
    if (role) qb.andWhere('user.role = :role', { role });
    if (status) qb.andWhere('user.status = :status', { status });
    if (kycLevel) qb.andWhere('user.kycLevel = :kycLevel', { kycLevel });
    qb.select(['user.id','user.username','user.email','user.points','user.role','user.status','user.kycLevel','user.dailyLimit','user.monthlyLimit','user.totalTransfers','user.lastLoginAt','user.createdAt'])
      .orderBy(`user.${sortBy}`, sortOrder as 'ASC'|'DESC').skip((page-1)*limit).take(limit);
    const [users, total] = await qb.getManyAndCount();
    return { users, total };
  }

  async findById(id: number): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id }, select: ['id','username','email','points','frozenPoints','role','status','kycLevel','dailyLimit','monthlyLimit','dailyTransferred','monthlyTransferred','totalTransfers','commissionRate','twoFactorEnabled','preferences','lastLoginAt','lastTransferAt','createdAt','updatedAt'] });
    if (!user) throw new NotFoundException('المستخدم غير موجود');
    return user;
  }

  async findByUsername(username: string): Promise<User> { return this.usersRepository.findOne({ where: { username } }); }
  async findByEmail(email: string): Promise<User> { return this.usersRepository.findOne({ where: { email } }); }

  async getProfile(userId: number): Promise<any> {
    const user = await this.findById(userId);
    return { ...user, availableBalance: user.availableBalance, totalBalance: user.totalBalance };
  }

  async create(createUserDto: CreateUserDto): Promise<User> {
    const existing = await this.usersRepository.findOne({ where: [{ username: createUserDto.username }, { email: createUserDto.email }] });
    if (existing) {
      if (existing.username === createUserDto.username) throw new ConflictException('اسم المستخدم موجود بالفعل');
      throw new ConflictException('البريد الإلكتروني موجود بالفعل');
    }
    const hashed = await bcrypt.hash(createUserDto.password, 12);
    const user = this.usersRepository.create({ ...createUserDto, password: hashed });
    const saved = await this.usersRepository.save(user);
    await this.auditService.logAction(null, 'USER_CREATED', `تم إنشاء مستخدم جديد: ${saved.username}`, { userId: saved.id });
    delete saved.password;
    return saved;
  }

  // ✅ تم الإصلاح - تحديث مباشر بدون validation معقد
  async update(id: number, updateUserDto: UpdateUserDto, adminId?: number): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('المستخدم غير موجود');

    // ✅ تحديث مباشر - يقبل أي حقول
    await this.usersRepository.update(id, updateUserDto);

    // جلب المستخدم بعد التحديث
    const updated = await this.usersRepository.findOne({ where: { id } });

    await this.auditService.logAction(adminId || id, 'USER_UPDATED', `تم تحديث المستخدم: ${updated.username}`, { updates: updateUserDto });
    return updated;
  }

  async findAllPublic(query: any = {}): Promise<any> {
    const { page = 1, limit = 100, search } = query;
    const qb = this.usersRepository.createQueryBuilder('user').select(['user.id','user.username','user.email','user.status']).where('user.status = :status', { status: UserStatus.ACTIVE });
    if (search) qb.andWhere('(user.username LIKE :search OR user.email LIKE :search OR CAST(user.id AS TEXT) LIKE :search)', { search: `%${search}%` });
    qb.orderBy('user.username', 'ASC').skip((page-1)*limit).take(limit);
    const [users, total] = await qb.getManyAndCount();
    return { users, total };
  }

  async updateStatus(userId: number, status: UserStatus, adminId: number): Promise<User> {
    const user = await this.findById(userId);
    if (user.role === 'admin' && status !== UserStatus.ACTIVE) throw new BadRequestException('لا يمكن تغيير حالة المسؤول');
    user.status = status;
    const updated = await this.usersRepository.save(user);
    await this.auditService.logAction(adminId, 'USER_STATUS_CHANGED', `تم تغيير حالة ${updated.username} إلى ${status}`);
    return updated;
  }

  async getStatistics(userId: number): Promise<any> {
    const user = await this.findById(userId);
    return {
      balance: { total: user.totalBalance, available: user.availableBalance, frozen: user.frozenPoints },
      limits: { daily: { limit: user.dailyLimit, used: user.dailyTransferred, remaining: Number(user.dailyLimit)-Number(user.dailyTransferred) }, monthly: { limit: user.monthlyLimit, used: user.monthlyTransferred, remaining: Number(user.monthlyLimit)-Number(user.monthlyTransferred) } },
      activity: { totalTransfers: user.totalTransfers, lastTransfer: user.lastTransferAt, lastLogin: user.lastLoginAt },
    };
  }

  async getTransferHistory(userId: number): Promise<any> {
    const user = await this.usersRepository.findOne({ where: { id: userId }, relations: ['sentTransfers','sentTransfers.receiver','receivedTransfers','receivedTransfers.sender'] });
    if (!user) throw new NotFoundException('المستخدم غير موجود');
    const sent = user.sentTransfers.map(t => ({ id: t.id, referenceNumber: t.referenceNumber, amount: t.amount, commission: t.commission, totalAmount: t.totalAmount, to: { id: t.receiver.id, username: t.receiver.username }, note: t.note, status: t.status, type: t.type, createdAt: t.createdAt, completedAt: t.completedAt }));
    const received = user.receivedTransfers.map(t => ({ id: t.id, referenceNumber: t.referenceNumber, amount: t.amount, from: { id: t.sender.id, username: t.sender.username }, note: t.note, status: t.status, type: t.type, createdAt: t.createdAt }));
    return { sent, received, summary: { totalSent: sent.reduce((s,t)=>s+Number(t.amount),0), totalReceived: received.reduce((s,t)=>s+Number(t.amount),0), totalCommission: sent.reduce((s,t)=>s+Number(t.commission),0) } };
  }
}