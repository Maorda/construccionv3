import { Injectable, Scope, Logger } from '@nestjs/common';
import { OutboxEntry, OutboxService, OutboxStatus, TypeOp } from '../../outbox/interfaces/outbox-entry.interface';
import { IdFactory } from '../../../shared/id.generator';
import { ClassType } from '../../types/common.types';

export interface PendingOperation {
    type: TypeOp;
    entityClass: ClassType<any>;
    sheetName: string;
    doc: any;
    pk: string | number;
}
@Injectable({ scope: Scope.REQUEST })
export class UnitOfWork {
    private readonly logger = new Logger(UnitOfWork.name);
    private readonly identityMap = new Map<string, any>();
    private pendingOperations: PendingOperation[] = [];
    private isTransactional = false;

    // 🔥 Inyectamos el OutboxService (y removemos ModuleRef si ya no resolvemos repositorios aquí)
    constructor(private readonly outboxService: OutboxService) { }

    private getCompositeKey(entityClass: ClassType<any>, pk: string | number): string {
        return `${entityClass.name}:${pk}`;
    }

    public register(doc: any, pk: string | number, entityClass: ClassType<any>) {
        const key = this.getCompositeKey(entityClass, pk);
        if (!this.identityMap.has(key)) {
            this.identityMap.set(key, doc);
        }
    }

    public get(pk: string | number, entityClass: ClassType<any>): any | undefined {
        return this.identityMap.get(this.getCompositeKey(entityClass, pk));
    }

    public getAll(): any[] {
        return Array.from(this.identityMap.values());
    }

    public startTransaction() {
        this.isTransactional = true;
        this.pendingOperations = [];
        this.logger.debug('[UOW] 🏁 Transacción iniciada en contexto de Request.');
    }

    public queueOperation(operation: PendingOperation) {
        if (!this.isTransactional) {
            return false;
        }
        this.pendingOperations.push(operation);
        this.logger.debug(`[UOW] 📥 Encolada operación ${operation.type} para [${operation.sheetName}]`);
        return true;
    }

    public hasActiveTransaction(): boolean {
        return this.isTransactional;
    }

    public getPendingOperations() {
        return this.pendingOperations;
    }

    /**
     * 🔥 COMMIT REFACTORIZADO (Patrón Outbox)
     * Serializa las operaciones y delega la persistencia atómica a la base de datos local.
     */
    public async commit(): Promise<void> {
        if (!this.isTransactional) {
            this.logger.warn('[UOW] ⚠️ Intentando hacer commit sin una transacción activa.');
            return;
        }

        if (this.pendingOperations.length === 0) {
            this.logger.debug('[UOW] 💤 No hay operaciones pendientes en la cola. Commit omitido.');
            this.isTransactional = false;
            return;
        }

        this.logger.log(`[UOW] 🚀 Asegurando ${this.pendingOperations.length} operaciones en la Outbox local...`);

        try {
            // 1. Transformar a formato serializable (Convertimos la Clase a String)
            const outboxEntries: OutboxEntry[] = this.pendingOperations.map(op => {
                const now = new Date();

                return {
                    id: IdFactory.createUUID(),                // Requerido por tu interfaz
                    entityName: op.entityClass.name, // El nombre de tu entidad (ej. 'User')
                    sheetName: op.sheetName,
                    operation: op.type as unknown as TypeOp, // Mapeamos el 'type' a tu enum TypeOp
                    doc: op.doc,                     // Tu SheetDocument
                    payload: op.doc,                 // Aquí puedes mandar el doc entero, o si tienes un op.doc.toJS(), mejor.
                    status: OutboxStatus.PENDING,    // Usamos tu enum
                    attempts: 0,                     // Requerido: Inicia en 0
                    createdAt: now,
                    updatedAt: now                   // Requerido por tu interfaz
                };
            });

            // 2. Persistencia Atómica
            // Si la base de datos local falla (ej. caída de red), saltará al catch.
            // Si funciona, garantizamos que no se perderá ninguna operación.
            await this.outboxService.saveTransaction(outboxEntries);

            this.logger.log('🎉 [UOW] ¡Transacción asegurada en la Outbox con éxito!');

            // 3. Limpiar estado transaccional
            this.pendingOperations = [];
            this.isTransactional = false;

        } catch (error: any) {
            // Si falla el guardado local, revertimos todo y avisamos al cliente.
            this.logger.error(`❌ [UOW Commit Error] Falló la escritura en Outbox: ${error.message}`);
            this.rollback();
            throw error;
        }
    }

    public rollback() {
        this.pendingOperations = [];
        this.isTransactional = false;
        this.logger.warn('[UOW] 🔄 Transacción abortada. Cola de operaciones limpiada.');
    }

    public clear() {
        this.identityMap.clear();
        this.pendingOperations = [];
        this.isTransactional = false;
    }

    public clearByEntity(entityClass: ClassType<any>) {
        const prefix = `${entityClass.name}:`;
        for (const key of this.identityMap.keys()) {
            if (key.startsWith(prefix)) this.identityMap.delete(key);
        }
    }

}