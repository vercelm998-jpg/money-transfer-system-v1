import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  ManyToOne, 
  JoinColumn, 
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
  Index
} from 'typeorm';
import { User } from '../users/user.entity';

@Entity('favorites')
@Unique(['userId', 'favoriteUserId'])
@Index(['userId'])
@Index(['favoriteUserId'])
export class Favorite {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, user => user.favorites, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'favoriteUserId' })
  favoriteUser: User;

  @Column()
  favoriteUserId: number;

  @Column({ nullable: true, length: 100 })
  nickname: string;

  @Column({ type: 'text', nullable: true })
  note: string;

  @Column({ default: 0 })
  transferCount: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  totalTransferred: number;

  @Column({ nullable: true })
  lastTransferAt: Date;

  @Column({ type: 'json', nullable: true })
  tags: string[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
