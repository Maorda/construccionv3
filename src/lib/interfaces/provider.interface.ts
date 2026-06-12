import { PoolClient, QueryResult, QueryResultRow } from 'pg';
export interface IBaseProvider {
    checkHealth(): Promise<{ status: 'up' | 'down'; message?: string }>;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
}

export interface IGoogleSheetProvider extends IBaseProvider { }

export interface IProvider {
    checkHealth(): Promise<{ status: 'up' | 'down'; latency?: number; message?: string }>;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
}

export interface IPostgresProvider extends IProvider {
    // Ahora T está obligado a ser un objeto compatible con las filas de Postgres
    query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>>; getClient(): Promise<PoolClient>;
}