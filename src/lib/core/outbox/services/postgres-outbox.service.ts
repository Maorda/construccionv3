import { Inject, Injectable, Logger } from '@nestjs/common';
import { OutboxEntry, OutboxService, OutboxStatus } from '../interfaces/outbox-entry.interface';
import { IPostgresProvider } from '../../../interfaces/provider.interface';

@Injectable()
export class PostgresOutboxService extends OutboxService {
    private readonly logger = new Logger(PostgresOutboxService.name);

    constructor(
        @Inject('POSTGRES_PROVIDER') private readonly pg: IPostgresProvider,
    ) {
        super();
    }

    async saveTransaction(entries: OutboxEntry[]): Promise<void> {
        if (!entries || entries.length === 0) return;

        const tableName = 'outbox_entries';

        // Mapeo explícito a las columnas snake_case de PostgreSQL
        const columns = [
            'entity_name',
            'operation',
            'status',
            'sheet_name',
            'payload',
            'attempts'
        ];

        const placeholders: string[] = [];
        const values: any[] = [];
        let colIndex = 1;

        // Empaquetamos dinámicamente todos los registros en un solo string SQL
        for (const entry of entries) {
            const rowPlaceholders = [
                `$${colIndex++}`, // entity_name
                `$${colIndex++}`, // operation
                `$${colIndex++}`, // status
                `$${colIndex++}`, // sheet_name
                `$${colIndex++}`, // payload (JSONB)
                `$${colIndex++}`, // attempts
            ];

            placeholders.push(`(${rowPlaceholders.join(', ')})`);

            // Si por alguna razón entry.payload viene vacío, usamos entry.doc como respaldo
            const finalPayload = entry.payload || entry.doc || {};

            values.push(
                entry.entityName,
                entry.operation,
                entry.status || OutboxStatus.PENDING,
                entry.sheetName,
                typeof finalPayload === 'object' ? JSON.stringify(finalPayload) : finalPayload,
                entry.attempts || 0
            );
        }

        const queryText = `
            INSERT INTO ${tableName} (${columns.join(', ')}) 
            VALUES ${placeholders.join(', ')}
        `;

        // Ejecución bajo una transacción SQL real con control de Pool
        const client = await this.pg.getClient();
        try {
            await client.query('BEGIN');
            await client.query(queryText, values);
            await client.query('COMMIT');
        } catch (error: any) {
            await client.query('ROLLBACK');
            this.logger.error(`❌ Error al ejecutar saveTransaction en Postgres Outbox: ${error.message}`);
            throw error;
        } finally {
            client.release(); // Devuelve el cliente al pool inmediatamente
        }
    }
}