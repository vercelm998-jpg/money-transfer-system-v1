import { 
  Injectable, 
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { LoginDto, RegisterDto } from './dto/login.dto';
import { AuditService } from '../audit/audit.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private jwtService: JwtService,
    private auditService: AuditService,
  ) {}

  async validateUser(username: string, password: string): Promise<any> {
    const user = await this.usersRepository.findOne({ 
      where: { username },
      select: ['id', 'username', 'email', 'password', 'points', 'role', 'status', 'kycLevel']
    });
    
    if (!user) {
      throw new UnauthorizedException('اسم المستخدم أو كلمة المرور غير صحيحة');
    }

    if (user.status === 'suspended') {
      throw new UnauthorizedException('تم تعليق حسابك. يرجى التواصل مع الدعم الفني');
    }

    if (user.status === 'frozen') {
      throw new UnauthorizedException('تم تجميد حسابك. يرجى التواصل مع الدعم الفني');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
      throw new UnauthorizedException('اسم المستخدم أو كلمة المرور غير صحيحة');
    }

    const { password: _, ...result } = user;
    return result;
  }

  async login(loginDto: LoginDto) {
    const user = await this.validateUser(loginDto.username, loginDto.password);
    
    const payload = { 
      sub: user.id,
      username: user.username, 
      role: user.role,
      kycLevel: user.kycLevel
    };
    
    const accessToken = this.jwtService.sign(payload);

    // تحديث آخر تسجيل دخول
    await this.usersRepository.update(user.id, {
      lastLoginAt: new Date()
    });

    // تسجيل التدقيق
    await this.auditService.logAction(
      user.id,
      'LOGIN',
      'تسجيل دخول ناجح',
      { timestamp: new Date() }
    );

    this.logger.log(`User ${user.username} logged in successfully`);

    return {
      access_token: accessToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        points: user.points,
        role: user.role,
        kycLevel: user.kycLevel
      }
    };
  }

  async register(registerDto: RegisterDto) {
    // التحقق من وجود المستخدم
    const existingUser = await this.usersRepository.findOne({
      where: [
        { username: registerDto.username },
        { email: registerDto.email }
      ]
    });

    if (existingUser) {
      if (existingUser.username === registerDto.username) {
        throw new ConflictException('اسم المستخدم موجود بالفعل');
      }
      if (existingUser.email === registerDto.email) {
        throw new ConflictException('البريد الإلكتروني موجود بالفعل');
      }
    }

    // تشفير كلمة المرور
    const hashedPassword = await bcrypt.hash(registerDto.password, 12);
    
    // إنشاء المستخدم
    const user = this.usersRepository.create({
      ...registerDto,
      password: hashedPassword,
      preferences: {
        language: 'ar',
        currency: 'USD',
        notifications: true,
        emailNotifications: true,
        smsNotifications: false,
      }
    });
    
    await this.usersRepository.save(user);

    // تسجيل التدقيق
    await this.auditService.logAction(
      user.id,
      'REGISTER',
      'تسجيل حساب جديد',
      { email: user.email }
    );

    this.logger.log(`New user registered: ${user.username}`);

    // تسجيل الدخول مباشرة بعد التسجيل
    const loginDto: LoginDto = {
      username: registerDto.username,
      password: registerDto.password
    };

    return this.login(loginDto);
  }

  async refreshToken(userId: number) {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    
    if (!user) {
      throw new UnauthorizedException('المستخدم غير موجود');
    }

    const payload = { 
      sub: user.id,
      username: user.username, 
      role: user.role,
      kycLevel: user.kycLevel
    };

    return {
      access_token: this.jwtService.sign(payload),
    };
  }

  async changePassword(userId: number, oldPassword: string, newPassword: string) {
    const user = await this.usersRepository.findOne({ 
      where: { id: userId },
      select: ['id', 'password']
    });

    const isPasswordValid = await bcrypt.compare(oldPassword, user.password);
    
    if (!isPasswordValid) {
      throw new BadRequestException('كلمة المرور الحالية غير صحيحة');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await this.usersRepository.update(userId, { password: hashedPassword });

    await this.auditService.logAction(
      userId,
      'CHANGE_PASSWORD',
      'تغيير كلمة المرور'
    );

    return { message: 'تم تغيير كلمة المرور بنجاح' };
  }
}