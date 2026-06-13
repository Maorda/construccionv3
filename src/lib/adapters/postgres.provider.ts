import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { IPostgresProvider } from '../interfaces/provider.interface';
import { SheetOdmModuleOptions } from '../interfaces/sheet-odm-options.interface';
import { SHEET_ODM_OPTIONS } from '@sheetOdm/shared/constants/constants';
@Injectable()
export class PostgresProvider implements IPostgresProvider, OnApplicationBootstrap {
    private readonly logger = new Logger(PostgresProvider.name);
    private pool!: Pool;

    constructor(
        private config: SheetOdmModuleOptions,
    ) { }

    // Inicializamos la conexión automáticamente al arrancar NestJS
    async onApplicationBootstrap() {
        await this.connect();
        await this.ensureOutboxTableExists();
    }

    private async ensureOutboxTableExists(): Promise<void> {
        const queryText = `
        CREATE TABLE IF NOT EXISTS outbox_entries (
            id BIGSERIAL PRIMARY KEY,
            entity_name VARCHAR(255) NOT NULL,
            operation VARCHAR(50) NOT NULL,
            status VARCHAR(50) DEFAULT 'PENDING',
            sheet_name VARCHAR(255) NOT NULL,
            payload JSONB NOT NULL,
            attempts INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            started_at TIMESTAMP,
            finished_at TIMESTAMP,
            error TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_outbox_processor_status 
        ON outbox_entries (status, created_at ASC);
    `;

        try {
            await this.pool.query(queryText);
            this.logger.log('📊 Estructura de tabla [outbox_entries] verificada/creada correctamente.');
        } catch (error: any) {
            this.logger.error(`❌ Error crítico al inicializar la tabla de Outbox: ${error.message}`, error.stack);
            // Dependiendo de tu diseño, puedes lanzar el error para detener el arranque si es vital
            throw error;
        }
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
        const tableCheck = await this.pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'outbox_entries'
            );
        `);

        if (tableCheck.rows[0].exists) {
            this.logger.log('📊 Tabla [outbox_entries] verificada en la base de datos.');
        } else {
            this.logger.error('❌ La tabla [outbox_entries] no existe en la base de datos actual .');
        }

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