import { ROW_INDEX_SYMBOL, INTERNAL_REPO, INTERNAL_NEW } from '../../shared/constants/constants';

export abstract class SheetDocument<T> {
    // Declaramos los campos del documento (se asignarán dinámicamente)
    [key: string]: any;
    [INTERNAL_REPO]!: any;
    [INTERNAL_NEW]!: boolean;

    constructor(
        data: T,
        repository: any,
        isNew: boolean
    ) {
        // Encapsulamos las dependencias core bajo Symbols no enumerables
        Object.defineProperty(this, INTERNAL_REPO, { value: repository, enumerable: false });
        Object.defineProperty(this, INTERNAL_NEW, { value: isNew, enumerable: false, writable: true });

        // Asignación de las propiedades de la fila al documento
        //  Object.assign(this, data);
    }

    /**
     * Guarda el documento actual usando el repositorio.
     */
    async save(): Promise<this> {
        if (!this[INTERNAL_REPO]) {
            throw new Error(`[OdmError] Documento huérfano: No se encontró un repositorio asociado.`);
        }
        return await this[INTERNAL_REPO].save(this) as this;
    }

    /**
     * Elimina el documento actual.
     */
    async remove(): Promise<boolean> {
        if (!this[INTERNAL_REPO]) {
            throw new Error(`[OdmError] Documento huérfano: No se encontró un repositorio asociado.`);
        }
        return await this[INTERNAL_REPO].delete(this);
    }

    /**
     * Marca el documento como guardado, útil tras una operación exitosa.
     */
    markAsSaved(rowNumber: number): void {
        this[INTERNAL_NEW] = false;
        (this as any)[ROW_INDEX_SYMBOL] = rowNumber;
    }

    /**
     * Obtiene el índice físico de la fila en Google Sheets
     */
    get rowNumber(): number | undefined {
        return (this as any)[ROW_INDEX_SYMBOL];
    }



    getPrimaryKeyValue(key: keyof T): string | number {
        return (this as any)[key];
    }
}