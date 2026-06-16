import { Injectable } from "@nestjs/common";
import { IQueryStage } from "./interfaces/query-stage.interface";
import { StageUtils } from "./StageUtils";


@Injectable()
export class SortStage implements IQueryStage {
    public readonly operator = '$sort';
    public async execute(data: any[], config: Record<string, 1 | -1>): Promise<any[]> {
        if (!config || Object.keys(config).length === 0) return data;

        return [...data].sort((a, b) => {
            for (const key of Object.keys(config)) {
                const direction = config[key];
                const valA = a[key];
                const valB = b[key];

                if (valA === valB) continue;

                if (valA === undefined || valA === null || valA === '') return 1;
                if (valB === undefined || valB === null || valB === '') return -1;

                if (valA instanceof Date && valB instanceof Date) {
                    return direction === 1
                        ? valA.getTime() - valB.getTime()
                        : valB.getTime() - valA.getTime();
                }

                if (valA > valB) return direction === 1 ? 1 : -1;
                if (valA < valB) return direction === 1 ? -1 : 1;
            }
            return 0;
        });
    }

    public validate(config: any): void {
        StageUtils.validateObject(config, '$sort');
        for (const key of Object.keys(config)) {
            if (config[key] !== 1 && config[key] !== -1) {
                throw new Error(`[$sort] El valor para ordenar "${key}" debe ser estrictamente 1 (asc) o -1 (desc).`);
            }
        }
    }
}
@Injectable()
export class LimitStage implements IQueryStage {
    public readonly operator = '$limit';
    public async execute(data: any[], config: number): Promise<any[]> {
        const limitAmount = Number(config);
        if (isNaN(limitAmount) || limitAmount <= 0) return [];
        return data.slice(0, limitAmount);
    }

    public validate(config: any): void {
        if (typeof config !== 'number' || config <= 0) {
            throw new Error('[$limit] El valor debe ser un número entero mayor a cero.');
        }
    }
}

@Injectable()
export class SkipStage implements IQueryStage {
    public readonly operator = '$skip';
    public async execute(data: any[], config: number): Promise<any[]> {
        const skipAmount = Number(config);
        if (isNaN(skipAmount) || skipAmount <= 0) return data;
        return data.slice(skipAmount);
    }

    public validate(config: any): void {
        if (typeof config !== 'number' || config < 0) {
            throw new Error('[$skip] El valor debe ser un número entero positivo o cero.');
        }
    }
}