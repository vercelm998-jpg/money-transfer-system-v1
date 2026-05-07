import { 
  IsString, 
  IsNotEmpty, 
  IsOptional, 
  IsEnum,
  IsNumber,
  IsBoolean,
  IsObject,
  IsDateString,
  MaxLength,
  MinLength
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationType, NotificationPriority } from '../notification.entity';

export class CreateNotificationDto {
  @ApiProperty({ description: 'معرف المستخدم' })
  @IsNumber()
  @IsNotEmpty()
  userId: number;

  @ApiProperty({ description: 'عنوان الإشعار' })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  @ApiProperty({ description: 'نص الإشعار' })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiProperty({ 
    description: 'نوع الإشعار',
    enum: NotificationType 
  })
  @IsEnum(NotificationType)
  @IsNotEmpty()
  type: NotificationType;

  @ApiPropertyOptional({ 
    description: 'أولوية الإشعار',
    enum: NotificationPriority 
  })
  @IsOptional()
  @IsEnum(NotificationPriority)
  priority?: NotificationPriority;

  @ApiPropertyOptional({ description: 'معرف التحويل المرتبط' })
  @IsOptional()
  @IsNumber()
  transferId?: number;

  @ApiPropertyOptional({ description: 'رابط الإجراء' })
  @IsOptional()
  @IsString()
  actionUrl?: string;

  @ApiPropertyOptional({ description: 'بيانات إضافية' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @ApiPropertyOptional({ description: 'تاريخ انتهاء الصلاحية' })
  @IsOptional()
  @IsDateString()
  expiresAt?: Date;
}

export class NotificationQueryDto {
  @ApiPropertyOptional({ description: 'رقم الصفحة' })
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ description: 'عدد العناصر في الصفحة' })
  @IsOptional()
  limit?: number;

  @ApiPropertyOptional({ description: 'نوع الإشعار' })
  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;

  @ApiPropertyOptional({ description: 'حالة القراءة' })
  @IsOptional()
  @IsBoolean()
  read?: boolean;

  @ApiPropertyOptional({ description: 'الأولوية' })
  @IsOptional()
  @IsEnum(NotificationPriority)
  priority?: NotificationPriority;
}