import {
    Injectable,
    Logger,
    Inject,
    OnApplicationShutdown
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { POSTGRES_TOKEN } from '../shared/constants/constants';
import { IPostgresProvider } from '../interfaces/provider.interface';

// Servicios de Salud
import { GoogleHealthService } from '../adapters/health/google-sheet-health.service';

// Gateways (Infraestructura de I/O)
import { GasQueryGateway } from '../infrastructure/gas-web-app/gas-query.gateway';
import { SheetDataGateway } from '../infrastructure/sheet-api/sheet-data.gateway';

// Servicios Core
import { OutboxEntry, OutboxService, OutboxStatus, TypeOp } from '../core/outbox/interfaces/outbox-entry.interface';
import { MetadataRegistry } from '../core/metadata/metadata.registry';
import { ClassType } from '../core/types/common.types';
import { IdFactory } from '@sheetOdm/shared/id.generator';

// ============================================================================
// TIPOS EXPORTADOS
// ============================================================================
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

// ============================================================================
// CLASE PRINCIPAL
// ============================================================================
@Injectable()
export class DataSourceManager implements OnApplicationShutdown {
    private readonly logger = new Logger(DataSourceManager.name);

    constructor(
        private readonly googleHealth: GoogleHealthService,
        @Inject(POSTGRES_TOKEN) private readonly postgresProvider: IPostgresProvider,

        // Inyectamos los canales de comunicación
        private readonly gasQueryGateway: GasQueryGateway,
        private readonly sheetDataGateway: SheetDataGateway,
        private readonly outboxService: OutboxService,
        private readonly metadataRegistry: MetadataRegistry,
    ) { }

    // ========================================================================
    // 🚦 GESTIÓN DEL CICLO DE VIDA Y SALUD (Mantenido y optimizado)
    // ========================================================================

    async onApplicationShutdown(signal?: string) {
        this.logger.log(`Recibida señal de apagado (${signal}). Cerrando conexiones limpiamente...`);
        try {
            await this.postgresProvider.disconnect();
            this.logger.log('✅ Conexiones de infraestructura cerradas correctamente.');
        } catch (error: any) {
            this.logger.error(`❌ Error cerrando conexiones: ${error.message}`);
        }
    }

    async checkAllHealth(): Promise<SystemHealthStatus> {
        this.logger.debug('Ejecutando diagnóstico integral de infraestructura...');

        const [google, postgres] = await Promise.all([
            this.googleHealth.checkConnection(),
            this.postgresProvider.checkHealth(),
        ]);

        let globalStatus: 'healthy' | 'degraded' | 'down' = 'healthy';

        if (google.status === 'down' && postgres.status === 'down') {
            globalStatus = 'down';
        } else if (google.status === 'down' || postgres.status === 'down') {
            globalStatus = 'degraded';
        }

        return {
            status: globalStatus,
            timestamp: new Date().toISOString(),
            services: { google, postgres },
        };
    }

    // ========================================================================
    // 📖 RUTAS DE LECTURA (Delegadas al GAS Query Gateway)
    // ========================================================================

    async readFindAll<T>(sheetName: string): Promise<T[]> {
        return this.executeWithRetry(
            async () => {
                console.log(`gas query gateway ${JSON.stringify(await this.gasQueryGateway.find<T>(sheetName))}`);
                return await this.gasQueryGateway.find<T>(sheetName);
            },
            `Lectura Global - ${sheetName}`
        );
    }

    async readFindOne<T>(sheetName: string, column: string, value: any): Promise<T | null> {
        return this.executeWithRetry(
            () => this.gasQueryGateway.findOne<T>(sheetName, column, value),
            `Búsqueda Única - ${sheetName}`
        );
    }

    async readFindMany<T>(sheetName: string, column: string, value: any): Promise<T[]> {
        return this.executeWithRetry(
            () => this.gasQueryGateway.findMany<T>(sheetName, column, value),
            `Búsqueda Múltiple - ${sheetName}`
        );
    }

    // ========================================================================
    // ✍️ RUTAS DE ESCRITURA (Delegadas a Postgres Outbox)
    // ========================================================================

    /**
     * Registra la intención de mutación en Postgres.
     * Google Sheets (Trigger) se encargará de leer esto e impactar la hoja física.
     */
    /**
     * Registra la intención de mutación usando el OutboxService abstracto.
     */
    async dispatchMutation(
        entityClass: ClassType<any>,
        operation: TypeOp,
        payload: any,
        rawDoc?: any // Representa la fila (row) formateada para Google Sheets
    ): Promise<void> {
        const sheetName = this.metadataRegistry.getSchema(entityClass).sheetName;
        const entityName = entityClass.name;

        // Construimos la entrada respetando estrictamente tu interfaz OutboxEntry
        const entry: OutboxEntry = {
            id: IdFactory.createUUID(), // 🚀 Usamos tu IdFactory aquí
            entityName,
            doc: rawDoc || payload,     // 📄 Aquí viaja la data lista para la fila en Sheets
            operation,
            status: OutboxStatus.PENDING,
            attempts: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
            sheetName,
            payload                     // Payload crudo por si se requiere regenerar o auditar
        };

        // Envolvemos la llamada en nuestro motor de reintentos
        await this.executeWithRetry(
            async () => {
                await this.outboxService.saveTransaction([entry]);
            },
            `Despacho a Outbox [${operation}] - ${entityName}`,
            3,
            500
        );
    };

    // ========================================================================
    // 🏗️ RUTAS ESTRUCTURALES DIRECTAS (Delegadas a Sheet Data Gateway)
    // ========================================================================

    /**
     * Opcional: Permite realizar operaciones inmediatas (DDL) como crear hojas
     * o escribir cabeceras directamente desde Node.js sin pasar por la Outbox.
     */
    get directAdminAccess(): SheetDataGateway {
        return this.sheetDataGateway;
    }

    // ========================================================================
    // 🛡️ MOTOR DE RESILIENCIA CENTRALIZADO
    // ========================================================================

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

        throw new Error('Unreachable retry block');
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}