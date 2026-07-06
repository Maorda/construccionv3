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
import { createModel } from '../model/model.factory';
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
        this.logger.log('🚀 [OUTBOX:BOOT] Inicializando Outbox Processor (Alta Concurrencia + Resiliencia).');
        await this.ensureDatabaseIndices();
        this.scheduleNextTick();
    }

    private async ensureDatabaseIndices() {
        try {
            await this.pg.query(`
                CREATE INDEX IF NOT EXISTS idx_outbox_entries_polling 
                ON outbox_entries (status, next_attempt_at, started_at, created_at ASC);
            `);
            await this.pg.query(`
                CREATE INDEX IF NOT EXISTS idx_outbox_entries_purge 
                ON outbox_entries (status, finished_at);
            `);
            this.logger.log('⚡ [OUTBOX:INFRA] Índices SQL de optimización verificados exitosamente.');
        } catch (error: any) {
            this.logger.error(`❌ [OUTBOX:INFRA] Error aprovisionando índices en Postgres: ${error.message}`);
        }
    }

    onApplicationShutdown() {
        this.logger.log('🛑 [OUTBOX:SHUTDOWN] Deteniendo Outbox Processor de forma segura...');
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

        // 🟢 PASO 1: MICRO-TRANSACCIÓN RELÁMPAGO (<5ms)
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
                 FOR UPDATE SKIP LOCKED`,
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
                this.logger.debug(`📥 [OUTBOX:PULL] Reclamadas ${pendingTasks.length} tareas para sincronización.`);
            }

            await this.pg.query('COMMIT');
        } catch (error: any) {
            await this.pg.query('ROLLBACK');
            this.logger.error(`❌ [OUTBOX:PULL] Error crítico en micro-transacción de reclamo: ${error.message}`, error.stack);
            this.isRunning = false;
            this.scheduleNextTick();
            return;
        }

        // Si el lote está vacío, aprovechamos para mantenimiento ocioso
        if (pendingTasks.length === 0) {
            await this.purgeOldCompletedTasks();
            this.isRunning = false;
            this.scheduleNextTick();
            return;
        }

        // 🔵 PASO 2: PROCESAMIENTO ASÍNCRONO POR ENTIDAD
        try {
            const groupedTasks = pendingTasks.reduce((acc, task) => {
                (acc[task.entityName] = acc[task.entityName] || []).push(task);
                return acc;
            }, {} as Record<string, RawOutboxEntry[]>);

            for (const [entityName, tasks] of Object.entries(groupedTasks)) {
                if (this.isShuttingDown) break;
                await this.processGroup(entityName, tasks);
            }
        } catch (error: any) {
            this.logger.error(`❌ [OUTBOX:DISPATCH] Error inesperado distribuyendo lotes: ${error.message}`, error.stack);
        } finally {
            this.isRunning = false;
            this.scheduleNextTick();
        }
    }

    private async processGroup(entityName: string, tasks: RawOutboxEntry[]): Promise<void> {
        const entityClass = this.metadataRegistry.getEntityByName(entityName);

        if (!entityClass) {
            this.logger.error(`❌ [OUTBOX:METADATA] Entidad no registrada en el MetadataRegistry: [${entityName}].`);
            await this.markAs(tasks, OutboxStatus.FAILED, `Entidad no registrada: ${entityName}`);
            return;
        }

        const repoToken = getRepositoryToken(entityClass);
        let repo: any;
        try {
            repo = await this.moduleRef.resolve(repoToken, undefined, { strict: false });
        } catch (err: any) {
            this.logger.error(`❌ [OUTBOX:RESOLVE] No se pudo resolver el repositorio para [${entityName}]: ${err.message}`);
            await this.markAs(tasks, OutboxStatus.FAILED, err.message);
            return;
        }

        const startTime = Date.now();
        this.logger.log(`⚙️ [OUTBOX:SYNC] Iniciando sincronización física hacia Google Sheets: ${tasks.length} registros de [${entityName}]...`);

        try {
            const Model = createModel(entityClass, repo);
            const sheetName = this.metadataRegistry.getSchema(entityClass).sheetName;

            // 🟢 ESTRUCTURA BATCH DIRECTA: Estructuramos el JSON exacto que espera tu función handleBatchCommit en GAS
            const batchData = {
                inserts: [] as any[][],
                updates: [] as { row: number; values: any[] }[],
                deletes: [] as number[]
            };

            for (const task of tasks) {
                const rawData = task.payload;
                const doc = new Model(rawData);

                // Convertimos la entidad camelCase a la matriz limpia de valores ordenados de tu MetadataRegistry
                const rawRowValues = this.metadataRegistry.serialize(doc, entityClass);
                const rowIndex = rawData._row || (doc as any).rowNumber;

                if (task.operation === 'INSERT' || task.operation === 'SAVE') {
                    batchData.inserts.push(rawRowValues);
                } else if (task.operation === 'UPDATE') {
                    if (rowIndex && rowIndex !== -1) {
                        batchData.updates.push({ row: rowIndex, values: rawRowValues });
                    }
                } else if (task.operation === 'DELETE') {
                    if (rowIndex && rowIndex !== -1) {
                        batchData.deletes.push(rowIndex);
                    }
                }
            }

            // 🚀 DESPACHO AL MUNDO REAL: Extraemos los gateways de comunicación del DataSourceManager
            const dsm = (repo as any).dataSource;
            const gasGateway = (dsm as any).gasQueryGateway; // Instancia de tu GasQueryGateway

            if (!gasGateway) {
                throw new Error(`Infraestructura corrupta: gasQueryGateway no disponible en el DataSourceManager.`);
            }

            this.logger.debug(`📤 [OUTBOX:GAS-WRITE] Despachando batchCommit físico a la pestaña [${sheetName}] | Inserts: ${batchData.inserts.length}, Updates: ${batchData.updates.length}, Deletes: ${batchData.deletes.length}`);

            // Forzamos la ejecución con reintentos directamente contra el Web App de Google Sheets
            await dsm.executeWithRetry(
                async () => {
                    // Buscamos dinámicamente si tu gateway tiene un método batchCommit o una pasarela genérica de ejecución
                    if (typeof gasGateway.batchCommit === 'function') {
                        return await gasGateway.batchCommit(sheetName, batchData);
                    } else if (typeof (gasGateway as any).execute === 'function') {
                        return await (gasGateway as any).execute('batchCommit', sheetName, batchData);
                    } else {
                        // Si tu gateway usa métodos dinámicos genéricos de llamada a comandos
                        throw new Error(`El GasQueryGateway inyectado no posee un método expuesto para procesar mutaciones batchCommit.`);
                    }
                },
                `GAS Physical Sync [${sheetName}]`
            );

            const duration = Date.now() - startTime;

            // 🛡️ INVALIDACIÓN DE CACHÉ LOCAL TRAS ÉXITO FÍSICO
            try {
                await this.cacheManager.del(CacheKeys.SHEET_DATA(entityName));
            } catch (cacheErr: any) {
                this.logger.warn(`⚠️ [OUTBOX:CACHE] La purga de caché falló para [${entityName}]: ${cacheErr.message}`);
            }

            // Si GAS procesó el lote sin errores, marcamos las tareas del outbox como COMPLETED definitivas
            await this.markAs(tasks, OutboxStatus.COMPLETED);
            this.logger.log(`✅ [OUTBOX:SUCCESS] Sincronización finalizada con éxito en Google Sheets en ${duration}ms.`);

        } catch (error: any) {
            const duration = Date.now() - startTime;
            this.logger.error(`💥 [OUTBOX:FAILED] Error crítico enviando datos físicos a Google Sheets: ${error.message}`, error.stack);

            // Activación del Backoff Exponencial por tarea individual si la red o GAS fallan
            for (const task of tasks) {
                await this.handleIndividualFailure(task, error.message);
            }
        }
    }

    private async markAs(tasks: RawOutboxEntry[], status: OutboxStatus, errorMsg: string | null = null) {
        const taskIds = tasks.map(t => t.id);
        const finishedAt = status === OutboxStatus.COMPLETED ? new Date() : null;

        await this.pg.query(
            `UPDATE outbox_entries 
             SET status = $1, finished_at = $2, error = $3, next_attempt_at = NULL 
             WHERE id = ANY($4)`,
            [status, finishedAt, errorMsg, taskIds]
        );
    }

    private async handleIndividualFailure(task: RawOutboxEntry, errorMessage: string) {
        const attempts = (task.attempts || 0) + 1;
        const maxAttempts = 5;

        if (attempts >= maxAttempts) {
            this.logger.warn(`☠️ [OUTBOX:DEAD-LETTER] Tarea [${task.id}] excedió ${maxAttempts} intentos. Marcada como FAILED definitiva.`);
            await this.pg.query(
                `UPDATE outbox_entries 
                 SET status = $1, attempts = $2, error = $3, updated_at = CURRENT_TIMESTAMP, next_attempt_at = NULL 
                 WHERE id = $4`,
                [OutboxStatus.FAILED, attempts, errorMessage, task.id]
            );
        } else {
            // Backoff exponencial: 20s, 40s, 80s, 160s...
            const secondsToWait = Math.pow(2, attempts) * 10;
            const nextAttemptAt = new Date(Date.now() + secondsToWait * 1000);

            this.logger.debug(`🔄 [OUTBOX:RETRY] Tarea [${task.id}] reprogramada para reintento #${attempts} en ${secondsToWait}s.`);
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
                this.logger.log(`🧹 [OUTBOX:PURGE] Mantenimiento: ${result.rowCount} registros completados eliminados (Retención: ${retentionInterval}).`);
            }
        } catch (error: any) {
            this.logger.error(`❌ [OUTBOX:PURGE] Error en limpieza automática de la Outbox: ${error.message}`);
        }
    }

    onModuleDestroy() {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.logger.log('--- ✅ [OUTBOX:STOP] OutboxProcessor detenido de manera limpia ---');
        }
    }
}