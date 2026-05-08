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

export enum TransferStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  REVERSED = 'reversed',
  DELIVERED = 'delivered'  // 🆕 حالة جديدة: تم التسليم
}

export enum TransferType {
  INTERNAL = 'internal',
  SCHEDULED = 'scheduled',
  RECURRING = 'recurring'
}

@Entity('transfers')
@Index(['senderId', 'createdAt'])
@Index(['receiverId', 'createdAt'])
@Index(['status', 'createdAt'])
export class Transfer {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 50 })
  referenceNumber: string;

  @ManyToOne(() => User, user => user.sentTransfers)
  @JoinColumn({ name: 'senderId' })
  sender: User;

  @Column()
  senderId: number;

  @ManyToOne(() => User, user => user.receivedTransfers)
  @JoinColumn({ name: 'receiverId' })
  receiver: User;

  @Column()
  receiverId: number;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  commission: number;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  totalAmount: number;

  @Column({ type: 'enum', enum: TransferType, default: TransferType.INTERNAL })
  type: TransferType;

  @Column({ type: 'enum', enum: TransferStatus, default: TransferStatus.PENDING })
  status: TransferStatus;

  // 🆕 حقل تأكيد التسليم
  @Column({ type: 'boolean', default: false })
  isDelivered: boolean;

  // 🆕 تاريخ تأكيد التسليم
  @Column({ type: 'timestamp', nullable: true })
deliveredAt: Date;
  // 🆕 ملاحظة من المستلم عند الاستلام
  @Column({ type: 'text', nullable: true })
  deliveryNote: string;

  @Column({ type: 'text', nullable: true })
  note: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ nullable: true })
  @Index()
  completedAt: Date;

  @Column({ nullable: true })
  cancelledAt: Date;

  @Column({ type: 'text', nullable: true })
  failureReason: string;

  @Column({ type: 'json', nullable: true })
  metadata: {
    ip?: string;
    userAgent?: string;
    location?: string;
    device?: string;
    createdBy?: string;
    commissionRate?: number;
  };

  @CreateDateColumn()
  createdAt: Date;

  @Column({ nullable: true })
  updatedAt: Date;

  @BeforeInsert()
  generateReferenceNumber() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    this.referenceNumber = `TRF-${timestamp}-${random}`;
    
    if (!this.totalAmount) {
      this.totalAmount = Number(this.amount) + Number(this.commission || 0);
    }
  }
}