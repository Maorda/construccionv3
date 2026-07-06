import { Injectable, Logger, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { POSTGRES_TOKEN, SHEET_ODM_OPTIONS } from '../../shared/constants/constants';
import { IPostgresProvider } from '../../interfaces/provider.interface';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { SheetOdmModuleOptions } from '../../interfaces/sheet-odm-options.interface';

export interface ISheetReadDriver {
    findOne<T>(sheetName: string, column: string, value: any): Promise<T | null>;
    findMany<T>(sheetName: string, column: string, value: any): Promise<T[]>;
    find<T>(sheetName: string): Promise<T[]>;
}

// Interfaz estricta para asegurar que enviamos lo que GAS espera
interface GasPayload {
    apiKey: string;
    action: 'findOne' | 'findMany' | 'find' | 'batchCommit' | string;
    sheet: string;
    spreadsheetId: string;
    data?: any;
}

@Injectable()
export class GasQueryGateway implements ISheetReadDriver {
    private readonly logger = new Logger(GasQueryGateway.name);
    private readonly apiKey: string;
    private readonly apiUrl: string;
    private readonly spreadsheetId: string;

    constructor(
        private readonly httpService: HttpService,
        @Inject(POSTGRES_TOKEN) private readonly pg: IPostgresProvider,
        @Inject(SHEET_ODM_OPTIONS) private readonly options: SheetOdmModuleOptions,
    ) {
        if (!this.options.webAppUrl || !this.options.apiKey || !this.options.spreadsheetId) {
            throw new Error(
                'Configuración SheetODM inválida. Faltan webAppUrl, apiKey o spreadsheetId en la configuración del módulo.'
            );
        }

        this.apiUrl = this.options.webAppUrl;
        this.apiKey = this.options.apiKey;
        this.spreadsheetId = this.options.spreadsheetId;
    }

    /**
     * Centraliza las consultas indexadas y mutaciones a través de HTTP POST (doPost en GAS)
     */
    private async executeGasQuery<T>(action: string, sheet: string, data?: any, retries = 2, delay = 1000): Promise<T> {
        const startTime = Date.now();
        let success = true;
        let errorMessage: string | undefined;

        const payload: GasPayload = {
            apiKey: this.apiKey,
            action,
            sheet,
            spreadsheetId: this.spreadsheetId,
            data
        };

        try {
            const response = await firstValueFrom(
                this.httpService.post('', payload, {
                    baseURL: this.apiUrl,
                    timeout: 15000, // Aumentado ligeramente para dar margen a mutaciones batch en GAS
                    headers: { 'Content-Type': 'application/json' }
                })
            );

            if (response.data?.success === false || response.data?.error) {
                success = false;
                errorMessage = response.data?.error || 'Error interno desconocido en el motor GAS';
                throw new Error(errorMessage);
            }

            return response.data?.data as T;

        } catch (error: any) {
            const isNetworkOrTimeout = error.code === 'ECONNABORTED' || !error.response || (error.response?.status >= 500);

            if (retries > 0 && isNetworkOrTimeout) {
                this.logger.warn(`Fallo temporal en carril HTTP GAS (${action}). Reintentando en ${delay}ms... (${retries} intentos restantes)`);
                await new Promise((resolve) => setTimeout(resolve, delay));
                return this.executeGasQuery<T>(action, sheet, data, retries - 1, delay * 2);
            }

            success = false;
            errorMessage = errorMessage || error.message || 'Error de conexión';

            throw new HttpException(
                `Carril GAS Interrumpido (${action}): ${errorMessage}`,
                HttpStatus.BAD_GATEWAY,
            );
        } finally {
            const latency = Date.now() - startTime;
            try {
                // Nota: Ahora registrará tanto lecturas como escrituras ('batchCommit') en tu tabla de logs
                await this.pg.query(
                    `INSERT INTO read_logs (sheet_name, operation, latency_ms, success, error) VALUES ($1, $2, $3, $4, $5)`,
                    [sheet, action, latency, success, errorMessage || null]
                );
            } catch (logError) {
                const message = logError instanceof Error ? logError.message : String(logError);
                this.logger.error(`No se pudo guardar la métrica en Postgres: ${message}`);
            }
        }
    }

    // =========================================================================
    // IMPLEMENTACIÓN DE LA INTERFAZ DE LECTURA (CLEAN CQRS)
    // =========================================================================

    async findOne<T>(sheetName: string, column: string, value: any): Promise<T | null> {
        return this.executeGasQuery<T | null>('findOne', sheetName, { column, value });
    }

    async findMany<T>(sheetName: string, column: string, value: any): Promise<T[]> {
        const results = await this.executeGasQuery<T[] | null>('findMany', sheetName, { column, value });
        return results || [];
    }

    async find<T>(sheetName: string): Promise<T[]> {
        const results = await this.executeGasQuery<T[] | null>('find', sheetName);
        return results || [];
    }

    // =========================================================================
    // IMPLEMENTACIÓN DE MUTACIONES (ESCRITURA / OUTBOX)
    // =========================================================================

    async batchCommit<T = any>(
        sheetName: string,
        batchData: { inserts: any[][]; updates: { row: number; values: any[] }[]; deletes: number[] }
    ): Promise<T> {
        this.logger.debug(`📤 [GAS-GATEWAY] Despachando batchCommit hacia hoja [${sheetName}]`);
        return this.executeGasQuery<T>('batchCommit', sheetName, batchData);
    }

    async execute<T = any>(action: string, sheetName: string, data?: any): Promise<T> {
        return this.executeGasQuery<T>(action, sheetName, data);
    }
}