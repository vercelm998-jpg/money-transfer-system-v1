import { IsString, IsNotEmpty, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ 
    description: 'اسم المستخدم',
    example: 'john_doe'
  })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({ 
    description: 'كلمة المرور',
    example: 'password123'
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;
}

export class RegisterDto {
  @ApiProperty({ 
    description: 'اسم المستخدم',
    example: 'john_doe'
  })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({ 
    description: 'البريد الإلكتروني',
    example: 'john@example.com'
  })
  @IsString()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ 
    description: 'كلمة المرور',
    example: 'password123'
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;
}

export class TokenResponse {
  @ApiProperty()
  access_token: string;

  @ApiProperty()
  user: {
    id: number;
    username: string;
    email: string;
    points: number;
    role: string;
  };
}