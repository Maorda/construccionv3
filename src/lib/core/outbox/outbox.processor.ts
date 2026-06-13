// src/lib/core/outbox/outbox.processor.ts
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown, OnModuleDestroy } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { OutboxStatus, OutboxEntry } from './interfaces/outbox-entry.interface';
import { IPostgresProvider } from '../../interfaces/provider.interface';
import { MetadataRegistry } from '../metadata/metadata.registry';
import { SheetOdmModuleOptions } from '../../interfaces/sheet-odm-options.interface';
import { getRepositoryToken } from '../../utils/getRepositoryToken';
import { POSTGRES_TOKEN, SHEET_ODM_OPTIONS } from '../../shared/constants/constants';

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
    ) { }

    onApplicationBootstrap() {
        this.logger.log('🚀 Outbox Processor inicializado (Modo Resiliente Avanzado).');
        this.scheduleNextTick();
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

        try {
            // 🔥 MEJORA: Solo seleccionamos tareas que ya cumplieron su tiempo de espera (Backoff)
            const result = await this.pg.query<OutboxEntry>(
                `SELECT * FROM outbox_entries 
                 WHERE status IN ($1, $2) 
                   AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
                 ORDER BY created_at ASC 
                 LIMIT 50`,
                [OutboxStatus.PENDING, OutboxStatus.FAILED]
            );

            const pendingTasks = result.rows;

            // Si no hay tareas, aprovechamos el tiempo ocioso para limpiar la casa
            if (pendingTasks.length === 0) {
                await this.purgeOldCompletedTasks();
                return;
            }

            // Transición a PROCESSING
            const taskIds = pendingTasks.map(t => t.id);
            await this.pg.query(
                `UPDATE outbox_entries 
                 SET status = $1, started_at = CURRENT_TIMESTAMP 
                 WHERE id = ANY($2)`,
                [OutboxStatus.PROCESSING, taskIds]
            );

            // Agrupar tareas por Entidad
            const groupedTasks: Record<string, typeof pendingTasks> = {};
            for (const task of pendingTasks) {
                const entityName = task.entityName || (task as any).entity_name;
                if (!groupedTasks[entityName]) groupedTasks[entityName] = [];
                groupedTasks[entityName].push(task);
            }

            // Procesar cada grupo
            for (const [entityName, tasks] of Object.entries(groupedTasks)) {
                if (this.isShuttingDown) break;
                await this.processGroup(entityName, tasks);
            }

        } catch (error) {
            this.logger.error('❌ Error crítico en el ciclo del procesador SQL', error);
        } finally {
            this.isRunning = false;
            this.scheduleNextTick();
        }
    }

    private async processGroup(entityName: string, tasks: any[]) {
        const entityClass = this.metadataRegistry.getEntityByName(entityName);

        if (!entityClass) {
            this.logger.error(`❌ Entidad no registrada: ${entityName}. No se puede obtener el repositorio.`);
            await this.markAs(tasks, OutboxStatus.FAILED, `Entidad no encontrada: ${entityName}`);
            return;
        }
        let repo: any;
        try {
            const repoToken = getRepositoryToken(entityClass);
            repo = this.moduleRef.get(repoToken, { strict: false });
        } catch (err: any) {
            this.logger.error(`❌ Fallo de inyección para la entidad: ${entityName}`);
            await this.markAs(tasks, OutboxStatus.FAILED, err.message);
            return;
        }

        const startTime = Date.now();

        try {
            const documents = tasks.map(t => t.payload || t.doc);
            await repo.commitBulk(documents);

            const duration = Date.now() - startTime;
            await this.markAs(tasks, OutboxStatus.COMPLETED);
            this.logger.log(`✅ [GAS SYNC SUCCESS] ${tasks.length} registros de [${entityName}] sincronizados. | ⏱️ Latencia: ${duration}ms`);
        } catch (error: any) {
            const duration = Date.now() - startTime;
            this.logger.error(`⚠️ [GAS SYNC FAILED] Falló lote de ${entityName}. | ⏱️ Tiempo: ${duration}ms. Aplicando Backoff Exponencial...`);
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

    // 🔥 MEJORA: Algoritmo de Backoff Exponencial
    private async handleIndividualFailure(task: any, errorMessage: string) {
        const attempts = (task.attempts || 0) + 1;

        if (attempts >= 5) {
            // Si ya falló 5 veces, queda en FAILED definitivamente
            await this.pg.query(
                `UPDATE outbox_entries 
                 SET status = $1, attempts = $2, error = $3, updated_at = CURRENT_TIMESTAMP, next_attempt_at = NULL 
                 WHERE id = $4`,
                [OutboxStatus.FAILED, attempts, errorMessage, task.id]
            );
        } else {
            // Multiplicamos el tiempo de espera de forma exponencial: 2^intentos * 10 segundos
            // Intento 1: Espera 20 segundos
            // Intento 2: Espera 40 segundos
            // Intento 3: Espera 80 segundos... dando tiempo a que las cuotas de Google se reinicien
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

    // 🔥 MEJORA: Eliminación automática de registros viejos procesados con éxito
    private async purgeOldCompletedTasks() {
        try {
            // Borra registros que lleven más de 24 horas completados con éxito
            const result = await this.pg.query(
                `DELETE FROM outbox_entries 
                 WHERE status = $1 AND finished_at < NOW() - INTERVAL '1 day'`,
                [OutboxStatus.COMPLETED]
            );
            if (result.rowCount && result.rowCount > 0) {
                this.logger.log(`🧹 [Mantenimiento] Se eliminaron ${result.rowCount} registros antiguos de la Outbox.`);
            }
        } catch (error) {
            this.logger.error('❌ Error al ejecutar el mantenimiento de la Outbox', error);
        }
    }

    onModuleDestroy() {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.logger.log('--- ✅ OutboxProcessor detenido ---');
        }
    }
}