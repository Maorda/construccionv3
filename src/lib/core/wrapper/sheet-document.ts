import { ROW_INDEX_SYMBOL } from '../../shared/constants/constants';

export abstract class SheetDocument<T> {
    // Declaramos los campos del documento (se asignarán dinámicamente)
    [key: string]: any;

    constructor(
        protected _data: T,
        protected readonly _repository: any, // Aquí va el SheetsRepository<T>
        protected _isNew: boolean,
        protected readonly _entityClass: Function

    ) {
        // Asignamos las propiedades del objeto de datos a la instancia
        Object.assign(this, _data);
    }

    /**
     * Guarda el documento actual usando el repositorio.
     */
    async save(): Promise<this> {
        return await this._repository.save(this) as this;
    }

    /**
     * Elimina el documento actual.
     */
    async remove(): Promise<boolean> {
        return await this._repository.delete(this);
    }

    /**
     * Marca el documento como guardado, útil tras una operación exitosa.
     */
    markAsSaved(rowNumber: number): void {
        this._isNew = false;
        (this as any)[ROW_INDEX_SYMBOL] = rowNumber;
    }

    /**
     * Permite obtener el número de fila actual.
     */
    get rowNumber(): number | undefined {
        return (this as any)[ROW_INDEX_SYMBOL];
    }

    /**
     * Serializa el documento de vuelta a un objeto plano.
     */
    toJSON(): T {
        const plain = { ...this } as any;
        // Limpiamos los metadatos internos antes de retornar el objeto
        delete plain._data;
        delete plain._repository;
        delete plain._isNew;
        delete plain._entityClass;
        return plain;
    }

    getPrimaryKeyValue(key: keyof T): string | number {
        return (this as any)[key]; // Aquí el cast es seguro porque solo se usa para lectura
    }
}