import { Controller, Get } from '@nestjs/common';
import { DataSourceManager } from './lib/core/data-source-manager';

@Controller('health')
export class AppController {
    constructor(
        private readonly dataSourceManager: DataSourceManager,
    ) { }

    @Get()
    async checkSystem() {
        // Delegamos toda la responsabilidad a nuestra flamante librería
        return await this.dataSourceManager.checkAllHealth();
    }
}