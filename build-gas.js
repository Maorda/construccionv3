const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

// 1. Definir rutas (Ajusta estas rutas según la estructura de tu proyecto)
const inputFilePath = path.join(__dirname, '../src/gas/codigo.gs'); // Tu archivo original
const outputDirPath = path.join(__dirname, '../dist'); // Donde compilas tu librería
const outputFilePath = path.join(outputDirPath, 'gas-engine.obfuscated.js');

console.log('Iniciando ofuscación del motor GAS...');

try {
    // 2. Leer el código fuente original
    const rawCode = fs.readFileSync(inputFilePath, 'utf8');

    // 3. Configurar y ejecutar el ofuscador
    const obfuscationResult = JavaScriptObfuscator.obfuscate(rawCode, {
        compact: true, // Quita todos los saltos de línea y espacios

        // --- PROTECCIÓN DE VARIABLES Y STRINGS ---
        stringArray: true, // Extrae los strings ('action', 'sheet') a un array oculto
        stringArrayEncoding: ['base64'], // Codifica los strings
        stringArrayThreshold: 0.8, // Ofusca el 80% de los strings para no afectar tanto el rendimiento
        numbersToExpressions: true, // Convierte números (ej: 0) en expresiones (ej: 0x12a - 0x12a)

        // --- PROTECCIÓN DE FLUJO (Usar con moderación en GAS) ---
        controlFlowFlattening: true,
        controlFlowFlatteningThreshold: 0.5, // 50% es un buen balance. 100% haría el script de GAS muy lento.
        deadCodeInjection: false, // APAGADO para GAS: Inyectar código muerto aumenta el tiempo de ejecución innecesariamente.

        // --- MANEJO DE NOMBRES ---
        identifierNamesGenerator: 'hexadecimal', // Cambia variables a nombres tipo _0xabc123
        renameGlobals: false, // IMPORTANTE: Dejar en false para no romper el scope global de GAS

        // 🔥 CRÍTICO: Proteger las funciones que NestJS necesita llamar por nombre exacto
        reservedNames: [
            'executeSheetOdmOperation', // El entry point de la Execution API
            'onEdit' // Si decides mantener triggers nativos de sheets
        ]
    });

    // 4. Asegurar que el directorio de salida existe
    if (!fs.existsSync(outputDirPath)) {
        fs.mkdirSync(outputDirPath, { recursive: true });
    }

    // 5. Guardar el archivo ofuscado
    fs.writeFileSync(outputFilePath, obfuscationResult.getObfuscatedCode(), 'utf8');

    console.log(`✅ Código GAS ofuscado exitosamente en: ${outputFilePath}`);

} catch (error) {
    console.error('❌ Error durante la ofuscación:', error);
    process.exit(1);
}