import { 
  IsNumber, 
  IsNotEmpty, 
  IsOptional, 
  IsString,
  Min,
  IsIn
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum Currency {
  USD = 'USD',
  EUR = 'EUR',
  SYP = 'SYP',
  TRY = 'TRY',
  SAR = 'SAR'
}

export class CreateTransferDto {
  @ApiProperty({ description: 'رقم المستلم', example: 2 })
  @IsNumber()
  @IsNotEmpty()
  receiverId: number;

  @ApiProperty({ description: 'المبلغ المراد تحويله', example: 500.00, minimum: 0.01 })
  @IsNumber()
  @IsNotEmpty()
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional({ description: 'مبلغ العمولة (يدوياً)', example: 10 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  commissionAmount?: number;  // ← تغير من commissionRate إلى commissionAmount

  @ApiPropertyOptional({ 
    description: 'العملة',
    enum: Currency,
    example: Currency.USD 
  })
  @IsOptional()
  @IsIn(Object.values(Currency))
  currency?: Currency;

  @ApiPropertyOptional({ description: 'ملاحظة للتحويل', example: 'تحويل نقاط' })
  @IsOptional()
  @IsString()
  note?: string;
}
