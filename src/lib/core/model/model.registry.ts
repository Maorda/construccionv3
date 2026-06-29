import { Model } from './model.factory';

const ODM_MODELS_GLOBAL_KEY = Symbol.for('sheetOdm.global_model_store');

if (!globalThis[ODM_MODELS_GLOBAL_KEY]) {
    globalThis[ODM_MODELS_GLOBAL_KEY] = new Map<string, Model<any>>();
}

export class ModelRegistry {
    static register(entityName: string, model: Model<any>) {
        (globalThis[ODM_MODELS_GLOBAL_KEY] as Map<string, Model<any>>).set(entityName, model);
    }

    static get(entityName: string): Model<any> | undefined {
        return (globalThis[ODM_MODELS_GLOBAL_KEY] as Map<string, Model<any>>).get(entityName);
    }
}