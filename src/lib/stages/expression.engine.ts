import { Inject, Injectable, Logger } from "@nestjs/common";
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import weekOfYear from 'dayjs/plugin/weekOfYear.js';
import { IExpressionOperator } from "./IExpressionOperator.js";
import { DATA_TRANSFORM_OPERATOR, FILTER_OPERATOR } from "./pipeline.constants";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);
dayjs.extend(weekOfYear);

@Injectable()
export class ExpressionEngine {
    private readonly logger = new Logger(ExpressionEngine.name);
    private readonly transformRegistry: Map<string, IExpressionOperator> = new Map();
    private readonly filterRegistry: Map<string, IExpressionOperator> = new Map();

    constructor(
        @Inject(DATA_TRANSFORM_OPERATOR) private readonly transforms: IExpressionOperator[],
        @Inject(FILTER_OPERATOR) private readonly filters: IExpressionOperator[]
    ) {
        console.log('TRANSFORMS:', this.transforms)
        this.transforms.forEach(op => this.transformRegistry.set(op.name, op));
        this.filters.forEach(op => this.filterRegistry.set(op.name, op));
    }

    public execute(record: any, projection: any): any {
        if (!projection || typeof projection !== 'object') return projection;
        if (!record) return {};
        if (Array.isArray(projection)) return projection.map(item => this.execute(record, item));

        const result: any = {};
        for (const key in projection) {
            if (!projection.hasOwnProperty(key)) continue;

            const expression = projection[key];
            if (this.isOperatorObject(expression)) {
                const operatorKey = Object.keys(expression)[0];
                result[key] = this.runOperator(operatorKey, expression[operatorKey], record);
            } else {
                result[key] = this.evaluate(expression, record);
            }
        }
        return result;
    }

    public evaluate(expression: any, record: any): any {
        // 🟢 CORRECCIÓN AL BUG CRÍTICO: Soporte nativo para paths anidados ($user.profile.name)
        if (typeof expression === 'string' && expression.startsWith('$')) {
            const fieldPath = expression.substring(1);
            const rawData = this.extractRawData(record);
            const value = this.getNestedValue(rawData, fieldPath);
            return value !== undefined ? value : null;
        }

        if (expression && typeof expression === 'object' && !Array.isArray(expression)) {
            const operator = Object.keys(expression).find(key => key.startsWith('$'));
            if (operator) {
                return this.runOperator(operator, expression[operator], record);
            }
            const resolvedObj: any = {};
            for (const k in expression) {
                if (expression.hasOwnProperty(k)) {
                    resolvedObj[k] = this.evaluate(expression[k], record);
                }
            }
            return resolvedObj;
        }

        return expression;
    }

    public evaluateFilter(record: any, filter: Record<string, any>): boolean {
        const rawData = this.extractRawData(record);
        if (!filter || typeof filter !== 'object') return true;

        return Object.entries(filter).every(([key, condition]) => {
            if (key === '$and') return (condition as any[]).every(f => this.evaluateFilter(rawData, f));
            if (key === '$or') return (condition as any[]).some(f => this.evaluateFilter(rawData, f));
            if (key === '$nor') return !(condition as any[]).some(f => this.evaluateFilter(rawData, f));
            if (key === '$not') return !this.evaluateFilter(rawData, condition);

            const value = this.getNestedValue(rawData, key);
            return this.compareValue(value, condition, record); // Pasamos el record real para contextualizar
        });
    }

    private runOperator(op: string, config: any, record: any): any {
        const handler = this.transformRegistry.get(op) || this.filterRegistry.get(op);
        if (!handler) {
            this.logger.warn(`Operador no soportado o no registrado: ${op}`);
            return null;
        }

        // 🟢 SOLID (OCP): El esquema ahora se lee dinámicamente desde el propio operador inyectado
        const args = this.normalizeArgs(config, handler.schema);

        try {
            return handler.exec(args, record, this);
        } catch (error: any) {
            this.logger.error(`Error ejecutando operador ${op}: ${error.message}`);
            return null;
        }
    }

    private normalizeArgs(config: any, schema?: string[]): Record<string, any> {
        // 1. Si ya es un objeto estructurado, se retorna tal cual
        if (config && typeof config === 'object' && !Array.isArray(config)) {
            return config;
        }

        // 2. Si es un array y el operador provee un esquema posicional
        if (Array.isArray(config) && schema) {
            return schema.reduce((acc, key, index) => {
                acc[key] = config[index];
                return acc;
            }, {} as Record<string, any>);
        }

        // 3. Si es un valor simple/primitivo
        const defaultKey = schema ? schema[0] : 'val';
        return { [defaultKey]: config };
    }

    private compareValue(fieldValue: any, condition: any, record: any): boolean {
        if (condition === null || typeof condition !== 'object' || condition instanceof Date) {
            return fieldValue === condition;
        }

        return Object.entries(condition).every(([operator, targetValue]) => {
            if (operator === '$options') return true;
            if (!operator.startsWith('$')) return fieldValue === targetValue;

            const args = {
                val1: fieldValue,
                val2: targetValue,
                val: fieldValue,
                pattern: targetValue,
                options: condition['$options'] || 'i'
            };

            // 🟢 ROBUSTEZ: Pasamos el 'record' en lugar de un objeto vacío {} por si el operador requiere contexto
            return !!this.runOperator(operator, args, record);
        });
    }

    public getNestedValue(obj: any, path: string): any {
        if (!obj || !path) return undefined;
        // Optimizamos el split reduce para evitar roturas si intercepta primitivos en el camino
        return path.split('.').reduce((acc, part) => {
            return (acc && typeof acc === 'object' && acc[part] !== undefined) ? acc[part] : undefined;
        }, obj);
    }

    public extractRawData(item: any): any {
        return item?.data ?? item?._snapshot ?? item;
    }

    public safeDayjs(val: any): dayjs.Dayjs | null {
        if (val === undefined || val === null || String(val).trim() === '') return null;
        const d = dayjs(val);
        return d.isValid() ? d : null;
    }

    private isOperatorObject(obj: any): boolean {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
        const keys = Object.keys(obj);
        return keys.length === 1 && keys[0].startsWith('$');
    }
}