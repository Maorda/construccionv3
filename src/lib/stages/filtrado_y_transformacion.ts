import { Injectable, Logger } from "@nestjs/common";
import { IQueryStage } from "./interfaces/query-stage.interface";
import { StageUtils } from "./StageUtils";
import { ExpressionEngine } from "./expression.engine";
import { ROW_INDEX_SYMBOL } from "../shared/constants/constants";

@Injectable()
export class MatchStage implements IQueryStage {
    public readonly operator = '$match';
    private readonly logger = new Logger(MatchStage.name);



    async execute(data: any[], config: any): Promise<any[]> {
        return data.filter((row) => {
            return Object.entries(config).every(([key, expectedValue]) => {
                // Validación de igualdad simple en memoria
                return row[key] === expectedValue;
            });
        });
    }

    validate(config: any): void {
        if (!config || typeof config !== 'object') {
            throw new Error("La configuración del operador '$match' debe ser un objeto de criterios válido.");
        }
    }
}

@Injectable()
export class ProjectStage implements IQueryStage {
    public readonly operator = '$project';
    constructor(private readonly engine: ExpressionEngine) { }

    async execute(data: any[], config: any): Promise<any[]> {
        return data.map(item => {
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