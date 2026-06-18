// sheet-data.gateway.ts
import { Injectable, Logger, Inject } from '@nestjs/common';
import { GoogleSheetProvider } from '../../adapters/google-sheet.provider';
import { MetadataRegistry } from '../../core/metadata/metadata.registry';
import { ClassType } from '../../core/types/common.types';
import { SHEET_ODM_OPTIONS } from '../../shared/constants/constants';
import { SheetOdmModuleOptions } from '../../interfaces/sheet-odm-options.interface';

// 💡 Sugerencia: Define esta interfaz en tus tipos para segregar las escrituras
export interface ISheetWriteDriver {
    createSheet(title: string): Promise<any>;
    writeHeaders(sheetName: string, headers: string[]): Promise<void>;
    appendRow(sheetName: string, row: any[]): Promise<number>;
    appendRows(sheetName: string, rows: any[][]): Promise<number[]>;
    updateRow(sheetName: string, rowNumber: number, values: any[]): Promise<number>;
    clearRow(sheetName: string, rowNumber: number): Promise<void>;
    batchUpdateValues(data: { range: string; values: any[][] }[]): Promise<void>;
    batchClearValues(ranges: string[]): Promise<void>;
    getExistingSheetTitles(): Promise<string[]>;
    getRange(range: string): Promise<any[][]>;
    getRowData(sheetName: string, rowNumber: number): Promise<any[]>;
    getBoundaries(sheetName: string): Promise<{ lastRow: number; lastColumn: number }>;
}

@Injectable()
export class SheetDataGateway implements ISheetWriteDriver {
    private readonly logger = new Logger(SheetDataGateway.name);
    private readonly spreadsheetId: string; // La definimos como propiedad de clase

    constructor(
        private readonly auth: GoogleSheetProvider,
        @Inject(SHEET_ODM_OPTIONS) private readonly options: SheetOdmModuleOptions,
        private readonly metadataRegistry: MetadataRegistry,
    ) {
        if (!this.options.spreadsheetId) {
            throw new Error('SheetOdmModule requiere un [spreadsheetId] válido en sus opciones.');
        }
        this.spreadsheetId = this.options.spreadsheetId; // ✅ TypeScript ya sabe que es 100% string


    }

    async createSheet(title: string): Promise<any> {
        return await this.auth.sheets.spreadsheets.batchUpdate({
            spreadsheetId: this.spreadsheetId,
            requestBody: { requests: [{ addSheet: { properties: { title } } }] }
        });
    }

    async writeHeaders(sheetName: string, headers: string[]): Promise<void> {
        await this.auth.sheets.spreadsheets.values.update({
            spreadsheetId: this.spreadsheetId,
            range: `${sheetName}!A1`,
            valueInputOption: 'RAW',
            requestBody: { values: [headers] }
        });
    }

