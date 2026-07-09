import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/lib/index.ts'], // Mantenemos tu ruta estructurada interna
    format: ['cjs', 'esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    outDir: 'dist',
    tsconfig: 'tsconfig.json',
    external: [
        '@nestjs/common',
        '@nestjs/core',
        '@nestjs/axios',
        'rxjs',
        'dayjs',
        'googleapis'
    ]
});