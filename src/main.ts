import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');
  const configService = app.get(ConfigService);

  // تكوين CORS
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // بادئة API العالمية
  const apiPrefix = configService.get<string>('API_PREFIX', 'api/v1');
  app.setGlobalPrefix(apiPrefix);

  // تكوين الـ Validation Pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
    validationError: {
      target: false,
      value: false,
    },
  }));

  // إضافة الفلاتر والـ Interceptors
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  // تكوين Swagger
  const config = new DocumentBuilder()
    .setTitle('نظام التحويلات المتقدم - API')
    .setDescription(`
      ## وثائق API لنظام التحويلات المتقدم
      
      ### الميزات الرئيسية:
      - 🔐 نظام مصادقة متكامل مع JWT
      - 👥 إدارة المستخدمين والصلاحيات
      - 💸 نظام تحويلات متقدم مع عمولات
      - 📊 تقارير وإحصائيات
      - 🔔 نظام إشعارات فوري
      - 📝 سجل تدقيق كامل
      - ⭐ نظام مفضلة للمستفيدين
      - 📅 جدولة التحويلات
      
      ### للمساعدة:
      - سجل الدخول أولاً للحصول على رمز JWT
      - استخدم الرمز في زر "Authorize" أعلاه
    `)
    .setVersion('2.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'أدخل رمز JWT',
        in: 'header',
      },
      'JWT-auth',
    )
    .addTag('المصادقة', 'عمليات تسجيل الدخول والتسجيل')
    .addTag('المستخدمين', 'إدارة المستخدمين')
    .addTag('التحويلات', 'عمليات التحويل')
    .addTag('الإشعارات', 'نظام الإشعارات')
    .addTag('التقارير', 'التقارير والإحصائيات')
    .addTag('المفضلة', 'إدارة المفضلة')
    .addTag('المحفظة', 'معاملات المحفظة')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'نظام التحويلات - وثائق API',
    customCss: '.swagger-ui .topbar { display: none }',
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  // تشغيل الخادم
  const port = configService.get<number>('APP_PORT', 3000);
  await app.listen(port);
  
  logger.log(`🚀 التطبيق يعمل على: http://localhost:${port}`);
  logger.log(`📚 وثائق Swagger: http://localhost:${port}/api/docs`);
  logger.log(`🔗 API Prefix: /${apiPrefix}`);
}

bootstrap();