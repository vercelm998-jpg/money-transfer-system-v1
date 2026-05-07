import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  OneToMany, 
  CreateDateColumn, 
  UpdateDateColumn,
  BeforeInsert,
  BeforeUpdate,
  Index
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { Transfer } from '../transfers/transfer.entity';
import { Notification } from '../notifications/notification.entity';
import { Favorite } from '../favorites/favorite.entity';
import { ScheduledTransfer } from '../scheduling/scheduled-transfer.entity';
import { WalletTransaction } from '../wallet/transaction.entity';

export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
  MODERATOR = 'moderator'
}

export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
  FROZEN = 'frozen'
}

export enum KYCLevel {
  NONE = 'none',
  BASIC = 'basic',
  VERIFIED = 'verified',
  PREMIUM = 'premium'
}

@Entity('users')
@Index(['email', 'username'])
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 50 })
  username: string;

  @Column({ unique: true, length: 100 })
  email: string;

  @Column()
  @Exclude()
  password: string;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  points: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  frozenPoints: number;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.USER })
  role: UserRole;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.ACTIVE })
  status: UserStatus;

  @Column({ type: 'enum', enum: KYCLevel, default: KYCLevel.NONE })
  kycLevel: KYCLevel;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 10000 })
  dailyLimit: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 50000 })
  monthlyLimit: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  dailyTransferred: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  monthlyTransferred: number;

  @Column({ default: 0 })
  totalTransfers: number;

  @Column({ type: 'decimal', precision: 5, scale: 3, default: 0.01 })
  commissionRate: number;

  @Column({ nullable: true })
  phoneNumber: string;

  @Column({ default: false })
  twoFactorEnabled: boolean;

  @Column({ nullable: true })
  @Exclude()
  twoFactorSecret: string;

  @Column({ type: 'json', nullable: true })
  preferences: {
    language?: string;
    currency?: string;
    notifications?: boolean;
    emailNotifications?: boolean;
    smsNotifications?: boolean;
  };

  @Column({ nullable: true })
  lastLoginAt: Date;

  @Column({ nullable: true })
  lastTransferAt: Date;

  @OneToMany(() => Transfer, transfer => transfer.sender)
  sentTransfers: Transfer[];

  @OneToMany(() => Transfer, transfer => transfer.receiver)
  receivedTransfers: Transfer[];

  @OneToMany(() => Notification, notification => notification.user)
  notifications: Notification[];

  @OneToMany(() => Favorite, favorite => favorite.user)
  favorites: Favorite[];

  @OneToMany(() => ScheduledTransfer, scheduled => scheduled.user)
  scheduledTransfers: ScheduledTransfer[];

  @OneToMany(() => WalletTransaction, transaction => transaction.user)
  walletTransactions: WalletTransaction[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  get availableBalance(): number {
    return Math.max(0, Number(this.points) - Number(this.frozenPoints));
  }

  get totalBalance(): number {
    return Number(this.points);
  }

  canTransfer(amount: number): { can: boolean; reason?: string } {
    if (this.status !== UserStatus.ACTIVE) {
      return { can: false, reason: 'الحساب غير نشط' };
    }
    
    if (this.availableBalance < amount) {
      return { can: false, reason: 'رصيد غير كافي' };
    }
    
    if ((Number(this.dailyTransferred) + amount) > Number(this.dailyLimit)) {
      return { can: false, reason: 'تجاوز الحد اليومي' };
    }
    
    if ((Number(this.monthlyTransferred) + amount) > Number(this.monthlyLimit)) {
      return { can: false, reason: 'تجاوز الحد الشهري' };
    }
    
    return { can: true };
  }

  @BeforeInsert()
  @BeforeUpdate()
  resetLimitsIfNeeded() {
    const now = new Date();
    
    if (this.lastTransferAt) {
      const lastTransfer = new Date(this.lastTransferAt);
      
      // إعادة تعيين الحد اليومي
      if (lastTransfer.getDate() !== now.getDate() ||
          lastTransfer.getMonth() !== now.getMonth() ||
          lastTransfer.getFullYear() !== now.getFullYear()) {
        this.dailyTransferred = 0;
      }
      
      // إعادة تعيين الحد الشهري
      if (lastTransfer.getMonth() !== now.getMonth() ||
          lastTransfer.getFullYear() !== now.getFullYear()) {
        this.monthlyTransferred = 0;
      }
    }
  }
}