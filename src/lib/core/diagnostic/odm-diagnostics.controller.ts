import { Controller, Get, Query } from '@nestjs/common';
import { OdmDiagnosticsService } from './odm-diagnostics.service';

@Controller('api/odm/diagnostics')
export class OdmDiagnosticsController {
    constructor(private readonly diagnostics: OdmDiagnosticsService) { }

    /**
     * Obtiene el estado de salud global (lecturas + escrituras)
     */
    @Get('health')
    async getHealth() {
        return this.diagnostics.getSystemHealth();
    }

    /**
     * Obtiene solo las operaciones de escritura pendientes
     */
    @Get('queue')
    async getQueue() {
        return this.diagnostics.getPendingQueue();
    }

    /**
     * Obtiene los últimos errores ocurridos en cualquier operación
     */
    @Get('errors')
    async getErrors(@Query('limit') limit?: string) {
        const parsedLimit = limit ? parseInt(limit, 10) : 10;
        return this.diagnostics.getRecentErrors(parsedLimit);
    }
}