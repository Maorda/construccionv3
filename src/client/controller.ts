import { Body, Controller, HttpCode, HttpStatus, Injectable, Param, Post } from "@nestjs/common";
import { Logger } from "@nestjs/common";
import { InjectModel, Model } from "@sheetOdm/core/model/model.factory";
import { CreateObreroDto, ObreroEntity } from "./obrero.entity";

@Injectable()
export class PlanillaTareoService {
    private readonly logger = new Logger(PlanillaTareoService.name);

    constructor(
        @InjectModel(ObreroEntity) private readonly obreroModel: Model<ObreroEntity>,
    ) { }

    async createObrero(dto: CreateObreroDto): Promise<ObreroEntity> {
        this.logger.log(`Creando obrero: ${dto.id}`);

        const existingUser = await this.obreroModel.findOne({ dni: dto.dni });
        if (existingUser) {
            throw new Error(`El obrero con DNI ${dto.dni} ya existe.`);
        }
        const user = new this.obreroModel(dto);
        return await user.save();
    }

}


@Controller('admin-planilla')
export class PlanillaAdminController {
    private readonly logger = new Logger(PlanillaAdminController.name);
    constructor(
        private readonly planillaService: PlanillaTareoService,
    ) { }


    @Post('obrero')
    @HttpCode(HttpStatus.CREATED)
    async createObrero(@Body() body: any) {
        this.logger.log(`Recibiendo petición para guardar obrero: ${body.id}`);
        try {
            return await this.planillaService.createObrero(body);
        } catch (error: any) {
            this.logger.error(`Error al guardar: ${error.message}`);
            throw error;
        }
    }

}