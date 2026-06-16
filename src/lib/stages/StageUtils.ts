// stage-utils.ts
export const StageUtils = {
    validateObject: (config: any, stageName: string) => {
        if (!config || typeof config !== 'object' || Array.isArray(config)) {
            throw new Error(`${stageName} requiere un objeto de configuración válido.`);
        }
    }
};