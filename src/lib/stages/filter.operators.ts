import { Injectable } from '@nestjs/common';
import { IExpressionOperator } from './interfaces/query-stage.interface';

@Injectable()
export class EqOperator implements IExpressionOperator {
    readonly name = '$eq';
    readonly schema = ['val1', 'val2'];

    exec(args: any, record: any, engine: any): boolean {
        return engine.evaluate(args.val1, record) === engine.evaluate(args.val2, record);
    }
}

@Injectable()
export class NeOperator implements IExpressionOperator {
    readonly name = '$ne';
    readonly schema = ['val1', 'val2'];

    exec(args: any, record: any, engine: any): boolean {
        return engine.evaluate(args.val1, record) !== engine.evaluate(args.val2, record);
    }
}

@Injectable()
export class GtOperator implements IExpressionOperator {
    readonly name = '$gt';
    readonly schema = ['val1', 'val2'];



    exec(args: any, record: any, engine: any): boolean {
        const v1 = Number(engine.evaluate(args.val1, record));
        const v2 = Number(engine.evaluate(args.val2, record));
        console.log(`[DEBUG Gt] Comparando: ${v1} > ${v2}`);
        return !isNaN(v1) && !isNaN(v2) ? v1 > v2 : false;
    }
}

@Injectable()
export class GteOperator implements IExpressionOperator {
    readonly name = '$gte';
    readonly schema = ['val1', 'val2'];

    exec(args: any, record: any, engine: any): boolean {
        const v1 = Number(engine.evaluate(args.val1, record));
        const v2 = Number(engine.evaluate(args.val2, record));
        return !isNaN(v1) && !isNaN(v2) ? v1 >= v2 : false;
    }
}

@Injectable()
export class LtOperator implements IExpressionOperator {
    readonly name = '$lt';
    readonly schema = ['val1', 'val2'];

    exec(args: any, record: any, engine: any): boolean {
        const v1 = Number(engine.evaluate(args.val1, record));
        const v2 = Number(engine.evaluate(args.val2, record));
        return !isNaN(v1) && !isNaN(v2) ? v1 < v2 : false;
    }
}

@Injectable()
export class LteOperator implements IExpressionOperator {
    readonly name = '$lte';
    readonly schema = ['val1', 'val2'];

    exec(args: any, record: any, engine: any): boolean {
        const v1 = Number(engine.evaluate(args.val1, record));
        const v2 = Number(engine.evaluate(args.val2, record));
        return !isNaN(v1) && !isNaN(v2) ? v1 <= v2 : false;
    }
}

@Injectable()
export class InOperator implements IExpressionOperator {
    readonly name = '$in';
    readonly schema = ['val1', 'val2'];

    exec(args: any, record: any, engine: any): boolean {
        const val = engine.evaluate(args.val1, record);
        const arr = engine.evaluate(args.val2, record);

        if (!Array.isArray(arr)) return false;

        const normalizedVal = String(val ?? '').trim();
        return arr.some(item => String(engine.evaluate(item, record) ?? '').trim() === normalizedVal);
    }
}

@Injectable()
export class NinOperator implements IExpressionOperator {
    readonly name = '$nin';
    readonly schema = ['val1', 'val2'];

    exec(args: any, record: any, engine: any): boolean {
        const inOp = new InOperator();
        return !inOp.exec(args, record, engine);
    }
}

@Injectable()
export class ExistsOperator implements IExpressionOperator {
    readonly name = '$exists';
    readonly schema = ['val'];

    exec(args: any, record: any, engine: any): boolean {
        const val = engine.evaluate(args.val, record);
        return val !== undefined && val !== null && String(val).trim() !== '';
    }
}

@Injectable()
export class RegexOperator implements IExpressionOperator {
    readonly name = '$regex';
    readonly schema = ['val', 'pattern', 'options'];

    exec(args: any, record: any, engine: any): boolean {
        const val = String(engine.evaluate(args.val, record) || '');
        const pattern = engine.evaluate(args.pattern, record);
        const options = engine.evaluate(args.options, record) || args.options || 'i';

        if (!pattern) return false;
        try {
            return new RegExp(pattern, options).test(val);
        } catch {
            return false;
        }
    }
}

// =========================================================================
// 1. COMPARACIÓN POR MISMA SEMANA DEL AÑO ($sameWeek)
// =========================================================================
@Injectable()
export class SameWeekOperator implements IExpressionOperator {
    readonly name = '$sameWeek';
    readonly schema = ['val1', 'val2']; // val1 viene del campo, val2 del filtro

    exec(args: any, record: any, engine: any): boolean {
        const d1 = engine.safeDayjs(args.val1);
        const d2 = engine.safeDayjs(args.val2);
        if (!d1 || !d2) return false;

        // Compara que estén en el mismo año y en el mismo número de semana
        return d1.year() === d2.year() && d1.week() === d2.week();
    }
}

// =========================================================================
// 2. FILTRO POR DÍA DE LA SEMANA ($dayOfWeek)
// =========================================================================
// Ejemplo de uso en filtro: { fecha: { $dayOfWeek: 1 } } -> (1 = Lunes, 0 = Domingo)
@Injectable()
export class DayOfWeekOperator implements IExpressionOperator {
    readonly name = '$dayOfWeek';
    readonly schema = ['val1', 'val2'];

    exec(args: any, record: any, engine: any): boolean {
        const d = engine.safeDayjs(args.val1);
        if (!d) return false;

        const targetDay = Number(engine.evaluate(args.val2, record));
        return d.day() === targetDay;
    }
}

// =========================================================================
// 3. FILTRO POR AÑO Y SEMANA ESPECÍFICA ($yearWeek)
// =========================================================================
// Ejemplo: { fecha: { $yearWeek: "2026-W28" } } o { fecha: { $yearWeek: { year: 2026, week: 28 } } }
@Injectable()
export class YearWeekOperator implements IExpressionOperator {
    readonly name = '$yearWeek';
    readonly schema = ['val1', 'val2'];

    exec(args: any, record: any, engine: any): boolean {
        const d = engine.safeDayjs(args.val1);
        if (!d) return false;

        const target = args.val2;
        let targetYear: number, targetWeek: number;

        if (typeof target === 'string' && target.includes('-W')) {
            const [y, w] = target.split('-W');
            targetYear = Number(y);
            targetWeek = Number(w);
        } else if (typeof target === 'object') {
            targetYear = Number(target.year);
            targetWeek = Number(target.week);
        } else {
            return false;
        }

        return d.year() === targetYear && d.week() === targetWeek;
    }
}

// =========================================================================
// 4. RANGO DE FECHAS ($dateBetween)
// =========================================================================
// Ejemplo: { fecha: { $dateBetween: ["2026-07-01", "2026-07-31"] } }
@Injectable()
export class DateBetweenOperator implements IExpressionOperator {
    readonly name = '$dateBetween';
    readonly schema = ['val1', 'val2']; // val2 será el array [start, end]

    exec(args: any, record: any, engine: any): boolean {
        const d = engine.safeDayjs(args.val1);
        if (!d || !Array.isArray(args.val2) || args.val2.length !== 2) return false;

        const start = engine.safeDayjs(args.val2[0]);
        const end = engine.safeDayjs(args.val2[1]);

        if (!start || !end) return false;

        // Compara inclusivo (>= start && <= end)
        return (d.isSame(start, 'day') || d.isAfter(start, 'day')) &&
            (d.isSame(end, 'day') || d.isBefore(end, 'day'));
    }
}