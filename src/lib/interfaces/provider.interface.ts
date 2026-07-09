import { PoolClient, QueryResult, QueryResultRow } from 'pg';
export abstract class IBaseProvider {
    abstract checkHealth(): Promise<{ status: 'up' | 'down'; message?: string }>;
    abstract connect(): Promise<void>;
    abstract disconnect(): Promise<void>;
}

export abstract class IGoogleSheetProvider extends IBaseProvider { }

export abstract class IProvider {
    abstract checkHealth(): Promise<{ status: 'up' | 'down'; latency?: number; message?: string }>;
    abstract connect(): Promise<void>;
    abstract disconnect(): Promise<void>;
}

// 🟢 SOLUCIÓN: Transmutado a Clase Abstracta para compatibilidad nativa en los builds de NestJS
export abstract class IPostgresProvider extends IProvider {
    abstract query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>>;
    abstract getClient(): Promise<PoolClient>;
}