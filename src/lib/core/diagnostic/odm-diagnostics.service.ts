import { Inject, Injectable } from '@nestjs/common';
import { IPostgresProvider } from '../../interfaces/provider.interface';
import { POSTGRES_TOKEN } from '../../shared/constants/constants';

@Injectable()
export class OdmDiagnosticsService {
    constructor(
        @Inject(POSTGRES_TOKEN) private readonly pg: IPostgresProvider
    ) { }

    async getSystemHealth() {
        // 1. Métricas de Escritura (Outbox)
        const outboxStats = await this.pg.query<{ status: string; count: string }>(`
            SELECT status, COUNT(*) as count 
            FROM outbox_entries 
            GROUP BY status
        `);

        // 2. Latencia promedio de Escritura (Google Sheets)
        const writeLatency = await this.pg.query<{ avg_latency: number }>(`
            SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000), 0) as avg_latency
            FROM outbox_entries
            WHERE status = 'COMPLETED' AND started_at IS NOT NULL AND finished_at IS NOT NULL
        `);

        // 3. Métricas de Lectura (Read Logs)
        const readStats = await this.pg.query<{ total_reads: string; failed_reads: string; avg_latency: number }>(`
            SELECT 
                COUNT(*) as total_reads,
                COUNT(*) FILTER (WHERE success = FALSE) as failed_reads,
                COALESCE(AVG(latency_ms), 0) as avg_latency
            FROM read_logs
        `);

        // Procesamiento de estados de Outbox
        const writeQueue = { PENDING: 0, PROCESSING: 0, COMPLETED: 0, FAILED: 0 };
        outboxStats.rows.forEach(row => {
            if (row.status in writeQueue) {
                writeQueue[row.status as keyof typeof writeQueue] = parseInt(row.count, 10);
            }
        });

        const totalWrites = writeQueue.COMPLETED + writeQueue.FAILED;
        const writeSuccessRate = totalWrites > 0 ? (writeQueue.COMPLETED / totalWrites) * 100 : 100;

        return {
            status: (writeQueue.FAILED > 0 || parseInt(readStats.rows[0].failed_reads || '0') > 0) ? 'DEGRADED' : 'HEALTHY',
            timestamp: new Date(),
            metrics: {
                writes: {
                    queue: writeQueue,
                    successRate: `${writeSuccessRate.toFixed(2)}%`,
                    avgLatencyMs: Math.round(writeLatency.rows[0]?.avg_latency || 0)
                },
                reads: {
                    total: parseInt(readStats.rows[0].total_reads || '0', 10),
                    failed: parseInt(readStats.rows[0].failed_reads || '0', 10),
                    avgLatencyMs: Math.round(readStats.rows[0].avg_latency || 0)
                }
            }
        };
    }

    async getRecentErrors(limit = 10) {
        // Unión unificada de errores de escritura y lectura
        const query = await this.pg.query<any>(`
            SELECT 'WRITE' as type, id, entity_name as entity, operation, error, updated_at as timestamp
            FROM outbox_entries
            WHERE status = 'FAILED' OR error IS NOT NULL
            UNION ALL
            SELECT 'READ' as type, id, sheet_name as entity, operation, error, created_at as timestamp
            FROM read_logs
            WHERE success = FALSE
            ORDER BY timestamp DESC
            LIMIT $1
        `, [limit]);

        return query.rows;
    }

    async getPendingQueue() {
        const query = await this.pg.query<any>(`
            SELECT id, entity_name, operation, sheet_name, attempts, created_at
            FROM outbox_entries
            WHERE status IN ('PENDING', 'PROCESSING')
            ORDER BY created_at ASC
        `);

        return query.rows;
    }
}