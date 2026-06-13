import { Inject, Injectable } from '@nestjs/common';
import { IPostgresProvider } from '../../interfaces/provider.interface';
import { POSTGRES_TOKEN } from '../../shared/constants/constants';

@Injectable()
export class OdmDiagnosticsService {
    constructor(
        @Inject(POSTGRES_TOKEN) private readonly pg: IPostgresProvider
    ) { }

    async getSystemHealth() {
        // 1. Contador de estados en la Outbox
        const countersQuery = await this.pg.query<{ status: string; count: string }>(`
            SELECT status, COUNT(*) as count 
            FROM outbox_entries 
            GROUP BY status
        `);

        // 2. Latencia promedio real de Google Sheets (en milisegundos)
        const latencyQuery = await this.pg.query<{ avg_latency: number }>(`
            SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000), 0) as avg_latency
            FROM outbox_entries
            WHERE status = 'COMPLETED' AND started_at IS NOT NULL AND finished_at IS NOT NULL
        `);

        // 3. Mapear contadores a un formato legible
        const stats = { PENDING: 0, PROCESSING: 0, COMPLETED: 0, FAILED: 0 };
        countersQuery.rows.forEach(row => {
            if (row.status in stats) {
                stats[row.status as keyof typeof stats] = parseInt(row.count, 10);
            }
        });

        const totalProcessed = stats.COMPLETED + stats.FAILED;
        const successRate = totalProcessed > 0 ? (stats.COMPLETED / totalProcessed) * 100 : 100;

        return {
            status: 'HEALTHY',
            timestamp: new Date(),
            metrics: {
                queue: stats,
                successRate: `${successRate.toFixed(2)}%`,
                googleSheetsAvgLatencyMs: Math.round(latencyQuery.rows[0]?.avg_latency || 0)
            }
        };
    }

    async getRecentErrors(limit = 10) {
        const query = await this.pg.query<any>(`
            SELECT id, entity_name, operation, sheet_name, error, attempts, updated_at
            FROM outbox_entries
            WHERE status = 'FAILED' OR error IS NOT NULL
            ORDER BY updated_at DESC
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