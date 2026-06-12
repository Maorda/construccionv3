import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { IPostgresProvider } from '../interfaces/provider.interface';
import { SheetOdmModuleOptions } from '../interfaces/sheet-odm-options.interface';

@Injectable()
export class PostgresProvider implements IPostgresProvider, OnApplicationBootstrap {
    private readonly logger = new Logger(PostgresProvider.name);
    private pool!: Pool;

    constructor(
        private config: SheetOdmModuleOptions,
    ) { }

    // Inicializamos la conexión automáticamente al arrancar NestJS
    onApplicationBootstrap() {
        this.connect();
    }

    async connect(): Promise<void> {
        const pgConfig = this.config.postgres;

        if (!pgConfig) {
            this.logger.warn('⚠️ Configuración de Postgres no proporcionada. El proveedor estará inactivo.');
            return;
        }

        // Instanciamos el Pool de conexiones
        this.pool = new Pool({
            host: pgConfig.host,
            port: pgConfig.port,
            user: pgConfig.username,
            password: pgConfig.password,
            database: pgConfig.database,
            // Soporte para conexiones SSL (necesario en AWS RDS, Supabase, Neon, etc.)
            ssl: pgConfig.ssl ? { rejectUnauthorized: false } : false,
            // Evita que las conexiones inactivas se queden colgadas infinitamente
            idleTimeoutMillis: 30000,
        });

        // Capturamos errores a nivel de Pool (ej. el servidor de BD se reinicia)
        this.pool.on('error', (err) => {
            this.logger.error(`❌ Error inesperado en el pool de Postgres: ${err.message}`, err.stack);
        });

        this.logger.log('✅ Pool de conexiones de Postgres inicializado.');
    }

    async checkHealth(): Promise<{ status: 'up' | 'down'; latency?: number; message?: string }> {
        if (!this.pool) return { status: 'down', message: 'Pool de Postgres no inicializado' };

        const startTime = Date.now();
        try {
            // Un simple SELECT 1 es el estándar de la industria para PING a SQL
            const client = await this.pool.connect();
            await client.query('SELECT 1');
            client.release(); // ¡Vital liberar el cliente de vuelta al pool!

            return {
                status: 'up',
                latency: Date.now() - startTime,
                message: 'Conexión a base de datos exitosa'
            };
        } catch (error: any) {
            this.logger.error(`Error en checkHealth de Postgres: ${error.message}`);
            return {
                status: 'down',
                latency: Date.now() - startTime,
                message: error.message
            };
        }
    }

    async disconnect(): Promise<void> {
        if (this.pool) {
            await this.pool.end();
            this.logger.log('🔌 Pool de conexiones de Postgres cerrado limpiamente.');
        }
    }

    // --- Métodos de operación para el resto de la librería ---

    async query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
        if (!this.pool) throw new Error('PostgresProvider no está inicializado.');
        return this.pool.query<T>(text, params);
    }

    async getClient(): Promise<PoolClient> {
        if (!this.pool) throw new Error('PostgresProvider no está inicializado.');
        return this.pool.connect();
    }
}