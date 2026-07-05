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