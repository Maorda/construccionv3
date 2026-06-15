import { Injectable, Logger, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleSheetProvider } from '../../adapters/google-sheet.provider'; // Importa tu proveedor
import { POSTGRES_TOKEN } from '../../shared/constants/constants';
import { IPostgresProvider } from '../../interfaces/provider.interface';


export interface ISheetReadDriver {
    /**
     * Busca un único registro que coincida con un valor en una columna específica.
     */
    findOne<T>(sheetName: string, column: string, value: any): Promise<T | null>;

    /**
     * Busca todos los registros que coincidan con un valor en una columna específica.
     */
    findMany<T>(sheetName: string, column: string, value: any): Promise<T[]>;

    /**
     * Obtiene todos los registros de la hoja especificada.
     */
    find<T>(sheetName: string): Promise<T[]>;
}

@Injectable()
export class GasQueryGateway implements ISheetReadDriver {
    private readonly logger = new Logger(GasQueryGateway.name);
    private readonly scriptId: string;

    constructor(
        private readonly provider: GoogleSheetProvider, // Inyección del proveedor
        private readonly configService: ConfigService,
        @Inject(POSTGRES_TOKEN) private readonly pg: IPostgresProvider,
    ) {
        const scriptId = this.configService.get<string>('GAS_SCRIPT_ID');
        if (!scriptId) {
            throw new Error('GAS_SCRIPT_ID es obligatorio en las variables de entorno.');
        }
        this.scriptId = scriptId;
    }

    private async executeGasOperation<T>(action: string, sheet: string, data?: any): Promise<T> {
        const startTime = Date.now();
        let success = true;
        // Cambiamos string | null por string | undefined
        let errorMessage: string | undefined;

        try {
            const response = await this.provider.script.scripts.run({
                scriptId: this.scriptId,
                requestBody: {
                    function: 'executeSheetOdmOperation',
                    parameters: [{ action, sheet, data }],
                    devMode: true
                },
            });

            if (response.data.error) {
                success = false;
                // Usamos el operador de coalescencia (??) para asegurar que siempre haya un string
                errorMessage = response.data.error.details?.[0]?.errorMessage || response.data.error.message || 'Error desconocido';
                throw new Error(errorMessage);
            }

            return response.data.response.result as T;
        } catch (error: any) {
            success = false;
            // Si no se asignó antes, lo capturamos aquí
            errorMessage = errorMessage || error.message || 'Error desconocido';
            throw new HttpException(
                `Error en comunicación con GAS: ${errorMessage}`,
                HttpStatus.BAD_GATEWAY
            );
        } finally {
            const latency = Date.now() - startTime;
            try {
                await this.pg.query(
                    `INSERT INTO read_logs (sheet_name, operation, latency_ms, success, error) VALUES ($1, $2, $3, $4, $5)`,
                    [sheet, action, latency, success, errorMessage]
                );
            } catch (logError: unknown) {
                // Solución para el error de 'unknown': verificamos si es una instancia de Error
                const message = logError instanceof Error ? logError.message : String(logError);
                this.logger.error(`Falló al registrar el log en la DB: ${message}`);
            }
        }
    }

    async findOne<T>(sheetName: string, column: string, value: any): Promise<T | null> {
        return this.executeGasOperation<T | null>('findOne', sheetName, { column, value });
    }

    async findMany<T>(sheetName: string, column: string, value: any): Promise<T[]> {
        const results = await this.executeGasOperation<T[] | null>('findMany', sheetName, { column, value });
        return results || [];
    }

    async find<T>(sheetName: string): Promise<T[]> {
        const results = await this.executeGasOperation<T[] | null>('find', sheetName);
        return results || [];
    }
}