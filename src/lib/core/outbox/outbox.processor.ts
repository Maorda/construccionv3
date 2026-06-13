import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown, OnModuleDestroy } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { OutboxStatus, OutboxEntry } from './interfaces/outbox-entry.interface';
import { IPostgresProvider } from '../../interfaces/provider.interface';
import { MetadataRegistry } from '../metadata/metadata.registry';
import { SheetOdmModuleOptions } from '../../interfaces/sheet-odm-options.interface';
import { getRepositoryToken } from '@sheetOdm/utils/getRepositoryToken';
import { POSTGRES_TOKEN, SHEET_ODM_OPTIONS } from '@sheetOdm/shared/constants/constants';



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
        this.logger.log('🚀 Outbox Processor inicializado (Modo Postgres Nativo).');
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
            // 1. Obtener tareas usando SQL crudo a través de tu PostgresProvider
            const result = await this.pg.query<OutboxEntry>(
                `SELECT * FROM outbox_entries 
                 WHERE status IN ($1, $2) 
                 ORDER BY created_at ASC 
                 LIMIT 50`,
                [OutboxStatus.PENDING, OutboxStatus.FAILED]
            );

            const pendingTasks = result.rows;
            if (pendingTasks.length === 0) return;

            // Transición a PROCESSING usando ANY() para actualizar en bloque
            const taskIds = pendingTasks.map(t => t.id);
            await this.pg.query(
                `UPDATE outbox_entries 
                 SET status = $1, started_at = CURRENT_TIMESTAMP 
                 WHERE id = ANY($2)`,
                [OutboxStatus.PROCESSING, taskIds]
            );

            // 2. Agrupar tareas por Entidad (Manejando camelCase vs snake_case si aplica)
            const groupedTasks: Record<string, typeof pendingTasks> = {};
            for (const task of pendingTasks) {
                // Asegúrate de que task.entity_name coincida con el nombre de tu columna en BD
                const entityName = task.entityName || (task as any).entity_name;
                if (!groupedTasks[entityName]) groupedTasks[entityName] = [];
                groupedTasks[entityName].push(task);
            }

            // 3. Procesar cada grupo
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
        // 🔥 AQUÍ INICIA LA TELEMETRÍA DE RENDIMIENTO HACIA GOOGLE SHEETS
        const startTime = Date.now();

        try {
            // Pasamos el payload o doc. Si en Postgres es un JSONB, el driver 'pg' ya lo parsea.
            const documents = tasks.map(t => t.payload || t.doc);
            await repo.commitBulk(documents);
            const duration = Date.now() - startTime; // ⏱️ Calculamos el tiempo transcurrido
            await this.markAs(tasks, OutboxStatus.COMPLETED);
            // 📊 Log de éxito con métricas
            this.logger.log(
                `✅ [GAS SYNC SUCCESS] ${tasks.length} registros de [${entityName}] sincronizados. | ⏱️ Tiempo API Google: ${duration}ms`
            );
        } catch (error: any) {
            const duration = Date.now() - startTime; // ⏱️ Calculamos cuánto tardó en fallar

            // 📊 Log de error con métricas
            this.logger.error(
                `⚠️ [GAS SYNC FAILED] Falló lote de ${entityName}. | ⏱️ Tiempo hasta fallo: ${duration}ms | Error: ${error.message}. Degradando a reintento individual...`
            );

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
             SET status = $1, finished_at = $2, error = $3 
             WHERE id = ANY($4)`,
            [status, finishedAt, errorMsg, taskIds]
        );
    }

    private async handleIndividualFailure(task: any, errorMessage: string) {
        const attempts = (task.attempts || 0) + 1;
        const status = attempts >= 5 ? OutboxStatus.FAILED : OutboxStatus.PENDING;

        await this.pg.query(
            `UPDATE outbox_entries 
             SET status = $1, attempts = $2, error = $3, updated_at = CURRENT_TIMESTAMP 
             WHERE id = $4`,
            [status, attempts, errorMessage, task.id]
        );
    }

    onModuleDestroy() {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.logger.log('--- ✅ OutboxProcessor detenido ---');
        }
    }
}