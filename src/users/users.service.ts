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
    const { 
      page = 1, 
      limit = 20, 
      search, 
      role, 
      status, 
      kycLevel,
      sortBy = 'createdAt',
      sortOrder = 'DESC'
    } = query;

    const queryBuilder = this.usersRepository.createQueryBuilder('user');

    // البحث
    if (search) {
      queryBuilder.where(
        '(user.username LIKE :search OR user.email LIKE :search)',
        { search: `%${search}%` }
      );
    }

    // الفلاتر
    if (role) {
      queryBuilder.andWhere('user.role = :role', { role });
    }

    if (status) {
      queryBuilder.andWhere('user.status = :status', { status });
    }

    if (kycLevel) {
      queryBuilder.andWhere('user.kycLevel = :kycLevel', { kycLevel });
    }

    // الترتيب والصفحات
    queryBuilder
      .select([
        'user.id',
        'user.username',
        'user.email',
        'user.points',
        'user.role',
        'user.status',
        'user.kycLevel',
        'user.dailyLimit',
        'user.monthlyLimit',
        'user.totalTransfers',
        'user.lastLoginAt',
        'user.createdAt'
      ])
      .orderBy(`user.${sortBy}`, sortOrder as 'ASC' | 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [users, total] = await queryBuilder.getManyAndCount();

    return { users, total };
  }

  async findById(id: number): Promise<User> {
    const user = await this.usersRepository.findOne({ 
      where: { id },
      select: [
        'id', 'username', 'email', 'points', 'frozenPoints',
        'role', 'status', 'kycLevel', 'dailyLimit', 'monthlyLimit',
        'dailyTransferred', 'monthlyTransferred', 'totalTransfers',
        'commissionRate', 'twoFactorEnabled', 'preferences',
        'lastLoginAt', 'lastTransferAt', 'createdAt', 'updatedAt'
      ]
    });
    
    if (!user) {
      throw new NotFoundException('المستخدم غير موجود');
    }
    
    return user;
  }

  async findByUsername(username: string): Promise<User> {
    return this.usersRepository.findOne({ where: { username } });
  }

  async findByEmail(email: string): Promise<User> {
    return this.usersRepository.findOne({ where: { email } });
  }

  async getProfile(userId: number): Promise<any> {
    const user = await this.findById(userId);
    
    return {
      ...user,
      availableBalance: user.availableBalance,
      totalBalance: user.totalBalance,
    };
  }

  async create(createUserDto: CreateUserDto): Promise<User> {
    // التحقق من وجود المستخدم
    const existingUser = await this.usersRepository.findOne({
      where: [
        { username: createUserDto.username },
        { email: createUserDto.email }
      ]
    });

    if (existingUser) {
      if (existingUser.username === createUserDto.username) {
        throw new ConflictException('اسم المستخدم موجود بالفعل');
      }
      throw new ConflictException('البريد الإلكتروني موجود بالفعل');
    }

    const hashedPassword = await bcrypt.hash(createUserDto.password, 12);
    
    const user = this.usersRepository.create({
      ...createUserDto,
      password: hashedPassword,
    });
    
    const savedUser = await this.usersRepository.save(user);

    await this.auditService.logAction(
      null,
      'USER_CREATED',
      `تم إنشاء مستخدم جديد: ${savedUser.username}`,
      { userId: savedUser.id }
    );

    delete savedUser.password;
    return savedUser;
  }

  async update(id: number, updateUserDto: UpdateUserDto, adminId?: number): Promise<User> {
    const user = await this.findById(id);

    // التحقق من عدم تكرار البيانات
    if (updateUserDto.username && updateUserDto.username !== user.username) {
      const existingUser = await this.findByUsername(updateUserDto.username);
      if (existingUser) {
        throw new ConflictException('اسم المستخدم موجود بالفعل');
      }
    }

    if (updateUserDto.email && updateUserDto.email !== user.email) {
      const existingUser = await this.findByEmail(updateUserDto.email);
      if (existingUser) {
        throw new ConflictException('البريد الإلكتروني موجود بالفعل');
      }
    }

    Object.assign(user, updateUserDto);
    const updatedUser = await this.usersRepository.save(user);

    await this.auditService.logAction(
      adminId || id,
      'USER_UPDATED',
      `تم تحديث المستخدم: ${updatedUser.username}`,
      { updates: updateUserDto }
    );

    delete updatedUser.password;
    return updatedUser;
  }

  async updateStatus(userId: number, status: UserStatus, adminId: number): Promise<User> {
    const user = await this.findById(userId);
    
    if (user.role === 'admin' && status !== UserStatus.ACTIVE) {
      throw new BadRequestException('لا يمكن تغيير حالة المسؤول');
    }

    user.status = status;
    const updatedUser = await this.usersRepository.save(user);

    await this.auditService.logAction(
      adminId,
      'USER_STATUS_CHANGED',
      `تم تغيير حالة المستخدم ${updatedUser.username} إلى ${status}`
    );

    return updatedUser;
  }

  async getStatistics(userId: number): Promise<any> {
    const user = await this.findById(userId);
    
    return {
      balance: {
        total: user.totalBalance,
        available: user.availableBalance,
        frozen: user.frozenPoints,
      },
      limits: {
        daily: {
          limit: user.dailyLimit,
          used: user.dailyTransferred,
          remaining: Number(user.dailyLimit) - Number(user.dailyTransferred),
          percentage: (Number(user.dailyTransferred) / Number(user.dailyLimit)) * 100
        },
        monthly: {
          limit: user.monthlyLimit,
          used: user.monthlyTransferred,
          remaining: Number(user.monthlyLimit) - Number(user.monthlyTransferred),
          percentage: (Number(user.monthlyTransferred) / Number(user.monthlyLimit)) * 100
        }
      },
      activity: {
        totalTransfers: user.totalTransfers,
        lastTransfer: user.lastTransferAt,
        lastLogin: user.lastLoginAt,
      }
    };
  }

  async getTransferHistory(userId: number): Promise<any> {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      relations: [
        'sentTransfers', 
        'sentTransfers.receiver',
        'receivedTransfers', 
        'receivedTransfers.sender'
      ]
    });

    if (!user) {
      throw new NotFoundException('المستخدم غير موجود');
    }

    const sent = user.sentTransfers.map(transfer => ({
      id: transfer.id,
      referenceNumber: transfer.referenceNumber,
      amount: transfer.amount,
      commission: transfer.commission,
      totalAmount: transfer.totalAmount,
      to: {
        id: transfer.receiver.id,
        username: transfer.receiver.username
      },
      note: transfer.note,
      status: transfer.status,
      type: transfer.type,
      createdAt: transfer.createdAt,
      completedAt: transfer.completedAt,
    }));

    const received = user.receivedTransfers.map(transfer => ({
      id: transfer.id,
      referenceNumber: transfer.referenceNumber,
      amount: transfer.amount,
      from: {
        id: transfer.sender.id,
        username: transfer.sender.username
      },
      note: transfer.note,
      status: transfer.status,
      type: transfer.type,
      createdAt: transfer.createdAt,
    }));

    return {
      sent,
      received,
      summary: {
        totalSent: sent.reduce((sum, t) => sum + Number(t.amount), 0),
        totalReceived: received.reduce((sum, t) => sum + Number(t.amount), 0),
        totalCommission: sent.reduce((sum, t) => sum + Number(t.commission), 0),
      }
    };
  }
}