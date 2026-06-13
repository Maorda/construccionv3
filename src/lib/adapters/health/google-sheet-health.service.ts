import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { GoogleSheetProvider } from '../google-sheet.provider';
import { SheetOdmModuleOptions } from '../../interfaces/sheet-odm-options.interface';
import { SHEET_ODM_OPTIONS } from '@sheetOdm/shared/constants/constants';

@Injectable()
export class GoogleHealthService implements OnModuleInit {
    private readonly logger = new Logger(GoogleHealthService.name);

    constructor(
        private readonly googleSheets: GoogleSheetProvider,
        @Inject(SHEET_ODM_OPTIONS) protected readonly optionsDatabase: SheetOdmModuleOptions,
    ) { }

    async onModuleInit() {
        this.logger.log('Iniciando validaciones de conectividad en segundo plano...');

        // Ejecutamos la verificación de salud y capturamos el resultado final
        const health = await this.checkConnection();

        if (health.status === 'down') {
            this.logger.error(`❌ La base de datos de Google Sheets no está disponible: ${health.details?.error}`);
        }
    }

    /**
     * Verifica la salud de la conexión con Google Sheets con reintentos lineales
     */
    async checkConnection(retries = 3): Promise<{ status: 'up' | 'down'; latency?: number; details?: any }> {
        for (let i = 0; i < retries; i++) {
            try {
                const startTime = Date.now();

                const response = await this.googleSheets.sheets.spreadsheets.get({
                    spreadsheetId: this.optionsDatabase.spreadsheetId,
                    includeGridData: false,
                });

                const title = response.data.properties.title;
                const latency = Date.now() - startTime;

                this.logger.log(`✅ Conexión exitosa con el documento: "${title}" (${latency}ms)`);

                return {
                    status: 'up',
                    latency,
                    details: { documentTitle: title, sheetsCount: response.data.sheets.length }
                };
            } catch (error: any) {
                const errorMessage = error.message || error;

                // Mostramos de forma transparente el error en cada intento intermedio
                this.logger.warn(`⚠️ Intento ${i + 1}/${retries} fallido. Razón: ${errorMessage}`);

                // Si ya es el último intento, no esperamos más y salimos reportando la falla
                if (i === retries - 1) {
                    return {
                        status: 'down',
                        details: { error: `Fallaron los ${retries} intentos de conexión. Último error: ${errorMessage}` }
                    };
                }

                // Espera de 1 segundo antes de pasar al siguiente ciclo del bucle
                await new Promise(res => setTimeout(res, 1000));
            }
        }
        return { status: 'down', details: { error: 'Bucle finalizado sin respuesta' } };
    }
}