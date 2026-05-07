import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from './audit.service';
import { AuditSeverity } from './audit.entity';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: (data) => {
          const duration = Date.now() - startTime;
          
          // تسجيل فقط للعمليات المهمة
          if (request.method !== 'GET') {
            const user = request.user;
            
            this.auditService.logAction(
              user?.id || null,
              `${request.method}_${request.route?.path || request.url}`,
              `${request.method} ${request.url} - ${response.statusCode}`,
              {
                body: this.sanitizeBody(request.body),
                params: request.params,
                query: request.query,
              },
              {
                ipAddress: request.ip,
                userAgent: request.headers['user-agent'],
                endpoint: request.url,
                method: request.method,
                statusCode: response.statusCode,
                duration,
              }
            ).catch(error => {
              // تجنب تعطيل الطلب بسبب فشل التدقيق
              console.error('فشل تسجيل التدقيق:', error);
            });
          }
        },
        error: (error) => {
          const duration = Date.now() - startTime;
          const user = request.user;

          this.auditService.logAction(
            user?.id || null,
            'SYSTEM_ERROR',
            `${request.method} ${request.url} - خطأ: ${error.message}`,
            {
              error: error.message,
              stack: error.stack,
            },
            {
              severity: AuditSeverity.ERROR,
              ipAddress: request.ip,
              userAgent: request.headers['user-agent'],
              endpoint: request.url,
              method: request.method,
              statusCode: error.status || 500,
              duration,
            }
          ).catch(err => {
            console.error('فشل تسجيل خطأ التدقيق:', err);
          });
        }
      }),
    );
  }

  private sanitizeBody(body: any): any {
    if (!body) return body;
    
    const sanitized = { ...body };
    const sensitiveFields = ['password', 'oldPassword', 'newPassword', 'token', 'secret'];
    
    sensitiveFields.forEach(field => {
      if (sanitized[field]) {
        sanitized[field] = '***';
      }
    });

    return sanitized;
  }
}