import { 
  Injectable, 
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger
} from '@nestjs/common';
  // استيراد إضافي في الأعلى
import { MailerService } from '@nestjs-modules/mailer'; // أو خدمة بريد أخرى
import { randomInt } from 'crypto';
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



// ✅ إنشاء وإرسال رمز إعادة التعيين
async forgotPassword(email: string): Promise<{ message: string }> {
  const user = await this.usersRepository.findOne({ where: { email } });
  
  if (!user) {
    // لا تخبر المستخدم أن البريد غير موجود (أمان)
    return { message: 'إذا كان البريد مسجلاً، سيصلك رمز إعادة التعيين' };
  }

  // إنشاء رمز 6 أرقام
  const resetCode = randomInt(100000, 999999).toString();
  
  // حفظ الرمز في user (تحتاج إضافة حقل resetCode و resetCodeExpiry في user.entity)
  user.resetCode = resetCode;
  user.resetCodeExpiry = new Date(Date.now() + 15 * 60 * 1000); // صالح 15 دقيقة
  await this.usersRepository.save(user);

  // إرسال الرمز عبر البريد الإلكتروني
  // await this.mailerService.sendMail({ ... });
  
  // للتجربة - اطبع الرمز في الكونسول
  this.logger.log(`🔑 Reset code for ${email}: ${resetCode}`);

  return { message: 'تم إرسال رمز إعادة التعيين إلى بريدك الإلكتروني' };
}

// ✅ التحقق من الرمز وتغيير كلمة المرور
async resetPassword(email: string, code: string, newPassword: string): Promise<{ message: string }> {
  const user = await this.usersRepository.findOne({ where: { email } });
  
  if (!user || !user.resetCode || !user.resetCodeExpiry) {
    throw new BadRequestException('رمز إعادة التعيين غير صالح');
  }

  if (user.resetCode !== code) {
    throw new BadRequestException('الرمز غير صحيح');
  }

  if (new Date() > user.resetCodeExpiry) {
    throw new BadRequestException('انتهت صلاحية الرمز');
  }

  // تغيير كلمة المرور
  user.password = await bcrypt.hash(newPassword, 12);
  user.resetCode = null;
  user.resetCodeExpiry = null;
  await this.usersRepository.save(user);

  return { message: 'تم تغيير كلمة المرور بنجاح' };
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
