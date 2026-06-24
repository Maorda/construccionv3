import { Module, Global } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';

@Global()
@Module({
    imports: [
        CacheModule.register({
            ttl: 60000 * 5, // 5 minutos por defecto. Vital para no exceder cuotas.
            max: 100, // Máximo número de elementos en memoria
        }),
    ],
    exports: [CacheModule],
})
export class SheetCacheModule { }