import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Response<T> {
  success: boolean;
  statusCode: number;
  message: string;
  data: T;
  timestamp: string;
  path: string;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, Response<T>> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<Response<T>> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    
    return next.handle().pipe(
      map(data => {
        // إذا كانت الاستجابة تحتوي بالفعل على message
        const message = data?.message || 'تمت العملية بنجاح';
        const actualData = data?.message ? data : data;

        return {
          success: true,
          statusCode: response.statusCode,
          message: message,
          data: actualData,
          timestamp: new Date().toISOString(),
          path: request.url,
        };
      }),
    );
  }
}