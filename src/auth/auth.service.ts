import { 
  Injectable, 
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger
} from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
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
    private mailerService: MailerService,
  ) {}

  async validateUser(username: string, password: string): Promise<any> {
    const user = await this.usersRepository.findOne({ 
      where: { username },
      select: ['id', 'username', 'email', 'password', 'points', 'role', 'status', 'kycLevel']
    });
    
    if (!user) throw new UnauthorizedException('اسم المستخدم أو كلمة المرور غير صحيحة');
    if (user.status === 'suspended') throw new UnauthorizedException('تم تعليق حسابك');
    if (user.status === 'frozen') throw new UnauthorizedException('تم تجميد حسابك');

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) throw new UnauthorizedException('اسم المستخدم أو كلمة المرور غير صحيحة');

    const { password: _, ...result } = user;
    return result;
  }

  async login(loginDto: LoginDto) {
    const user = await this.validateUser(loginDto.username, loginDto.password);
    const payload = { sub: user.id, username: user.username, role: user.role, kycLevel: user.kycLevel };
    const accessToken = this.jwtService.sign(payload);

    await this.usersRepository.update(user.id, { lastLoginAt: new Date() });
    await this.auditService.logAction(user.id, 'LOGIN', 'تسجيل دخول ناجح', { timestamp: new Date() });
    this.logger.log(`User ${user.username} logged in`);

    return { access_token: accessToken, user: { id: user.id, username: user.username, email: user.email, points: user.points, role: user.role, kycLevel: user.kycLevel } };
  }

  async register(registerDto: RegisterDto) {
    const existingUser = await this.usersRepository.findOne({ where: [{ username: registerDto.username }, { email: registerDto.email }] });
    if (existingUser) {
      if (existingUser.username === registerDto.username) throw new ConflictException('اسم المستخدم موجود بالفعل');
      throw new ConflictException('البريد الإلكتروني موجود بالفعل');
    }

    const hashedPassword = await bcrypt.hash(registerDto.password, 12);
    const user = this.usersRepository.create({ ...registerDto, password: hashedPassword, preferences: { language: 'ar', currency: 'USD', notifications: true, emailNotifications: true, smsNotifications: false } });
    await this.usersRepository.save(user);
    await this.auditService.logAction(user.id, 'REGISTER', 'تسجيل حساب جديد', { email: user.email });
    this.logger.log(`New user: ${user.username}`);

    return this.login({ username: registerDto.username, password: registerDto.password });
  }

  async refreshToken(userId: number) {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('المستخدم غير موجود');
    const payload = { sub: user.id, username: user.username, role: user.role, kycLevel: user.kycLevel };
    return { access_token: this.jwtService.sign(payload) };
  }

  async changePassword(userId: number, oldPassword: string, newPassword: string) {
    const user = await this.usersRepository.findOne({ where: { id: userId }, select: ['id', 'password'] });
    if (!await bcrypt.compare(oldPassword, user.password)) throw new BadRequestException('كلمة المرور الحالية غير صحيحة');
    await this.usersRepository.update(userId, { password: await bcrypt.hash(newPassword, 12) });
    await this.auditService.logAction(userId, 'CHANGE_PASSWORD', 'تغيير كلمة المرور');
    return { message: 'تم تغيير كلمة المرور بنجاح' };
  }

  // ========== نسيت كلمة المرور ==========
// ✅ طلب إعادة تعيين كلمة المرور
async forgotPassword(email: string): Promise<{ message: string }> {
  // ✅ سيظهر في سجلات Vercel فوراً
  this.logger.log(`🔵 forgotPassword called with email: ${email}`);
  
  const user = await this.usersRepository.findOne({ where: { email } });
  
  if (!user) {
    this.logger.warn(`🟡 User not found for email: ${email}`);
    return { message: 'إذا كان البريد مسجلاً، سيصلك رمز إعادة التعيين' };
  }

  this.logger.log(`🟢 User found: ${user.username}`);

  // منع الطلبات المتكررة
  if (user.lastResetRequest) {
    const diff = Date.now() - new Date(user.lastResetRequest).getTime();
    if (diff < 60000) {
      this.logger.warn(`🟠 Too many requests for ${email}`);
      return { message: 'يرجى الانتظار دقيقة قبل طلب رمز جديد' };
    }
  }

  // إنشاء رمز 6 أرقام
  const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
  
  user.resetCode = resetCode;
  user.resetCodeExpiry = new Date(Date.now() + 15 * 60 * 1000);
  user.lastResetRequest = new Date();
  await this.usersRepository.save(user);

  // ✅ طباعة الرمز في السجلات (يظهر دائماً)
  this.logger.log(`🔑 Reset code for ${email}: ${resetCode}`);

  // محاولة إرسال البريد
  try {
    await this.mailerService.sendMail({
      to: email,
      subject: '🔐 إعادة تعيين كلمة المرور - نظام التحويلات',
      html: `
        <div dir="rtl" style="font-family: Arial; padding: 20px;">
          <h2>إعادة تعيين كلمة المرور</h2>
          <p>مرحباً ${user.username}،</p>
          <p>رمز إعادة التعيين الخاص بك هو:</p>
          <h1 style="color: #6C63FF; letter-spacing: 5px; font-size: 36px;">${resetCode}</h1>
          <p>هذا الرمز صالح لمدة 15 دقيقة.</p>
        </div>
      `,
    });
    this.logger.log(`✅ Email sent successfully to ${email}`);
  } catch (error) {
    this.logger.error(`❌ Email failed: ${error.message}`);
  }

  return { message: 'إذا كان البريد مسجلاً، سيصلك رمز إعادة التعيين' };
}
  async resetPassword(email: string, code: string, newPassword: string): Promise<{ message: string }> {
    const user = await this.usersRepository.findOne({ where: { email } });
    if (!user || !user.resetCode) throw new BadRequestException('رمز إعادة التعيين غير صالح');
    if (user.resetCode !== code) throw new BadRequestException('الرمز غير صحيح');
    if (!user.resetCodeExpiry || new Date() > new Date(user.resetCodeExpiry)) throw new BadRequestException('انتهت صلاحية الرمز');
    if (newPassword.length < 6) throw new BadRequestException('كلمة المرور 6 أحرف على الأقل');

    user.password = await bcrypt.hash(newPassword, 12);
    user.resetCode = null;
    user.resetCodeExpiry = null;
    user.resetAttempts = 0;
    user.lastResetRequest = null;
    await this.usersRepository.save(user);

    await this.auditService.logAction(user.id, 'PASSWORD_RESET', 'إعادة تعيين كلمة المرور');
    return { message: 'تم تغيير كلمة المرور بنجاح' };
  }
}
