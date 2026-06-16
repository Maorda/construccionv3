import { ClassType } from "../../core/types/common.types";
export interface IQueryStage {
    readonly operator: string; // ej: '$match', '$project', '$group'
    execute(data: any[], config: any): Promise<any[]> | any[];
    validate(config: any): void;
}
export interface IExpressionOperator {
    readonly name: string;
    readonly schema?: string[]; // 🟢 Permite tipar los argumentos por posición dinámicamente
    exec(args: any, record: any, engine: any): any;
}
export type PipelineStage =
    | { $match: Record<string, any> }
    | { $lookup: LookupConfig }
    | { $unwind: string | { path: string; preserveNullAndEmptyArrays?: boolean } }
    | { $project: Record<string, any> }
    | { $addFields: Record<string, any> }
    | { $group: GroupConfig }
    | { $sort: Record<string, 1 | -1> }
    | { $limit: number }
    | { $skip: number };

/**
 * Configuración para la etapa de agrupación.
 */
export interface GroupConfig {
    /** Campo por el cual agrupar. Debe empezar con "$" (ej: "$id_obra") o ser null para agrupar todo */
    _id: string | null;

    /** Campos acumuladores dinámicos */
    [key: string]: GroupAccumulator | string | null;
}
/**
 * Configuración para la etapa de cruce de hojas (Join).
 */
export interface LookupConfig {
    /** Nombre de la entidad/hoja destino (ej: 'Peon') */
    from: string;

    /** Campo en la entidad actual que sirve de llave (ej: 'especialistaId') */
    localField: string;

    /** Campo en la entidad destino que coincide con localField (ej: 'id') */
    foreignField: string;

    /** Nombre del nuevo campo donde se guardará el resultado (normalmente un arreglo) */
    as: string;
}

/**
 * Operadores permitidos dentro de una etapa $group.
 */
export interface GroupAccumulator {
    $sum?: string | number | any;   // Puede ser "$campo" o una expresión recursiva
    $avg?: string | any;
    $min?: string | any;
    $max?: string | any;
    $count?: Record<string, never>; // Objeto vacío {}
    $push?: string | any;
}

export interface RelationOptions {
    // La función que retorna la entidad relacionada (ej: () => User)
    targetEntity: () => ClassType<any>;

    // El tipo de relación
    type: 'OneToOne' | 'OneToMany' | 'ManyToOne' | 'ManyToMany';

    // Nombre de la columna que guarda la llave foránea (opcional)
    joinColumn?: string;

    // El nombre de la propiedad en la entidad contraria (opcional, para relaciones bidireccionales)
    inverseSide?: string;

    // Si al guardar/borrar esta entidad, la acción se propaga a las relacionadas
    cascade?: boolean;
}