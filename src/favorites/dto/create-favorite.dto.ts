import { 
  IsNumber, 
  IsNotEmpty, 
  IsOptional, 
  IsString,
  IsArray,
  MaxLength
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateFavoriteDto {
  @ApiProperty({ 
    description: 'معرف المستخدم المراد إضافته للمفضلة',
    example: 2
  })
  @IsNumber()
  @IsNotEmpty()
  favoriteUserId: number;

  @ApiPropertyOptional({ 
    description: 'اسم مستعار للمستخدم المفضل',
    example: 'صديقي المفضل'
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  nickname?: string;

  @ApiPropertyOptional({ 
    description: 'ملاحظة عن هذا المفضل',
    example: 'صديق من العمل'
  })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ 
    description: 'وسوم للتصنيف',
    example: ['صديق', 'عمل']
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class UpdateFavoriteDto {
  @ApiPropertyOptional({ description: 'اسم مستعار' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  nickname?: string;

  @ApiPropertyOptional({ description: 'ملاحظة' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ description: 'وسوم' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}