import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThan, LessThan } from 'typeorm';
import { AuditLog, AuditAction, AuditSeverity } from './audit.entity';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private auditRepository: Repository<AuditLog>,
  ) {}

  async logAction(
    userId: number | null,
    action: string,
    description: string,
    metadata?: any,
    options?: {
      severity?: AuditSeverity;
      ipAddress?: string;
      userAgent?: string;
      endpoint?: string;
      method?: string;
      statusCode?: number;
      duration?: number;
    }
  ): Promise<AuditLog> {
    try {
      const log = this.auditRepository.create({
        userId,
        action: action as AuditAction,
        description,
        severity: options?.severity || AuditSeverity.INFO,
        metadata: {
          ...metadata,
          loggedAt: new Date().toISOString()
        },
        ipAddress: options?.ipAddress,
        userAgent: options?.userAgent,
        endpoint: options?.endpoint,
        method: options?.method,
        statusCode: options?.statusCode,
        duration: options?.duration,
        timestamp: new Date()
      });

      const savedLog = await this.auditRepository.save(log);
      
      // تسجيل في Logger أيضاً
      if (options?.severity === AuditSeverity.ERROR || options?.severity === AuditSeverity.CRITICAL) {
        this.logger.error(`[${action}] ${description}`, metadata);
      } else if (options?.severity === AuditSeverity.WARNING) {
        this.logger.warn(`[${action}] ${description}`);
      } else {
        this.logger.log(`[${action}] ${description}`);
      }

      return savedLog;
    } catch (error) {
      this.logger.error(`فشل تسجيل التدقيق: ${error.message}`, error.stack);
      return null;
    }
  }

  async getAuditLogs(
    filters: {
      userId?: number;
      action?: AuditAction;
      severity?: AuditSeverity;
      startDate?: Date;
      endDate?: Date;
      search?: string;
      method?: string;
      endpoint?: string;
    },
    page: number = 1,
    limit: number = 50,
  ) {
    const queryBuilder = this.auditRepository.createQueryBuilder('audit');

    // الفلاتر
    if (filters.userId) {
      queryBuilder.andWhere('audit.userId = :userId', { userId: filters.userId });
    }

    if (filters.action) {
      queryBuilder.andWhere('audit.action = :action', { action: filters.action });
    }

    if (filters.severity) {
      queryBuilder.andWhere('audit.severity = :severity', { severity: filters.severity });
    }

    if (filters.startDate && filters.endDate) {
      queryBuilder.andWhere(
        'audit.timestamp BETWEEN :startDate AND :endDate',
        { 
          startDate: new Date(filters.startDate), 
          endDate: new Date(filters.endDate) 
        }
      );
    }

    if (filters.search) {
      queryBuilder.andWhere(
        '(audit.description LIKE :search OR audit.action LIKE :search)',
        { search: `%${filters.search}%` }
      );
    }

    if (filters.method) {
      queryBuilder.andWhere('audit.method = :method', { method: filters.method });
    }

    if (filters.endpoint) {
      queryBuilder.andWhere('audit.endpoint LIKE :endpoint', { 
        endpoint: `%${filters.endpoint}%` 
      });
    }

    // الترتيب والصفحات
    queryBuilder
      .orderBy('audit.timestamp', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [logs, total] = await queryBuilder.getManyAndCount();

    // إحصائيات
    const stats = await this.getAuditStats(filters);

    return {
      logs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      stats
    };
  }

  private async getAuditStats(filters: any): Promise<any> {
    const queryBuilder = this.auditRepository.createQueryBuilder('audit');

    if (filters.userId) {
      queryBuilder.where('audit.userId = :userId', { userId: filters.userId });
    }

    if (filters.startDate && filters.endDate) {
      queryBuilder.andWhere(
        'audit.timestamp BETWEEN :startDate AND :endDate',
        { 
          startDate: new Date(filters.startDate), 
          endDate: new Date(filters.endDate) 
        }
      );
    }

    const actions = await queryBuilder
      .select('audit.action', 'action')
      .addSelect('COUNT(*)', 'count')
      .groupBy('audit.action')
      .orderBy('count', 'DESC')
      .getRawMany();

    const severities = await queryBuilder
      .select('audit.severity', 'severity')
      .addSelect('COUNT(*)', 'count')
      .groupBy('audit.severity')
      .getRawMany();

    const hourlyActivity = await queryBuilder
      .select('HOUR(audit.timestamp)', 'hour')
      .addSelect('COUNT(*)', 'count')
      .groupBy('HOUR(audit.timestamp)')
      .orderBy('hour', 'ASC')
      .getRawMany();

    return {
      actions: actions.reduce((acc, a) => ({ ...acc, [a.action]: parseInt(a.count) }), {}),
      severities: severities.reduce((acc, s) => ({ ...acc, [s.severity]: parseInt(s.count) }), {}),
      hourlyActivity
    };
  }

  async getAuditLogById(id: number): Promise<AuditLog> {
    const log = await this.auditRepository.findOne({ where: { id } });
    
    if (!log) {
      throw new Error('سجل التدقيق غير موجود');
    }

    return log;
  }

  async getUserActivity(userId: number, startDate?: Date, endDate?: Date): Promise<any> {
    const queryBuilder = this.auditRepository.createQueryBuilder('audit')
      .where('audit.userId = :userId', { userId });

    if (startDate && endDate) {
      queryBuilder.andWhere('audit.timestamp BETWEEN :startDate AND :endDate', {
        startDate,
        endDate
      });
    }

    const logs = await queryBuilder
      .orderBy('audit.timestamp', 'DESC')
      .take(100)
      .getMany();

    const activitySummary = {
      totalActions: logs.length,
      lastActivity: logs[0]?.timestamp || null,
      mostCommonAction: this.getMostCommonAction(logs),
      recentActions: logs.slice(0, 10).map(log => ({
        action: log.action,
        description: log.description,
        timestamp: log.timestamp
      }))
    };

    return activitySummary;
  }

  private getMostCommonAction(logs: AuditLog[]): string {
    const actionCount = logs.reduce((acc, log) => {
      acc[log.action] = (acc[log.action] || 0) + 1;
      return acc;
    }, {});

    return Object.entries(actionCount)
      .sort(([,a], [,b]) => (b as number) - (a as number))[0]?.[0] || 'N/A';
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupOldAuditLogs(): Promise<void> {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const result = await this.auditRepository.delete({
      timestamp: LessThan(ninetyDaysAgo),
      severity: AuditSeverity.INFO
    });

    if (result.affected > 0) {
      this.logger.log(`🧹 تم تنظيف ${result.affected} سجل تدقيق قديم`);
    }
  }

  async exportAuditLogs(filters: any): Promise<AuditLog[]> {
    const queryBuilder = this.auditRepository.createQueryBuilder('audit');

    if (filters.startDate && filters.endDate) {
      queryBuilder.where('audit.timestamp BETWEEN :startDate AND :endDate', {
        startDate: new Date(filters.startDate),
        endDate: new Date(filters.endDate)
      });
    }

    if (filters.severity) {
      queryBuilder.andWhere('audit.severity = :severity', { severity: filters.severity });
    }

    return queryBuilder
      .orderBy('audit.timestamp', 'DESC')
      .take(10000)
      .getMany();
  }
}