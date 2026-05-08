import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  ManyToOne, 
  JoinColumn, 
  CreateDateColumn,
  BeforeInsert,
  Index
} from 'typeorm';
import { User } from '../users/user.entity';

export enum TransactionType {
  DEPOSIT = 'deposit',
  WITHDRAWAL = 'withdrawal',
  TRANSFER_IN = 'transfer_in',
  TRANSFER_OUT = 'transfer_out',
  COMMISSION = 'commission',
  REFUND = 'refund',
  ADJUSTMENT = 'adjustment',
  BONUS = 'bonus',
  FEE = 'fee'
}

export enum TransactionStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
  REVERSED = 'reversed'
}

@Entity('wallet_transactions')
@Index(['userId', 'createdAt'])
@Index(['type', 'createdAt'])
@Index(['status', 'createdAt'])
@Index(['referenceId'])
export class WalletTransaction {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 50 })
  transactionReference: string;

  @ManyToOne(() => User, user => user.walletTransactions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: number;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount: number;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  balanceBefore: number;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  balanceAfter: number;

  @Column({ type: 'enum', enum: TransactionType })
  type: TransactionType;

  @Column({ type: 'enum', enum: TransactionStatus, default: TransactionStatus.COMPLETED })
  status: TransactionStatus;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ nullable: true })
  referenceId: number;

  @Column({ nullable: true, length: 50 })
  referenceType: string;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, any>;

  @Column({ type: 'decimal', precision: 5, scale: 3, nullable: true })
  fee: number;

  @Column({ nullable: true, length: 3 })
  currency: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ nullable: true })
  completedAt: Date;

  @BeforeInsert()
  generateReference() {
    this.transactionReference = `TXN-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  }

  get absoluteAmount(): number {
    return Math.abs(Number(this.amount));
  }
}
