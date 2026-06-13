import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleSheetProvider } from '../../adapters/google-sheet.provider'; // Importa tu proveedor


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
    ) {
        const scriptId = this.configService.get<string>('GAS_SCRIPT_ID');
        if (!scriptId) {
            throw new Error('GAS_SCRIPT_ID es obligatorio en las variables de entorno.');
        }
        this.scriptId = scriptId;
    }

    private async executeGasOperation<T>(action: string, sheet: string, data?: any): Promise<T> {
        try {
            // Usamos el cliente 'script' desde el proveedor centralizado
            const response = await this.provider.script.scripts.run({
                scriptId: this.scriptId,
                requestBody: {
                    function: 'executeSheetOdmOperation',
                    parameters: [{ action, sheet, data }],
                },
            });

            if (response.data.error) {
                throw new Error(response.data.error.details?.[0]?.errorMessage || response.data.error.message);
            }

            return response.data.response.result as T;
        } catch (error: any) {
            this.logger.error(`❌ Error en ejecución de GAS: ${error.message}`);
            throw new HttpException(
                `Error en comunicación con GAS: ${error.message}`,
                HttpStatus.BAD_GATEWAY
            );
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