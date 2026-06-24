// src/lib/core/outbox/outbox.processor.ts
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown, OnModuleDestroy } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { OutboxStatus, OutboxEntry } from './interfaces/outbox-entry.interface';
import { IPostgresProvider } from '../../interfaces/provider.interface';
import { MetadataRegistry } from '../metadata/metadata.registry';
import { SheetOdmModuleOptions } from '../../interfaces/sheet-odm-options.interface';
import { getRepositoryToken } from '../../utils/getRepositoryToken';
import { POSTGRES_TOKEN, SHEET_ODM_OPTIONS } from '../../shared/constants/constants';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { CacheKeys } from '../cache/cache.keys';

export interface RawOutboxEntry {
    id: string;
    entityName: string;
    sheetName: string;
    operation: string;
    payload: Record<string, any>;

    attempts: number;
}

@Injectable()
export class OutboxProcessor implements OnApplicationBootstrap, OnApplicationShutdown, OnModuleDestroy {
    private readonly logger = new Logger(OutboxProcessor.name);
    private isRunning = false;
    private isShuttingDown = false;
    private timeoutId?: NodeJS.Timeout;

    constructor(
        private readonly moduleRef: ModuleRef,
        @Inject(POSTGRES_TOKEN) private readonly pg: IPostgresProvider,
        @Inject(SHEET_ODM_OPTIONS) private readonly options: SheetOdmModuleOptions,
        private readonly metadataRegistry: MetadataRegistry,
        @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    ) { }

    async onApplicationBootstrap() {
        this.logger.log('🚀 Outbox Processor inicializado (Modo Resiliente de Alta Concurrencia).');
        await this.ensureDatabaseIndices();
        this.scheduleNextTick();
    }

    private async ensureDatabaseIndices() {
        try {
            // Indexamos por estado y tiempos para acelerar el pooling y rescate de zombis
            await this.pg.query(`
                CREATE INDEX IF NOT EXISTS idx_outbox_entries_polling 
                ON outbox_entries (status, next_attempt_at, started_at, created_at ASC);
            `);
            await this.pg.query(`
                CREATE INDEX IF NOT EXISTS idx_outbox_entries_purge 
                ON outbox_entries (status, finished_at);
            `);
            this.logger.log('⚡ [Infraestructura SQL] Índices de optimización verificados/creados exitosamente.');
        } catch (error: any) {
            this.logger.error(`❌ No se pudo auto-provisionar los índices en Postgres: ${error.message}`);
        }
    }

    onApplicationShutdown() {
        this.logger.log('🛑 Apagando Outbox Processor de forma segura...');
        this.isShuttingDown = true;
        if (this.timeoutId) clearTimeout(this.timeoutId);
    }

    private scheduleNextTick() {
        if (this.isShuttingDown) return;
        const interval = this.options.outboxPollingInterval || 10000;
        this.timeoutId = setTimeout(() => this.processPendingOperations(), interval);
    }

    private async processPendingOperations() {
        if (this.isRunning || this.isShuttingDown) return;
        this.isRunning = true;

        let pendingTasks: RawOutboxEntry[] = [];

        // 🟢 PASO 1: MICRO-TRANSMISIÓN RELÁMPAGO (Aislamiento Total de Concurrencia)
        // Entramos, bloqueamos las filas desocupadas, cambiamos estado y salimos en < 5ms.
        await this.pg.query('BEGIN');
        try {
            const result = await this.pg.query<RawOutboxEntry>(
                `SELECT id, 
            entity_name as "entityName", 
            sheet_name as "sheetName", 
            operation, 
            payload, 
            attempts 
     FROM outbox_entries 
     WHERE (status IN ($1, $2) AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP))
        OR (status = $3 AND started_at <= CURRENT_TIMESTAMP - INTERVAL '5 minutes') -- 🧟 RESCATE DE ZOMBIS
     ORDER BY created_at ASC 
     LIMIT 50
     FOR UPDATE SKIP LOCKED`, // 🔐 Evita colisiones de concurrencia
                [OutboxStatus.PENDING, OutboxStatus.FAILED, OutboxStatus.PROCESSING]
            );

            pendingTasks = result.rows;

            if (pendingTasks.length > 0) {
                const taskIds = pendingTasks.map(t => t.id);
                await this.pg.query(
                    `UPDATE outbox_entries 
                     SET status = $1, started_at = CURRENT_TIMESTAMP, error = NULL 
                     WHERE id = ANY($2)`,
                    [OutboxStatus.PROCESSING, taskIds]
                );
            }

            await this.pg.query('COMMIT'); // 🔓 Liberamos Postgres INMEDIATAMENTE. El pool queda intacto.

        } catch (error) {
            await this.pg.query('ROLLBACK');
            this.logger.error('❌ Error crítico reclamando transacciones en la micro-transacción de la Outbox', error);
            this.isRunning = false;
            this.scheduleNextTick();
            return;
        }

        // Si no hay tareas, mantenimiento ocioso y salida
        if (pendingTasks.length === 0) {
            await this.purgeOldCompletedTasks();
            this.isRunning = false;
            this.scheduleNextTick();
            return;
        }

        // 🔵 PASO 2: PROCESAMIENTO ASÍNCRONO (Fuera de la BD local)
        try {
            const groupedTasks: Record<string, typeof pendingTasks> = {};
            for (const task of pendingTasks) {
                const entityName = task.entityName;
                if (!groupedTasks[entityName]) groupedTasks[entityName] = [];
                groupedTasks[entityName].push(task);
            }

            for (const [entityName, tasks] of Object.entries(groupedTasks)) {
                if (this.isShuttingDown) break;
                await this.processGroup(entityName, tasks);
            }
        } catch (error) {
            this.logger.error('❌ Error inesperado distribuyendo los lotes de la Outbox', error);
        } finally {
            this.isRunning = false;
            this.scheduleNextTick();
        }
    }

