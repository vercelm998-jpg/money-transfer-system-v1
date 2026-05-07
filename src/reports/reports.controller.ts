import { 
  Controller, 
  Get, 
  Param, 
  Query, 
  UseGuards,
  SetMetadata,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags as SwaggerApiTags, ApiOperation as SwaggerApiOperation, ApiResponse as SwaggerApiResponse, ApiBearerAuth as SwaggerApiBearerAuth } from '@nestjs/swagger';
import { RolesGuard } from '../auth/roles.guard';
import { ReportsService } from './reports.service';

@SwaggerApiTags('التقارير')
@Controller('reports')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@SetMetadata('roles', ['admin', 'moderator'])
@SwaggerApiBearerAuth()
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  // ================ تقرير يومي ================
  @Get('daily')
  @SwaggerApiOperation({ summary: 'تقرير يومي' })
  @SwaggerApiResponse({ status: 200, description: 'تقرير يومي' })
  async getDailyReport(@Query('date') date?: string) {
    return this.reportsService.getDailyReport(date);
  }

  // ================ تقرير أسبوعي ================
  @Get('weekly')
  @SwaggerApiOperation({ summary: 'تقرير أسبوعي' })
  async getWeeklyReport(@Query('startDate') startDate?: string) {
    return this.reportsService.getWeeklyReport(startDate);
  }

  // ================ تقرير شهري ================
  @Get('monthly')
  @SwaggerApiOperation({ summary: 'تقرير شهري' })
  async getMonthlyReport(
    @Query('year') year?: number,
    @Query('month') month?: number,
  ) {
    return this.reportsService.getMonthlyReport(year, month);
  }

  // ================ تقرير نصف سنوي ================
  @Get('semi-annual')
  @SwaggerApiOperation({ summary: 'تقرير نصف سنوي' })
  async getSemiAnnualReport(
    @Query('year') year?: number,
    @Query('half') half?: number,
  ) {
    return this.reportsService.getSemiAnnualReport(year, half);
  }

  // ================ تقرير سنوي ================
  @Get('annual')
  @SwaggerApiOperation({ summary: 'تقرير سنوي' })
  async getAnnualReport(@Query('year') year?: number) {
    return this.reportsService.getAnnualReport(year);
  }

  // ================ تقرير مخصص ================
  @Get('custom')
  @SwaggerApiOperation({ summary: 'تقرير مخصص (أي فترة)' })
  async getCustomReport(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.reportsService.getCustomReport(startDate, endDate);
  }

  // ================ تقرير مستخدم ================
  @Get('user/:id')
  @SwaggerApiOperation({ summary: 'تقرير مستخدم محدد' })
  async getUserReport(
    @Param('id') id: number,
    @Query('period') period: string,
    @Query('date') date?: string,
  ) {
    return this.reportsService.getUserReport(id, period, date);
  }

  // ================ تقرير العمولات ================
  @Get('commissions')
  @SwaggerApiOperation({ summary: 'تقرير العمولات' })
  async getCommissionReport(
    @Query('period') period: string,
    @Query('date') date?: string,
  ) {
    return this.reportsService.getCommissionReport(period, date);
  }

  // ================ تقرير المقارنة ================
  @Get('comparison')
  @SwaggerApiOperation({ summary: 'مقارنة الفترات (شهري/أسبوعي)' })
  async getComparisonReport() {
    return this.reportsService.getComparisonReport();
  }

  // ================ ملخص النظام ================
  @Get('summary')
  @SwaggerApiOperation({ summary: 'ملخص النظام الكامل' })
  async getSystemSummary() {
    return this.reportsService.getSystemSummary();
  }
}