    async appendRow(sheetName: string, row: any[]): Promise<number> {
        try {
            const response = await this.auth.sheets.spreadsheets.values.append({
                spreadsheetId: this.spreadsheetId,
                range: `${sheetName}!A:A`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [row] },
            });

            const updatedRange = response.data?.updates?.updatedRange;

            if (updatedRange) {
                const match = updatedRange.match(/\d+$/);
                if (match) {
                    return parseInt(match[0], 10);
                }
            }
            throw new Error(`No se pudo determinar la fila física insertada en ${sheetName}`);
        } catch (error: any) {
            this.logger.error(`Error en appendRow para ${sheetName}: ${error.message}`);
            throw error;
        }
    }

    async appendRows(sheetName: string, rows: any[][]): Promise<number[]> {
        if (!rows || rows.length === 0) return [];
        try {
            const response = await this.auth.sheets.spreadsheets.values.append({
                spreadsheetId: this.spreadsheetId,
                range: `${sheetName}!A:A`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: rows },
            });

            const updatedRange = response.data?.updates?.updatedRange;

            if (updatedRange) {
                const parts = updatedRange.split('!');
                const rangePart = parts[1] || parts[0];
                const matches = rangePart.match(/\d+/g);

                if (matches) {
                    const startRow = parseInt(matches[0], 10);
                    const endRow = matches[1] ? parseInt(matches[1], 10) : startRow;

                    const indices: number[] = [];
                    for (let i = startRow; i <= endRow; i++) {
                        indices.push(i);
                    }
                    return indices;
                }
            }
            throw new Error(`No se pudo determinar el rango físico insertado en ${sheetName}`);
        } catch (error: any) {
            this.logger.error(`❌ Error en appendRows para ${sheetName}: ${error.message}`);
            throw error;
        }
    }

    async getExistingSheetTitles(): Promise<string[]> {
        const res = await this.auth.sheets.spreadsheets.get({ spreadsheetId: this.spreadsheetId });
        return res.data.sheets?.map(s => s.properties?.title || '') || [];
    }

    async getRange(range: string): Promise<any[][]> {
        const res = await this.auth.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: range,
            valueInputOption: 'RAW',
        });
        return res.data.values || [];
    }

    async updateRow(sheetName: string, rowNumber: number, values: any[]): Promise<number> {
        try {
            await this.auth.sheets.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range: `${sheetName}!A${rowNumber}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [values] },
            });
            return rowNumber;
        } catch (error: any) {
            this.logger.error(`Error en updateRow en ${sheetName} (Fila ${rowNumber}): ${error.message}`);
            throw error;
        }
    }

    async clearRow(sheetName: string, rowNumber: number): Promise<void> {
        try {
            await this.auth.sheets.spreadsheets.values.clear({
                spreadsheetId: this.spreadsheetId,
                range: `${sheetName}!${rowNumber}:${rowNumber}`,
            });
        } catch (error: any) {
            this.logger.error(`Error en clearRow para ${sheetName} en fila ${rowNumber}: ${error.message}`);
            throw error;
        }
    }

    async getRowData(sheetName: string, rowNumber: number): Promise<any[]> {
        const range = `${sheetName}!${rowNumber}:${rowNumber}`;
        const values = await this.getRange(range);
        return values[0] || [];
    }

    getDocId<T extends object>(entityClass: ClassType<T>, rowData: any[]): any {
        const pkField = this.metadataRegistry.getPrimaryKeyField(entityClass);
        const columnMap = this.metadataRegistry.getColumnMap(entityClass);
        const index = columnMap[pkField];
        return rowData[index];
    }

    async batchUpdateValues(data: { range: string; values: any[][] }[]): Promise<void> {
        try {
            if (data.length === 0) return;

            await this.auth.sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: this.spreadsheetId,
                requestBody: {
                    valueInputOption: 'USER_ENTERED',
                    data: data.map(item => ({
                        range: item.range,
                        values: item.values
                    }))
                }
            });
            this.logger.log(`[Gateway] ⚡ Batch Update completado con éxito. Rupturas de cuota evitadas.`);
        } catch (error: any) {
            this.logger.error(`Error en batchUpdateValues: ${error.message}`);
            throw error;
        }
    }

    async batchClearValues(ranges: string[]): Promise<void> {
        try {
            if (ranges.length === 0) return;

            await this.auth.sheets.spreadsheets.values.batchClear({
                spreadsheetId: this.spreadsheetId,
                requestBody: { ranges }
            });
            this.logger.log(`[Gateway] 🧼 Batch Clear ejecutado para ${ranges.length} rangos.`);
        } catch (error: any) {
            this.logger.error(`Error en batchClearValues: ${error.message}`);
            throw error;
        }
    }
    async getBoundaries(sheetName: string): Promise<{ lastRow: number; lastColumn: number }> {
        try {
            // Al omitir el rango (ej. '!A1:Z') y enviar solo el nombre,
            // la API recorta el viewport a los datos útiles.
            const res = await this.auth.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: sheetName,
                valueInputOption: 'RAW',
            });

            const values = res.data.values;

            // Si la hoja está completamente vacía
            if (!values || values.length === 0) {
                return { lastRow: 0, lastColumn: 0 };
            }

            const lastRow = values.length;
            // Para la columna, buscamos la fila más ancha de toda la matriz
            const lastColumn = Math.max(...values.map(row => row.length));

            this.logger.debug(`[Boundaries] ${sheetName} -> Fila: ${lastRow}, Columna: ${lastColumn}`);
            return { lastRow, lastColumn };
        } catch (error: any) {
            this.logger.error(`Error obteniendo límites de ${sheetName}: ${error.message}`);
            throw error;
        }
    }
}