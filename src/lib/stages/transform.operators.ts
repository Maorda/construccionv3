import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import { IExpressionOperator } from './IExpressionOperator';

// =========================================================================
// 1. OPERADORES LÓGICOS Y DE FLUJO
// =========================================================================

@Injectable()
export class IfOperator implements IExpressionOperator {
    readonly name = '$if';
    readonly schema = ['if', 'then', 'else'];

    exec(args: any, record: any, engine: any): any {
        const condition = engine.evaluate(args.if, record);
        return condition ? engine.evaluate(args.then, record) : engine.evaluate(args.else, record);
    }
}

// =========================================================================
// 2. OPERADORES MATEMÁTICOS Y ARITMÉTICOS
// =========================================================================

@Injectable()
export class MultiplyOperator implements IExpressionOperator {
    readonly name = '$multiply';
    // No declaramos schema estricto porque acepta un array variádico de factores

    exec(args: any, record: any, engine: any): number {
        // Soporta { values: [...] } o simplemente un array directo que cae en args.val
        const input = args.values !== undefined ? args.values : args.val;
        const values = Array.isArray(input) ? input : [input];

        if (values.length === 0) return 0;

        return values.reduce((acc, curr) => {
            const evaluated = engine.evaluate(curr, record);
            const num = typeof evaluated === 'string' ? parseFloat(evaluated.replace(/[^\d.-]/g, '')) : Number(evaluated);
            return acc * (isNaN(num) ? 0 : num);
        }, 1);
    }
}

@Injectable()
export class IncOperator implements IExpressionOperator {
    readonly name = '$inc';
    readonly schema = ['current', 'val'];

    exec(args: any, record: any, engine: any): number {
        const current = Number(engine.evaluate(args.current, record) || 0);
        const val = Number(engine.evaluate(args.val, record) || 0);
        return (isNaN(current) ? 0 : current) + (isNaN(val) ? 0 : val);
    }
}

@Injectable()
export class MinMaxOperator implements IExpressionOperator {
    readonly name = '$minMax';
    readonly schema = ['current', 'target', 'type'];

    exec(args: any, record: any, engine: any): number {
        const currentVal = engine.evaluate(args.current, record);
        const target = Number(engine.evaluate(args.target ?? 0, record));
        const type = args.type || 'sum';

        if (currentVal === undefined || currentVal === null || String(currentVal).trim() === '' || isNaN(Number(currentVal))) {
            return isNaN(target) ? 0 : target;
        }

        const current = Number(currentVal);
        return type === 'min' ? Math.min(current, target) : Math.max(current, target);
    }
}

@Injectable()
export class RoundOperator implements IExpressionOperator {
    readonly name = '$round';
    readonly schema = ['value', 'decimals'];

    exec(args: any, record: any, engine: any): number {
        const rawValue = engine.evaluate(args.value, record);
        // Limpieza de strings numéricos con formato de moneda común en hojas de cálculo
        const val = typeof rawValue === 'string' ? parseFloat(rawValue.replace(/[^\d.-]/g, '')) : parseFloat(rawValue);
        const decimals = Number(engine.evaluate(args.decimals ?? 2, record));

        if (isNaN(val) || isNaN(decimals)) return 0;

        const factor = Math.pow(10, Math.max(0, decimals));
        return Math.round(val * factor) / factor;
    }
}

@Injectable()
export class MathOperator implements IExpressionOperator {
    readonly name = '$math';
    readonly schema = ['expression'];

    exec(args: any, record: any, engine: any): number {
        const expression = engine.evaluate(args.expression, record);
        if (!expression || typeof expression !== 'string') return 0;

        try {
            const rawData = engine.extractRawData(record);
            // 🟢 SOLUCIÓN AL BUG CRÍTICO ANTERIOR: 
            // Ahora soporta paths anidados complejos con puntos dentro de $math (ej: "$profile.salary * 1.10")
            const resolved = expression.replace(/\$([a-zA-Z0-9_.]+)/g, (_, fieldPath) => {
                const value = engine.getNestedValue(rawData, fieldPath);
                const num = typeof value === 'string' ? parseFloat(value.replace(/[^\d.-]/g, '')) : Number(value);
                return `(${isNaN(num) ? 0 : num})`;
            });

            // Sandbox de ejecución ultra-restringido
            return Function(`"use strict"; return (${resolved.replace(/[^0-9+\-*/().\s,Mathabsroundceilfloor-]/g, '')})`)();
        } catch {
            return 0;
        }
    }
}

