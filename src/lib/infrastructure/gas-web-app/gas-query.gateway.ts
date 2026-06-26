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
    action: 'findOne' | 'findMany' | 'find';
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
        // 🔥 INYECTAMOS LAS OPCIONES DEL MÓDULO, NO EL CONFIG SERVICE
        @Inject(SHEET_ODM_OPTIONS) private readonly options: SheetOdmModuleOptions,
    ) {
        // Ahora leemos de las opciones que pasaste desde AppModule -> forRootAsync -> useFactory
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
     * Centraliza las consultas indexadas exclusivamente a través de HTTP POST (doPost en GAS)
     */
    private async executeGasQuery<T>(action: string, sheet: string, data?: any, retries = 2, delay = 1000): Promise<T> {
        const startTime = Date.now();
        let success = true;
        let errorMessage: string | undefined;

        // Construimos el payload esperado por el doPost de tu motor central
        const payload = {
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
                    timeout: 12000, // Tiempo límite para búsquedas binarias complejas
                    headers: { 'Content-Type': 'application/json' }
                })
            );

            // Validar si el motor de GAS retornó un error controlado de negocio
            if (response.data?.success === false || response.data?.error) {
                success = false;
                errorMessage = response.data?.error || 'Error interno desconocido en el motor GAS';
                throw new Error(errorMessage);
            }

            return response.data?.data as T;

        } catch (error: any) {
            // Evaluar si es un error de red/timeout para aplicar reintentos
            const isNetworkOrTimeout = error.code === 'ECONNABORTED' || !error.response || (error.response?.status >= 500);

            if (retries > 0 && isNetworkOrTimeout) {
                this.logger.warn(`Fallo temporal en carril de lectura. Reintentando en ${delay}ms... (${retries} intentos restantes)`);
                await new Promise((resolve) => setTimeout(resolve, delay));
                return this.executeGasQuery<T>(action, sheet, data, retries - 1, delay * 2);
            }

            success = false;
            errorMessage = errorMessage || error.message || 'Error de conexión';

            throw new HttpException(
                `Carril de Lectura Interrumpido: ${errorMessage}`,
                HttpStatus.BAD_GATEWAY,
            );
        } finally {
            // Mantenemos tu brillante estrategia de Telemetría e Infraestructura en Postgres
            const latency = Date.now() - startTime;
            try {
                await this.pg.query(
                    `INSERT INTO read_logs (sheet_name, operation, latency_ms, success, error) VALUES ($1, $2, $3, $4, $5)`,
                    [sheet, action, latency, success, errorMessage || null]
                );
            } catch (logError) {
                const message = logError instanceof Error ? logError.message : String(logError);
                this.logger.error(`No se pudo guardar la métrica de lectura en Postgres: ${message}`);
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
        // console.log(`gas query gateway ${JSON.stringify(results)}`);
        return results || [];
    }
}