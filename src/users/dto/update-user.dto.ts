import { 
  IsString, 
  IsEmail, 
  IsOptional, 
  IsEnum,
  IsNumber,
  IsBoolean,
  Min,
  IsObject
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole, UserStatus, KYCLevel } from '../user.entity';

export class UpdateUserDto {
  @ApiPropertyOptional({ description: 'اسم المستخدم' })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiPropertyOptional({ description: 'البريد الإلكتروني' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ description: 'دور المستخدم', enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ description: 'حالة المستخدم', enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({ description: 'مستوى KYC', enum: KYCLevel })
  @IsOptional()
  @IsEnum(KYCLevel)
  kycLevel?: KYCLevel;

  @ApiPropertyOptional({ description: 'الحد اليومي للتحويل' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  dailyLimit?: number;

  @ApiPropertyOptional({ description: 'الحد الشهري للتحويل' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyLimit?: number;

  @ApiPropertyOptional({ description: 'نسبة العمولة' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  commissionRate?: number;

  @ApiPropertyOptional({ description: 'تفعيل المصادقة الثنائية' })
  @IsOptional()
  @IsBoolean()
  twoFactorEnabled?: boolean;

  @ApiPropertyOptional({ description: 'تفضيلات المستخدم' })
  @IsOptional()
  @IsObject()
  preferences?: Record<string, any>;
}