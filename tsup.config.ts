import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/lib/index.ts'],
    format: ['cjs', 'esm'],
    dts: true, // Genera archivos .d.ts
    splitting: false,
    sourcemap: true,
    clean: true,
    outDir: 'dist',
    tsconfig: 'tsconfig.json',
});