// =========================================================================
// 3. OPERADORES DE TEXTO (STRINGS)
// =========================================================================

@Injectable()
export class UpperOperator implements IExpressionOperator {
    readonly name = '$upper';
    readonly schema = ['val'];

    exec(args: any, record: any, engine: any): string {
        const value = engine.evaluate(args.val, record);
        return value !== null && value !== undefined ? String(value).toUpperCase() : '';
    }
}

@Injectable()
export class TrimOperator implements IExpressionOperator {
    readonly name = '$trim';
    readonly schema = ['val'];

    exec(args: any, record: any, engine: any): string {
        const value = engine.evaluate(args.val, record);
        return value !== null && value !== undefined ? String(value).trim() : '';
    }
}

@Injectable()
export class ConcatOperator implements IExpressionOperator {
    readonly name = '$concat';
    // Variádico híbrido: soporta { parts: [...] } o un array directo de elementos

    exec(args: any, record: any, engine: any): string {
        const input = args.parts !== undefined ? args.parts : args.val;
        const parts = Array.isArray(input) ? input : [input];
        return parts.map(p => String(engine.evaluate(p, record) ?? '')).join('');
    }
}

// =========================================================================
// 4. OPERADORES DE TIEMPO (FECHAS)
// =========================================================================

@Injectable()
export class DateAddOperator implements IExpressionOperator {
    readonly name = '$dateAdd';
    readonly schema = ['startDate', 'amount', 'unit'];

    exec(args: any, record: any, engine: any): string {
        const startDate = engine.evaluate(args.startDate, record);
        const amount = Number(engine.evaluate(args.amount, record) || 0);
        const unit = String(engine.evaluate(args.unit, record) || args.unit || 'day');

        const d = engine.safeDayjs(startDate);
        return d ? d.add(amount, unit as any).format('YYYY-MM-DD HH:mm:ss') : '';
    }
}

@Injectable()
export class TimeDiffOperator implements IExpressionOperator {
    readonly name = '$timeDiff';
    readonly schema = ['start', 'end', 'unit'];

    exec(args: any, record: any, engine: any): number {
        const startVal = engine.evaluate(args.start, record);
        const endVal = engine.evaluate(args.end, record);
        const unit = String(engine.evaluate(args.unit, record) || args.unit || 'hour');

        const start = dayjs(startVal);
        const end = dayjs(endVal);

        if (!start.isValid() || !end.isValid()) return 0;

        // Retorna diferencia precisa redondeada a 2 decimales
        const diff = end.diff(start, unit as any, true);
        return Math.round(diff * 100) / 100;
    }
}

// =========================================================================
// 5. OPERADORES DE AGREGACIÓN DE ARRAYS INTERNOS
// =========================================================================

@Injectable()
export class AggregateOperator implements IExpressionOperator {
    readonly name = '$aggregate';
    readonly schema = ['values', 'type'];

    exec(args: any, record: any, engine: any): number {
        const inputValues = args.values !== undefined ? args.values : args.val;
        const rawValues = Array.isArray(inputValues) ? inputValues : [inputValues];
        const type = engine.evaluate(args.type, record) || args.type || 'sum';

        // Evalúa recursivamente cada elemento y limpia formatos de monedas/locales
        const nums = rawValues
            .map(v => {
                const evaluated = engine.evaluate(v, record);
                if (typeof evaluated === 'string') {
                    // Limpia caracteres como S/. o $, espacios, puntos de miles
                    const cleaned = evaluated.replace(/[S\/\.\$\s,]/g, '');
                    return parseFloat(cleaned);
                }
                return Number(evaluated);
            })
            .filter(n => !isNaN(n));

        if (nums.length === 0) return 0;

        const sum = nums.reduce((a, b) => a + b, 0);

        switch (type) {
            case 'sum': return sum;
            case 'avg': return sum / nums.length;
            case 'count': return nums.length;
            case 'min': return Math.min(...nums);
            case 'max': return Math.max(...nums);
            default: return sum;
        }
    }
}