// src/test-infrastructure/test-infrastructure.module.ts
import { Module } from '@nestjs/common';
import { SheetOdmModule } from '../lib/sheetOdm.module'; // O la ruta de tu librería
import { ObreroEntity } from './obrero.entity';

@Module({
    imports: [
        SheetOdmModule.forFeature([ObreroEntity]),
    ],

})
export class TestInfrastructureModule { }