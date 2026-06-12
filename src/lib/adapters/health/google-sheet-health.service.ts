import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { GoogleSheetProvider } from '../google-sheet.provider';
import { SheetOdmModuleOptions } from '../../interfaces/sheet-odm-options.interface';
import { SHEET_ODM_OPTIONS } from '../../sheetOdm.module';

@Injectable()
export class GoogleHealthService implements OnModuleInit {
    private readonly logger = new Logger(GoogleHealthService.name);

    constructor(
        private readonly googleSheets: GoogleSheetProvider,
        // Inyectamos el ID base para probar conectividad general
        @Inject(SHEET_ODM_OPTIONS) protected readonly optionsDatabase: SheetOdmModuleOptions,
    ) { }
    onModuleInit() {
        console.log("El módulo ha cargado completamente. Iniciando validaciones...");
        this.checkConnection();
    }

    /**
     * Verifica la salud de la conexión con Google Sheets
     */
    async checkConnection(retries = 3): Promise<{ status: 'up' | 'down'; latency?: number; details?: any }> {
        for (let i = 0; i < retries; i++) {
            try {
                const response = await this.googleSheets.sheets.spreadsheets.get({
                    spreadsheetId: this.optionsDatabase.spreadsheetId,
                    includeGridData: false,
                });
                const title = response.data.properties.title;

                this.logger.log(`✅ Conexión exitosa con el documento: "${title}"`);
                return {
                    status: 'up',
                    details: { documentTitle: title, sheetsCount: response.data.sheets.length }
                };
            } catch (error: any) {
                if (i === retries - 1) {
                    return { status: 'down', details: { error: error.message } };
                }
                this.logger.warn(`⚠️ Intento ${i + 1}/${retries} fallido. Reintentando en 1s...`);
                await new Promise(res => setTimeout(res, 1000));
            }
        }
        return { status: 'down' };
    }
}