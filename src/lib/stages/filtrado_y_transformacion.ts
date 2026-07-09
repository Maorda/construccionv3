import { Injectable, Logger } from "@nestjs/common";
import { IQueryStage } from "./interfaces/query-stage.interface";
import { StageUtils } from "./StageUtils";
import { ExpressionEngine } from "./expression.engine";
import { ROW_INDEX_SYMBOL } from "../shared/constants/constants";

@Injectable()
export class MatchStage implements IQueryStage {
    public readonly operator = '$match';
    private readonly logger = new Logger(MatchStage.name);

    constructor(private readonly engine: ExpressionEngine) { }

    /**
     * Ejecuta el filtrado en memoria de manera inmutable y tolerante a fallos de celdas.
     * @param data Array de registros (filas de Sheets hidratadas con símbolos de metadatos)
     * @param config Objeto de configuración del operador $match
     */
    async execute<T extends Record<string | symbol, any>>(data: T[], config: Record<string, any>): Promise<T[]> {
        // 🚀 1. EARLY EXIT: Si no hay datos, retornamos inmediatamente (0 ms CPU cost)
        if (!Array.isArray(data) || data.length === 0) {
            this.logger.verbose(`[${this.operator}] Array de entrada vacío. Omitiendo evaluación de etapa.`);
            return [];
        }

        // 🚀 2. EARLY EXIT: Si el filtro es un objeto vacío ({}), todo coincide. Retorno inmutable directo O(1).
        if (!config || Object.keys(config).length === 0) {
            this.logger.verbose(`[${this.operator}] Filtro vacío detectado. Retornando los ${data.length} registros sin filtrar.`);
            return data;
        }

        const matchedRecords: T[] = [];
        let errorCount = 0;

        // 🔍 3. ITERACIÓN SEGURA: Evaluamos fila por fila sin arriesgar la estabilidad del hilo de Node.js
        for (let i = 0; i < data.length; i++) {
            const row = data[i];

            // Guardrail por si Sheets entregó una fila corrupta o vacía
            if (!row || typeof row !== 'object') {
                this.logger.warn(`[${this.operator}] Registro en índice de memoria [${i}] ignorado (no es un objeto evaluable).`);
                continue;
            }

            try {
                // Delegamos la evaluación lógica, matemática y de fechas al ExpressionEngine
                const isMatch = this.engine.evaluateFilter(row, config);

                if (isMatch) {
                    // Preservamos el puntero en memoria exacto del registro (incluyendo sus Symbols ocultos como ROW_INDEX_SYMBOL)
                    matchedRecords.push(row);
                }
            } catch (error: any) {
                errorCount++;
                // 🛡️ EXTRACCIÓN DEL SÍMBOLO OFICIAL: Leemos el número de fila físico desde tu ROW_INDEX_SYMBOL
                const sheetRowNumber = row[ROW_INDEX_SYMBOL] !== undefined ? `Fila Sheets: ${String(row[ROW_INDEX_SYMBOL])}` : `Índice Memoria: ${i}`;

                // Aislamiento de anomalías: Logueamos el fallo exacto en la celda/fórmula pero continuamos con los demás registros
                this.logger.error(
                    `[${this.operator}] ❌ Error evaluando criterio contra registro [${sheetRowNumber}]. Razón: ${error.message}`,
                    error.stack
                );
            }
        }

        // 📊 4. TELEMETRÍA DE PRODUCCIÓN: Informes claros en consola
        if (errorCount > 0) {
            this.logger.warn(`[${this.operator}] ⚠️ Se omitieron ${errorCount} fila(s) del resultado debido a errores de sintaxis en sus celdas.`);
        }

        this.logger.verbose(
            `[${this.operator}] Etapa completada con éxito: ${matchedRecords.length} de ${data.length} registros cumplieron el filtro.`
        );

        return matchedRecords;
    }

    /**
     * Valida el contrato del operador antes de iniciar el procesamiento del pipeline.
     */
    validate(config: any): void {
        StageUtils.validateObject(config, this.operator);
    }
}

@Injectable()
export class ProjectStage implements IQueryStage {
    public readonly operator = '$project';
    constructor(private readonly engine: ExpressionEngine) { }

    async execute(data: any[], config: any): Promise<any[]> {
        return data.map(item => {
            console.log('[DEBUG] Engine Config:', config);
            // Delegamos la ejecución del objeto completo al engine
            const projected = this.engine.execute(item, config) || {};

            // Preservamos el símbolo de índice de fila si existe
            if (item && item[ROW_INDEX_SYMBOL] !== undefined) {
                projected[ROW_INDEX_SYMBOL] = item[ROW_INDEX_SYMBOL];
            }

            return projected;
        });
    }

    validate(config: any): void {
        StageUtils.validateObject(config, '$project');
    }
}
@Injectable()
export class AddFieldsStage implements IQueryStage {
    public readonly operator = '$addFields';
    private readonly logger = new Logger(AddFieldsStage.name);

    constructor(private readonly engine: ExpressionEngine) { }

    async execute(data: any[], config: Record<string, any>): Promise<any[]> {
        if (!config || Object.keys(config).length === 0) return data;

        try {
            return data.map(item => {
                // El motor procesa el objeto y devuelve los nuevos campos resueltos
                const newFields = this.engine.execute(item, config);

                return {
                    ...item,
                    ...newFields
                };
            });
        } catch (error) {
            this.logger.error(`[AddFieldsStage] Error evaluando configuración: ${JSON.stringify(config)}`, error);
            return data;
        }
    }

    validate(config: any): void {
        StageUtils.validateObject(config, '$addFields');
        if (Object.keys(config).length === 0) {
            throw new Error("[$addFields] requiere un objeto de configuración con al menos un campo.");
        }
    }
}