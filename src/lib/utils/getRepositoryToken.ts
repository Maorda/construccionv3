import { ClassType } from "../core/types/common.types";

export const getRepositoryToken = (entity: ClassType) => `${entity.name}Repository`;
export function deepClone<T>(obj: T): T {
    if (obj === null || obj === undefined) return obj;
    if (obj instanceof Date) return new Date(obj.getTime()) as unknown as T;
    if (Array.isArray(obj)) {
        return obj.map(item => deepClone(item)) as unknown as T;
    }
    if (typeof obj === 'object') {
        const cloned: any = {};
        // Object.keys ignora los Symbols, por lo que ROW_INDEX_SYMBOL NO se clonará al snapshot
        for (const key of Object.keys(obj)) {
            cloned[key] = deepClone((obj as any)[key]);
        }
        return cloned;
    }
    return obj;
}