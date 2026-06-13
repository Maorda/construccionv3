import { Controller, Get, Query } from '@nestjs/common';
import { OdmDiagnosticsService } from './odm-diagnostics.service';

@Controller('api/odm/diagnostics')
export class OdmDiagnosticsController {
    constructor(private readonly diagnostics: OdmDiagnosticsService) { }

    @Get('health')
    async getHealth() {
        return this.diagnostics.getSystemHealth();
    }

    @Get('queue')
    async getQueue() {
        return this.diagnostics.getPendingQueue();
    }

    @Get('errors')
    async getErrors(@Query('limit') limit?: string) {
        const parsedLimit = limit ? parseInt(limit, 10) : 10;
        return this.diagnostics.getRecentErrors(parsedLimit);
    }
}