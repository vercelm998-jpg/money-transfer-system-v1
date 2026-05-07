import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  ManyToOne, 
  JoinColumn, 
  CreateDateColumn,
  Index
} from 'typeorm';
import { User } from '../users/user.entity';

export enum NotificationType {
  TRANSFER_SENT = 'transfer_sent',
  TRANSFER_RECEIVED = 'transfer_received',
  TRANSFER_CANCELLED = 'transfer_cancelled',
  TRANSFER_FAILED = 'transfer_failed',
  LOW_BALANCE = 'low_balance',
  LIMIT_REACHED = 'limit_reached',
  ACCOUNT_STATUS = 'account_status',
  SYSTEM = 'system'
}

export enum NotificationPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent'
}

@Entity('notifications')
@Index(['userId', 'read'])
@Index(['userId', 'createdAt'])
@Index(['type', 'createdAt'])
export class Notification {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, user => user.notifications, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: number;

  @Column({ length: 200 })
  title: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'enum', enum: NotificationType })
  type: NotificationType;

  @Column({ 
    type: 'enum', 
    enum: NotificationPriority, 
    default: NotificationPriority.MEDIUM 
  })
  priority: NotificationPriority;

  @Column({ default: false })
  read: boolean;

  @Column({ nullable: true })
  transferId: number;

  @Column({ nullable: true })
  actionUrl: string;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, any>;

  @Column({ default: true })
  isActive: boolean;

  @Column({ nullable: true })
  expiresAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ nullable: true })
  readAt: Date;
}