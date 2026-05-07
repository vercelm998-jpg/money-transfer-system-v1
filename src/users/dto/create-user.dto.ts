import { 
  IsString, 
  IsEmail, 
  IsNotEmpty, 
  MinLength, 
  IsOptional, 
  IsEnum,
  IsNumber,
  Min,
  Max
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole, KYCLevel } from '../user.entity';

export class CreateUserDto {
  @ApiProperty({ 
    description: 'اسم المستخدم',
    example: 'john_doe',
    minLength: 3
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  username: string;

  @ApiProperty({ 
    description: 'البريد الإلكتروني',
    example: 'john@example.com'
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ 
    description: 'كلمة المرور',
    example: 'password123',
    minLength: 6
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;

  @ApiPropertyOptional({ 
    description: 'دور المستخدم',
    enum: UserRole,
    default: UserRole.USER
  })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ 
    description: 'مستوى KYC',
    enum: KYCLevel,
    default: KYCLevel.NONE
  })
  @IsOptional()
  @IsEnum(KYCLevel)
  kycLevel?: KYCLevel;

  @ApiPropertyOptional({ 
    description: 'الحد اليومي للتحويل',
    example: 10000
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  dailyLimit?: number;

  @ApiPropertyOptional({ 
    description: 'الحد الشهري للتحويل',
    example: 50000
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyLimit?: number;
}