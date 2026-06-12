import {
    Injectable,
    Logger,
    Inject,
    OnApplicationShutdown
} from '@nestjs/common';
import { GoogleHealthService } from '../adapters/health/google-sheet-health.service';
import { PostgresProvider } from '../adapters/postgres.provider';
import { IPostgresProvider } from '../interfaces/provider.interface';

// Tipos exportados para que el usuario final pueda tipar sus propios endpoints
export interface ServiceHealth {
    status: 'up' | 'down';
    latency?: number;
    details?: any;
    message?: string;
}

export interface SystemHealthStatus {
    status: 'healthy' | 'degraded' | 'down';
    timestamp: string;
    services: {
        google: ServiceHealth;
        postgres: ServiceHealth;
    };
}

@Injectable()
export class DataSourceManager implements OnApplicationShutdown {
    private readonly logger = new Logger(DataSourceManager.name);

    constructor(
        private readonly googleHealth: GoogleHealthService,
        // Inyectamos el PostgresProvider (asegúrate de que implemente IPostgresProvider)
        @Inject(PostgresProvider) private readonly postgresProvider: IPostgresProvider,
    ) { }

    /**
     * Ejecuta el cierre limpio de conexiones cuando NestJS recibe la señal de apagado (SIGTERM/SIGINT)
     */
    async onApplicationShutdown(signal?: string) {
        this.logger.log(`Recibida señal de apagado (${signal}). Cerrando conexiones limpiamente...`);
        try {
            await this.postgresProvider.disconnect();
            this.logger.log('✅ Conexiones de infraestructura cerradas correctamente.');
        } catch (error: any) {
            this.logger.error(`❌ Error cerrando conexiones: ${error.message}`);
        }
    }

    /**
     * Agrega y evalúa el estado de salud de todos los proveedores de datos.
     * Ideal para exponer en un endpoint `/health` o `/status`.
     */
    async checkAllHealth(): Promise<SystemHealthStatus> {
        this.logger.debug('Ejecutando diagnóstico integral de infraestructura...');

        // Ejecutamos las validaciones en paralelo para no sumar las latencias
        const [google, postgres] = await Promise.all([
            this.googleHealth.checkConnection(),
            this.postgresProvider.checkHealth(),
        ]);

        // Determinamos el estado global del sistema
        let globalStatus: 'healthy' | 'degraded' | 'down' = 'healthy';

        if (google.status === 'down' && postgres.status === 'down') {
            globalStatus = 'down'; // Sistema inoperable
        } else if (google.status === 'down' || postgres.status === 'down') {
            globalStatus = 'degraded'; // Funcionamiento parcial (ideal para colas de mensajes)
        }

        return {
            status: globalStatus,
            timestamp: new Date().toISOString(),
            services: {
                google,
                postgres,
            },
        };
    }

    /**
     * Wrapper centralizado para operaciones de I/O con estrategia de "Exponential Backoff".
     * * @param operation Promesa a ejecutar (ej. guardar en DB o escribir en Google Sheets)
     * @param context Contexto para los logs (ej. 'SyncDocument')
     * @param maxRetries Número máximo de intentos antes de lanzar la excepción
     * @param baseDelayMs Tiempo de espera inicial en milisegundos (se multiplica en cada fallo)
     */
    async executeWithRetry<T>(
        operation: () => Promise<T>,
        context: string = 'Operation',
        maxRetries: number = 3,
        baseDelayMs: number = 1000
    ): Promise<T> {
        let attempt = 1;

        while (attempt <= maxRetries) {
            try {
                return await operation();
            } catch (error: any) {
                if (attempt === maxRetries) {
                    this.logger.error(`❌ [${context}] Falló tras ${maxRetries} intentos. Abortando.`, error.stack);
                    throw error;
                }

                // Exponential Backoff: 1s, 2s, 4s, etc.
                const delay = baseDelayMs * Math.pow(2, attempt - 1);

                this.logger.warn(`⚠️ [${context}] Error: ${error.message}. Reintentando ${attempt}/${maxRetries} en ${delay}ms...`);

                await this.sleep(delay);
                attempt++;
            }
        }

        // Código inalcanzable por el throw anterior, pero necesario para TypeScript
        throw new Error('Unreachable retry block');
    }

    /**
     * Utilidad interna para pausar la ejecución (Sleep)
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}