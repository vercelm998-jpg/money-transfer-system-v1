import { 
  IsNumber, 
  IsNotEmpty, 
  IsOptional, 
  IsString,
  IsEnum,
  IsDateString,
  Min,
  MaxLength
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ScheduleFrequency } from '../scheduled-transfer.entity';

export class CreateScheduledTransferDto {
  @ApiProperty({ description: 'معرف المستلم' })
  @IsNumber()
  @IsNotEmpty()
  receiverId: number;

  @ApiProperty({ description: 'المبلغ' })
  @IsNumber()
  @IsNotEmpty()
  @Min(0.01)
  amount: number;

  @ApiProperty({ 
    description: 'نوع التكرار',
    enum: ScheduleFrequency 
  })
  @IsEnum(ScheduleFrequency)
  @IsNotEmpty()
  frequency: ScheduleFrequency;

  @ApiProperty({ description: 'تاريخ أول تنفيذ' })
  @IsDateString()
  @IsNotEmpty()
  nextExecution: Date;

  @ApiPropertyOptional({ description: 'ملاحظة' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ description: 'الحد الأقصى للتنفيذ' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxExecutions?: number;

  @ApiPropertyOptional({ description: 'تاريخ نهاية الجدولة' })
  @IsOptional()
  @IsDateString()
  endDate?: Date;
}

export class UpdateScheduledTransferDto {
  @ApiPropertyOptional({ description: 'المبلغ' })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amount?: number;

  @ApiPropertyOptional({ description: 'نوع التكرار' })
  @IsOptional()
  @IsEnum(ScheduleFrequency)
  frequency?: ScheduleFrequency;

  @ApiPropertyOptional({ description: 'تاريخ التنفيذ القادم' })
  @IsOptional()
  @IsDateString()
  nextExecution?: Date;

  @ApiPropertyOptional({ description: 'ملاحظة' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ description: 'الحد الأقصى للتنفيذ' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxExecutions?: number;

  @ApiPropertyOptional({ description: 'تاريخ النهاية' })
  @IsOptional()
  @IsDateString()
  endDate?: Date;
}