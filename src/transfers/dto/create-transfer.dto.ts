import { 
  IsNumber, 
  IsNotEmpty, 
  IsOptional, 
  IsString,
  Min,
  Max,
  IsIn
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTransferDto {
  @ApiProperty({ 
    description: 'رقم المستلم',
    example: 2
  })
  @IsNumber()
  @IsNotEmpty()
  receiverId: number;

  @ApiProperty({ 
    description: 'المبلغ المراد تحويله',
    example: 500.00,
    minimum: 0.01
  })
  @IsNumber()
  @IsNotEmpty()
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional({ 
    description: 'ملاحظة للتحويل',
    example: 'تحويل نقاط'
  })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ 
    description: 'رمز التحقق للمصادقة الثنائية',
    example: '123456'
  })
  @IsOptional()
  @IsString()
  otpCode?: string;

  @ApiPropertyOptional({ 
    description: 'نوع التحويل',
    example: 'internal'
  })
  @IsOptional()
  @IsIn(['internal', 'scheduled'])
  type?: string;
}