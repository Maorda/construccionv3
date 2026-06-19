// src/test-infrastructure/test-infrastructure.module.ts
import { Module } from '@nestjs/common';
import { SheetOdmModule } from '../lib/sheetOdm.module'; // O la ruta de tu librería
import { ObreroEntity } from './obrero.entity';
import { PlanillaAdminController, PlanillaTareoService } from './controller';
import { AdelantoEntity } from './adelanto.entity';

@Module({
    imports: [
        SheetOdmModule.forFeature([ObreroEntity, AdelantoEntity]),
    ],
    controllers: [PlanillaAdminController],
    providers: [
        PlanillaTareoService,
    ],

})
export class TestInfrastructureModule { }