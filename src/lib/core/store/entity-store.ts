// Un solo WeakMap para toda la aplicación.
// La llave es la instancia de la entidad (ObreroEntity, AdelantoEntity, etc.)
// El valor es el objeto con los datos planos.
const globalEntityDataStore = new WeakMap<object, Record<string, any>>();

export const EntityStore = {
    set(instance: object, data: Record<string, any>) {
        globalEntityDataStore.set(instance, data);
    },
    get(instance: object): Record<string, any> | undefined {
        return globalEntityDataStore.get(instance);
    },
    has(instance: object): boolean {
        return globalEntityDataStore.has(instance);
    }
};