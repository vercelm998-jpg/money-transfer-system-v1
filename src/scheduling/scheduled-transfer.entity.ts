import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  ManyToOne, 
  JoinColumn, 
  CreateDateColumn,
  UpdateDateColumn,
  BeforeInsert,
  Index
} from 'typeorm';
import { User } from '../users/user.entity';

export enum ScheduleStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  FAILED = 'failed'
}

export enum ScheduleFrequency {
  ONCE = 'once',
  DAILY = 'daily',
  WEEKLY = 'weekly',
  BIWEEKLY = 'biweekly',
  MONTHLY = 'monthly',
  QUARTERLY = 'quarterly',
  YEARLY = 'yearly'
}

@Entity('scheduled_transfers')
@Index(['userId', 'status'])
@Index(['nextExecution', 'status'])
export class ScheduledTransfer {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 50 })
  scheduleReference: string;

  @ManyToOne(() => User, user => user.scheduledTransfers, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'receiverId' })
  receiver: User;

  @Column()
  receiverId: number;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount: number;

  @Column({ type: 'enum', enum: ScheduleFrequency })
  frequency: ScheduleFrequency;

  @Column({ type: 'timestamp' })
  nextExecution: Date;

  @Column({ type: 'timestamp', nullable: true })
  lastExecution: Date;

  @Column({ type: 'enum', enum: ScheduleStatus, default: ScheduleStatus.ACTIVE })
  status: ScheduleStatus;

  @Column({ type: 'text', nullable: true })
  note: string;

  @Column({ default: 0 })
  executionCount: number;

  @Column({ nullable: true })
  maxExecutions: number;

  @Column({ nullable: true })
  endDate: Date;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  totalTransferred: number;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  generateReference() {
    this.scheduleReference = `SCH-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  }

  get isExpired(): boolean {
    if (this.endDate && new Date() > new Date(this.endDate)) return true;
    if (this.maxExecutions && this.executionCount >= this.maxExecutions) return true;
    return false;
  }
}
