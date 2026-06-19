import { Body, Controller, HttpCode, HttpStatus, Injectable, Param, Post, UsePipes, ValidationPipe } from "@nestjs/common";
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
        this.logger.log(`Intentando persistir obrero con DNI: ${dto.dni}`);

        // 1. Verificación en Postgres (Rápida)
        const existingUser = await this.obreroModel.findOne({ dni: dto.dni });
        if (existingUser) {
            throw new Error(`El obrero con DNI ${dto.dni} ya existe.`);
        }

        // 2. Guardado en Postgres
        // Al instanciar el modelo, el ODM debería manejar la persistencia en DB 
        // y emitir el evento para que Google Sheets se sincronice asíncronamente.
        const nuevoObrero = new this.obreroModel(dto);
        return await nuevoObrero.save();
    }

}


@Controller('admin-planilla')
export class PlanillaAdminController {
    constructor(private readonly planillaService: PlanillaTareoService) { }

    @Post('obrero')
    @HttpCode(HttpStatus.CREATED)
    @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })) // 👈 Habilita la validación
    async createObrero(@Body() createDto: CreateObreroDto) {
        // Ahora 'createDto' ya está validado, si falta un campo, Nest devuelve 400 Bad Request
        return await this.planillaService.createObrero(createDto);
    }

}