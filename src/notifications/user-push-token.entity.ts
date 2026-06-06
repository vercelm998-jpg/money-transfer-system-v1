import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { User } from '../users/user.entity';

@Entity('user_push_tokens')
export class UserPushToken {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column()
  userId: number;

  @Column({ length: 255 })
  token: string;

  @Column({ length: 50, default: 'expo' })
  type: string; // 'expo', 'fcm', 'apns'

  @Column({ default: true })
  isActive: boolean;

  @Column({ length: 50, nullable: true })
  deviceName: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
