import { ROW_INDEX_SYMBOL, INTERNAL_REPO, INTERNAL_NEW } from '../../shared/constants/constants';

export abstract class SheetDocument<T> {
    // Declaramos los campos del documento (se asignarán dinámicamente)
    [key: string]: any;

    constructor(
        data: T,
        repository: any,
        isNew: boolean
    ) {
        // Las propiedades protegidas por Symbol no colisionarán nunca con keys de `data`
        Object.defineProperty(this, INTERNAL_REPO, { value: repository, enumerable: false });
        Object.defineProperty(this, INTERNAL_NEW, { value: isNew, enumerable: false, writable: true });

        Object.assign(this, data);
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
        // 🔥 SOLUCIÓN: Extraemos directamente los valores puros.
        // Si tu arquitectura guarda los datos originales dentro de `_data`, devuélvelos directamente.
        if (this._data) {
            // Clonamos profundamente (shallow clone) para evitar mutaciones accidentales
            return { ...this._data } as T;
        }

        // 🛡️ BACKUP: Si NO usas _data y las propiedades están en `this` mediante getters/proxy,
        // extraemos la data de forma segura iterando las llaves expuestas del esquema:
        const plain: any = {};
        for (const key of Object.keys(this)) {
            // Omitimos variables privadas internas de Nest o del Wrapper
            if (!key.startsWith('_') && key !== 'logger') {
                plain[key] = (this as any)[key];
            }
        }

        return plain as T;
    }

    getPrimaryKeyValue(key: keyof T): string | number {
        return (this as any)[key]; // Aquí el cast es seguro porque solo se usa para lectura
    }
}