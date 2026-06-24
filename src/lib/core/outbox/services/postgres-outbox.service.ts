import { Inject, Injectable, Logger } from '@nestjs/common';
import { CreateOutboxEntryDto, OutboxEntry, OutboxService, OutboxStatus } from '../interfaces/outbox-entry.interface';
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

        const columns = ['entity_name', 'operation', 'status', 'sheet_name', 'payload', 'attempts'];
        const values: any[] = [];
        const placeholders = entries.map((entry, index) => {
            const baseIndex = index * columns.length;

            // Obtenemos un array de índices: ['$1, $2, ...', '$7, $8, ...']
            const rowPlaceholders = columns.map((_, colIndex) => `$${baseIndex + colIndex + 1}`).join(', ');

            const finalPayload = entry.payload || entry.doc || {};

            values.push(
                entry.entityName,
                entry.operation,
                entry.status || OutboxStatus.PENDING,
                entry.sheetName,
                typeof finalPayload === 'object' ? JSON.stringify(finalPayload) : finalPayload,
                entry.attempts || 0
            );

            return `(${rowPlaceholders})`;
        }).join(', ');

        const queryText = `INSERT INTO outbox_entries (${columns.join(', ')}) VALUES ${placeholders}`;

        const client = await this.pg.getClient();
        try {
            await client.query('BEGIN');
            await client.query(queryText, values);
            await client.query('COMMIT');
        } catch (error: any) {
            await client.query('ROLLBACK');
            this.logger.error(`❌ Error en saveTransaction: ${error.message}`);
            throw error;
        } finally {
            client.release();
        }
    }
    async enqueue(entry: CreateOutboxEntryDto): Promise<void> {
        // Los campos 'id' (BIGSERIAL), 'started_at', 'finished_at' y 'error' 
        // se omiten intencionalmente porque son automáticos o nulos al inicio.
        const query = `
    INSERT INTO outbox_entries (
      entity_name, 
      operation, 
      status, 
      sheet_name, 
      payload, 
      attempts, 
      created_at, 
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `;

        // Preparamos los valores asegurando los defaults explícitos
        const values = [
            entry.entityName,
            entry.operation,
            'PENDING',           // status
            entry.sheetName,
            JSON.stringify(entry.payload),
            0,                   // attempts iniciales
            new Date(),          // created_at
            new Date()           // updated_at
        ];

        try {
            await this.pg.query(query, values);
        } catch (error: any) {
            throw new Error(`❌ Fallo crítico al encolar en Outbox: ${error.message}`);
        }
    }
}