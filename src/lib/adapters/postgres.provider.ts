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
        // Cambiamos a un método de sincronización más robusto
        await this.syncOutboxSchema();
    }

    /**
     * Sincroniza el esquema de la base de datos:
     * 1. Crea la tabla si no existe.
     * 2. Verifica y añade columnas faltantes (evolución del esquema).
     */
    private async syncOutboxSchema(): Promise<void> {
        try {
            // 1. Crear tabla base
            const createTableQuery = `
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
            `;
            await this.pool.query(createTableQuery);

            // 2. Sincronizar columnas específicas (Evolución de esquema)
            // Aquí puedes añadir más columnas en el futuro siguiendo este patrón
            await this.addColumnIfMissing('outbox_entries', 'next_attempt_at', 'TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP');

            // 3. Crear índices (si no existen)
            await this.pool.query(`
                CREATE INDEX IF NOT EXISTS idx_outbox_processor_status 
                ON outbox_entries (status, created_at ASC);
            `);

            // AGREGAR: Nueva tabla para diagnósticos de lectura
            await this.pool.query(`
            CREATE TABLE IF NOT EXISTS read_logs (
                id BIGSERIAL PRIMARY KEY,
                sheet_name VARCHAR(255) NOT NULL,
                operation VARCHAR(50) NOT NULL,
                latency_ms INT DEFAULT 0,
                success BOOLEAN DEFAULT TRUE,
                error TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

            this.logger.log('📊 Esquema de [outbox_entries] sincronizado correctamente.');
        } catch (error: any) {
            this.logger.error(`❌ Error al sincronizar esquema de Outbox: ${error.message}`);
            throw error;
        }
    }

    /**
     * Verifica si una columna existe y la crea si es necesario
     */
    private async addColumnIfMissing(tableName: string, columnName: string, columnType: string): Promise<void> {
        const checkQuery = `
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = $1 AND column_name = $2;
        `;
        const res = await this.pool.query(checkQuery, [tableName, columnName]);

        if (res.rowCount === 0) {
            this.logger.warn(`⚠️ Columna '${columnName}' no encontrada en '${tableName}'. Creándola...`);
            await this.pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
            this.logger.log(`✅ Columna '${columnName}' añadida con éxito.`);
        }
    }

    async connect(): Promise<void> {
        const pgConfig = this.config.postgres;

        if (!pgConfig) {
            this.logger.warn('⚠️ Configuración de Postgres no proporcionada.');
            return;
        }

        this.pool = new Pool({
            host: pgConfig.host,
            port: pgConfig.port,
            user: pgConfig.username,
            password: pgConfig.password,
            database: pgConfig.database,
            ssl: pgConfig.ssl ? { rejectUnauthorized: false } : false,
            idleTimeoutMillis: 30000,
        });

        // Verificación de conexión rápida
        await this.pool.query('SELECT 1');
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