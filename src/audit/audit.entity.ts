import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn,
  Index
} from 'typeorm';

export enum AuditAction {
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  REGISTER = 'REGISTER',
  CHANGE_PASSWORD = 'CHANGE_PASSWORD',
  CREATE_TRANSFER = 'CREATE_TRANSFER',
  CANCEL_TRANSFER = 'CANCEL_TRANSFER',
  USER_CREATED = 'USER_CREATED',
  USER_UPDATED = 'USER_UPDATED',
  USER_DELETED = 'USER_DELETED',
  USER_STATUS_CHANGED = 'USER_STATUS_CHANGED',
  ADD_FAVORITE = 'ADD_FAVORITE',
  REMOVE_FAVORITE = 'REMOVE_FAVORITE',
  CREATE_SCHEDULE = 'CREATE_SCHEDULE',
  UPDATE_SCHEDULE = 'UPDATE_SCHEDULE',
  CANCEL_SCHEDULE = 'CANCEL_SCHEDULE',
  TRANSFER_COMPLETED = 'TRANSFER_COMPLETED',
  TRANSFER_FAILED = 'TRANSFER_FAILED',
  REPORT_GENERATED = 'REPORT_GENERATED',
  SYSTEM_ERROR = 'SYSTEM_ERROR',
  CONFIG_CHANGE = 'CONFIG_CHANGE'
}

export enum AuditSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical'
}

@Entity('audit_logs')
@Index(['userId', 'action'])
@Index(['action', 'timestamp'])
@Index(['timestamp'])
@Index(['severity'])
export class AuditLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  userId: number;

  @Column({ type: 'enum', enum: AuditAction })
  action: AuditAction;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'enum', enum: AuditSeverity, default: AuditSeverity.INFO })
  severity: AuditSeverity;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, any>;

  @Column({ length: 45, nullable: true })
  ipAddress: string;

  @Column({ length: 500, nullable: true })
  userAgent: string;

  @Column({ nullable: true, length: 100 })
  endpoint: string;

  @Column({ nullable: true, length: 10 })
  method: string;

  @Column({ nullable: true })
  statusCode: number;

  @Column({ nullable: true })
  duration: number;

  @CreateDateColumn()
  timestamp: Date;
}
