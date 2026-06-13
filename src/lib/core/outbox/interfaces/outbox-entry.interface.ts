
export enum OutboxStatus {
    PENDING = 'PENDING',
    PROCESSING = 'PROCESSING',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED'
}
export enum TypeOp {
    INSERT = 'INSERT',
    UPDATE = 'UPDATE',
    DELETE = 'DELETE'
}

export interface OutboxEntry {
    id: string;
    entityName: string;
    doc: any; // El objeto de documento que debe ser guardado
    operation: TypeOp;
    status: OutboxStatus;
    attempts: number;
    createdAt: Date;
    updatedAt: Date;
    startedAt?: Date;
    finishedAt?: Date;
    error?: string;
    sheetName: string;
    payload: any;       // El objeto completo listo para ser guardado
}
// Interfaz del servicio que conectará con Fly Postgres / Prisma / TypeORM
export abstract class OutboxService {
    abstract saveTransaction(entries: OutboxEntry[]): Promise<void>;
}