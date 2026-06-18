import 'reflect-metadata';
import { SHEETS_PRIMARY_KEY } from '../../shared/constants/constants';
export function PrimaryKey(): PropertyDecorator {
    return (target: object, propertyKey: string | symbol) => {
        Reflect.defineMetadata(SHEETS_PRIMARY_KEY, propertyKey.toString(), target.constructor);
    };
}