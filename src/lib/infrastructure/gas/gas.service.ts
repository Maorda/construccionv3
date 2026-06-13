import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';


@Injectable()
export class GasService {
    private readonly logger = new Logger(GasService.name);
    private readonly webappUrl: string;
    private readonly apiKey: string;

    constructor(
        private readonly httpService: HttpService,
        private readonly configService: ConfigService,
    ) {
        // Obtenemos los valores
        const webappUrl = this.configService.get<string>('GAS_WEBAPP_URL');
        const apiKey = this.configService.get<string>('GAS_API_KEY');

        // Validación estricta
        if (!webappUrl || !apiKey) {
            this.logger.error('Variables de entorno faltantes: GAS_WEBAPP_URL y GAS_API_KEY son obligatorias.');
            throw new Error(
                'La configuración de SheetODM es inválida. Asegúrate de definir GAS_WEBAPP_URL y GAS_API_KEY en tu entorno.'
            );
        }

        this.webappUrl = webappUrl;
        this.apiKey = apiKey;
    }

    /**
     * Ejecuta una petición HTTP hacia GAS con lógica robusta de reintentos
     */
    private async requestWithRetry<T>(params: Record<string, any>, retries = 2, delay = 1000): Promise<T | null> {
        try {
            const response = await firstValueFrom(
                this.httpService.get('', {
                    baseURL: this.webappUrl,
                    timeout: 10000, // Timeout estricto de 10 segundos
                    params: { token: this.apiKey, ...params },
                }),
            );

            if (response.data?.error) {
                throw new Error(`GAS_INTERNAL_ERROR: ${response.data.error}`);
            }

            return response.data?.data as T;
        } catch (error: any) {
            const isNetworkOrTimeout =
                error.code === 'ECONNABORTED' ||
                !error.response ||
                (error.response && error.response.status >= 500);

            if (retries > 0 && isNetworkOrTimeout) {
                this.logger.warn(`Fallo de conexión con Google Sheets. Reintentando en ${delay}ms... (${retries} intentos restantes)`);
                await new Promise((resolve) => setTimeout(resolve, delay));
                return this.requestWithRetry<T>(params, retries - 1, delay * 2);
            }

            this.logger.error(`Error definitivo en la petición a GAS: ${error.message}`);
            throw new HttpException(
                'Error de comunicación con el motor de persistencia de Google.',
                HttpStatus.BAD_GATEWAY,
            );
        }
    }
    private async postWithRetry<T>(payload: Record<string, any>, retries = 2, delay = 1000): Promise<T | null> {
        try {
            const response = await firstValueFrom(
                this.httpService.post('',
                    { token: this.apiKey, ...payload }, // Cuerpo del POST
                    {
                        baseURL: this.webappUrl,
                        timeout: 15000, // Escritura puede tomar un poco más
                        headers: { 'Content-Type': 'application/json' }
                    }
                ),
            );

            if (response.data?.error) {
                throw new Error(`GAS_INTERNAL_ERROR: ${response.data.error}`);
            }

            return response.data?.data as T;
        } catch (error) {
            // Lógica de reintento igual a la de requestWithRetry (GET)
            if (retries > 0) {
                await new Promise((resolve) => setTimeout(resolve, delay));
                return this.postWithRetry<T>(payload, retries - 1, delay * 2);
            }
            throw new HttpException('Error en operación de escritura hacia Google.', HttpStatus.BAD_GATEWAY);
        }
    }

    // --- NUEVOS MÉTODOS PARA EL WAL MANAGER ---

    async insert<T>(sheet: string, data: T): Promise<any> {
        return this.postWithRetry({ action: 'insert', sheet, data });
    }

    async update<T>(sheet: string, data: T): Promise<any> {
        return this.postWithRetry({ action: 'update', sheet, data });
    }

    /**
     * Busca un único documento usando el índice de Google Sheets
     */
    async findOne<T>(sheet: string, column: string, value: string): Promise<T | null> {
        return this.requestWithRetry<T>({ action: 'findOne', sheet, column, value });
    }

    /**
     * Filtra múltiples documentos en memoria de forma optimizada
     */
    async findMany<T>(sheet: string, column: string, value: string): Promise<T[] | null> {
        return this.requestWithRetry<T[]>({ action: 'findMany', sheet, column, value }) || [];
    }

    async delete(sheet: string, row: number): Promise<any> {
        // Pasamos el _row dentro de un objeto 'data' para mantener consistencia con el doPost
        return this.postWithRetry({
            action: 'delete',
            sheet,
            data: { _row: row }
        });
    }


}