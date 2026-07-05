// stage-utils.ts
export const StageUtils = {
    // Para validar stages (como $match, $project)
    validateObject: (config: any, stageName: string) => {
        if (!config || typeof config !== 'object' || Array.isArray(config)) {
            throw new Error(`${stageName} requiere un objeto de configuración válido.`);
        }
    },
    // Nuevo: Para validar la data que recibe runStages
    validateArray: (data: any, stageName: string) => {
        if (!Array.isArray(data)) {
            throw new Error(`${stageName} requiere un array de datos válido.`);
        }
    }
};