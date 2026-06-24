import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import { SheetsRepository } from "../repository/sheets.repository";

import { SheetDocument } from "../wrapper/sheet-document";
import { ClassType } from "../types/common.types";
import {
    ROW_INDEX_SYMBOL,
    SHEETS_COLUMN_DETAILS
} from '../../shared/constants/constants';
import { SheetDataTransformer } from "./sheetDataTransformer";

export interface HydratorOptions<T extends object, U extends SheetDocument<T>> {
    new?: boolean;
    oldDataFlat?: any;
    customConstructor?: new (
        data: T, // <-- Regresarlo a T
        repo: SheetsRepository<T>,
        isNew: boolean,
        entityClass?: ClassType<T>,
        rowNumber?: number,
        version?: number
    ) => U;
}

@Injectable()
export class SheetDocumentHydrator {
    private readonly logger = new Logger(SheetDocumentHydrator.name);

    constructor(
        private readonly transformer: SheetDataTransformer
    ) { }

    public hydrateAndShield<T extends object, U extends SheetDocument<T> = SheetDocument<T>>(
        entityClass: ClassType<T>,
        repository: SheetsRepository<T>,
        rawData: any,
        options: HydratorOptions<T, U> = {}
    ): U {
        if (!rawData) {
            throw new Error(`[Hydrator] No se pueden hidratar datos nulos para ${entityClass.name}`);
        }

        try {
            // 1. Determinar fuente de datos
            const dataToProcess = (options.new === false && options.oldDataFlat)
                ? options.oldDataFlat
                : rawData;

            const isNewDoc = options.new !== undefined
                ? options.new
                : (dataToProcess[ROW_INDEX_SYMBOL] === undefined);

            // 2. Extraer metadatos
            const targetPrototype = entityClass.prototype;
            const details = Reflect.getMetadata(SHEETS_COLUMN_DETAILS, targetPrototype) || {};

            // 3. 🌟 PROCESO DE TRANSFORMACIÓN Y AUTO-GENERACIÓN (Data Plana)
            const processedData: Partial<T> = {};

            for (const key in details) {
                const config = details[key];
                let value = dataToProcess[key];

                // a. Casteo de tipos
                if (config && config.type) {
                    value = this.transformer.castValue(value, config.type);
                }

                // b. Auto-generación del ID (Interceptado antes de instanciar)
                if (isNewDoc && (config as any)?.generated === 'uuid' && !value) {
                    value = randomUUID();
                }

                // Mapear solo los campos definidos en el decorador (Limpieza estricta)
                processedData[key as keyof T] = value !== undefined ? value : null as any;
            }

            // 4. 🔄 INSTANCIACIÓN DEL WRAPPER
            // Mantenemos el parche del closure porque SheetDocument tiene un bug en sus métodos
            // nativos usando this._repository en lugar de this[INTERNAL_REPO]
            const DynamicModel = options.customConstructor || class extends SheetDocument<T> {
                async save(): Promise<this> { return (await repository.save(this)) as this; }
                async remove(): Promise<boolean> { return await repository.delete(this); }
                async populate(path: string): Promise<this> { return this; }
            };

            const hydratedDoc = new DynamicModel(
                processedData as T, // 👈 EL FIX ESTÁ AQUÍ: Casteamos a T
                repository,
                isNewDoc,
                entityClass // Restauramos entityClass por si tu customConstructor lo usa
            ) as U;

            // 5. ASIGNACIÓN DE METADATOS INTERNOS
            (hydratedDoc as any)._entityClass = entityClass;

            // Preservar puntero de fila (Símbolo)
            if (dataToProcess[ROW_INDEX_SYMBOL] !== undefined) {
                (hydratedDoc as any)[ROW_INDEX_SYMBOL] = dataToProcess[ROW_INDEX_SYMBOL];
            }

            // 6. 📈 VIRTUAL GETTERS (Binding)
            const descriptors = Object.getOwnPropertyDescriptors(targetPrototype);
            for (const [key, descriptor] of Object.entries(descriptors)) {
                if (descriptor.get && key !== 'constructor') {
                    Object.defineProperty(hydratedDoc, key, {
                        get: descriptor.get.bind(hydratedDoc),
                        enumerable: true,
                        configurable: true
                    });
                }
            }

            // 7. 🛡️ SERIALIZADOR DETERMINISTA (Sobreescribe el toJSON nativo deficiente)
            Object.defineProperty(hydratedDoc, 'toJSON', {
                value: function () {
                    const plainObject: any = {};

                    // a. Extraer columnas base definidas en la clase (incluye el ID generado)
                    for (const col of Object.keys(details)) {
                        plainObject[col] = this[col] !== undefined ? this[col] : null;
                    }

                    // b. Extraer Virtuals
                    for (const key of Object.keys(descriptors)) {
                        if (descriptors[key].get && key !== 'constructor') {
                            plainObject[key] = this[key];
                        }
                    }

                    // c. Rescatar el Símbolo de fila (Crítico para que el repo pueda actualizar)
                    const rowIndex = this[ROW_INDEX_SYMBOL];
                    if (rowIndex !== undefined) {
                        plainObject.__row = rowIndex;
                    }

                    return plainObject;
                },
                enumerable: false, // No contamina las iteraciones de la instancia
                configurable: true
            });

            return hydratedDoc as U;

        } catch (error: any) {
            this.logger.error(`[Hydrator] ❌ Error crítico hidratando "${entityClass.name}": ${error.message}`);
            throw error;
        }
    }
}