    private async processGroup(entityName: string, tasks: any[]) {
        const entityClass = this.metadataRegistry.getEntityByName(entityName);
        if (!entityClass) {
            this.logger.error(`❌ Entidad no registrada en el MetadataRegistry: ${entityName}.`);
            await this.markAs(tasks, OutboxStatus.FAILED, `Entidad no encontrada: ${entityName}`);
            return;
        }

        const repoToken = getRepositoryToken(entityClass);
        let repo: any;
        try {
            repo = await this.moduleRef.resolve(repoToken, undefined, { strict: false });
        } catch (err: any) {
            this.logger.error(`❌ No se pudo resolver el repositorio dinámico para ${entityName}: ${err.message}`);
            await this.markAs(tasks, OutboxStatus.FAILED, err.message);
            return;
        }

        const startTime = Date.now();

        try {
            // Re-instanciamos respetando el orden cronológico estricto que vino desde la base de datos
            const documents = tasks.map(t => {
                const rawData = t.payload; // 🚀 Directo al payload real
                this.logger.debug(`[PAYLOAD DESDE OUTBOX DB]: ${JSON.stringify(rawData)}`);
                const doc = repo.create(rawData);
                if (rawData._row !== undefined) {
                    doc.markAsSaved(rawData._row);
                }
                return doc;
            });

            // 🚀 Envío masivo HTTP a Google Sheets sin afectar el pool transaccional de Postgres
            await repo.commitBulk(documents);
            await this.cacheManager.del(CacheKeys.SHEET_DATA(entityName));

            await this.markAs(tasks, OutboxStatus.COMPLETED);

            const duration = Date.now() - startTime;
            await this.markAs(tasks, OutboxStatus.COMPLETED);
            this.logger.log(`✅ [GAS SYNC SUCCESS] Lote de ${tasks.length} registros de [${entityName}] sincronizados. | ⏱️ Latencia: ${duration}ms`);
        } catch (error: any) {
            const duration = Date.now() - startTime;
            this.logger.error(`⚠️ [GAS SYNC FAILED] Lote de ${entityName} falló. | ⏱️ Tiempo: ${duration}ms. Aplicando Backoff individual...`);

            for (const task of tasks) {
                await this.handleIndividualFailure(task, error.message);
            }
        }
    }

    private async markAs(tasks: any[], status: OutboxStatus, errorMsg: string | null = null) {
        const taskIds = tasks.map(t => t.id);
        const finishedAt = status === OutboxStatus.COMPLETED ? new Date() : null;

        await this.pg.query(
            `UPDATE outbox_entries 
             SET status = $1, finished_at = $2, error = $3, next_attempt_at = NULL 
             WHERE id = ANY($4)`,
            [status, finishedAt, errorMsg, taskIds]
        );
    }

    private async handleIndividualFailure(task: any, errorMessage: string) {
        const attempts = (task.attempts || 0) + 1;

        if (attempts >= 5) {
            await this.pg.query(
                `UPDATE outbox_entries 
                 SET status = $1, attempts = $2, error = $3, updated_at = CURRENT_TIMESTAMP, next_attempt_at = NULL 
                 WHERE id = $4`,
                [OutboxStatus.FAILED, attempts, errorMessage, task.id]
            );
        } else {
            const secondsToWait = Math.pow(2, attempts) * 10;
            const nextAttemptAt = new Date(Date.now() + secondsToWait * 1000);

            await this.pg.query(
                `UPDATE outbox_entries 
                 SET status = $1, attempts = $2, error = $3, updated_at = CURRENT_TIMESTAMP, next_attempt_at = $4 
                 WHERE id = $5`,
                [OutboxStatus.PENDING, attempts, errorMessage, nextAttemptAt, task.id]
            );
        }
    }

    private async purgeOldCompletedTasks() {
        try {
            const retentionInterval = this.options.outboxRetentionInterval || '2 hours';
            const result = await this.pg.query(
                `DELETE FROM outbox_entries 
                 WHERE status = $1 
                   AND finished_at < CURRENT_TIMESTAMP - ($2::INTERVAL)`,
                [OutboxStatus.COMPLETED, retentionInterval]
            );

            if (result.rowCount && result.rowCount > 0) {
                this.logger.log(`🧹 [Mantenimiento] Se eliminaron ${result.rowCount} registros antiguos de la Outbox (Retención: ${retentionInterval}).`);
            }
        } catch (error: any) {
            this.logger.error('❌ Error al ejecutar el mantenimiento dinámico de la Outbox', error.message);
        }
    }

    onModuleDestroy() {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.logger.log('--- ✅ OutboxProcessor detenido de manera limpia ---');
        }
    }
}