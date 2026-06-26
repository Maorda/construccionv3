import { Body, Controller, Get, HttpCode, HttpStatus, Injectable, NotFoundException, Param, Post, Query, UsePipes, ValidationPipe } from "@nestjs/common";
import { Logger } from "@nestjs/common";
import { InjectModel, Model } from "@sheetOdm/core/model/model.factory";
import { CreateObreroDto, ObreroEntity } from "./obrero.entity";
import { AdelantoEntity, CreateAdelantoDto } from "./adelanto.entity";

@Injectable()
export class PlanillaTareoService {
    private readonly logger = new Logger(PlanillaTareoService.name);

    constructor(
        @InjectModel(ObreroEntity) private readonly obreroModel: Model<ObreroEntity>,
        @InjectModel(AdelantoEntity) private readonly adelantoModel: Model<AdelantoEntity>,
    ) { }

    // --- Inserciones ---

    async createObrero(dto: CreateObreroDto) {
        const nuevoObrero = await this.obreroModel.save(dto);
        return { message: 'Obrero registrado exitosamente', data: nuevoObrero };
    }

    async createAdelanto(idObrero: string, dto: CreateAdelantoDto) {
        // Validación del padre
        const obrero = await this.obreroModel.findOne({ id: idObrero });
        if (!obrero) throw new NotFoundException(`Obrero con ID ${idObrero} no existe.`);

        const nuevoAdelanto = await this.adelantoModel.save({
            ...dto,
            idObrero // Forzamos la relación
        });

        return { message: 'Adelanto asignado correctamente', data: nuevoAdelanto };
    }

    // --- Consultas (Genéricas) ---

    async getAllObreros() {
        return await this.obreroModel.find();
    }

    /**
     * Consulta flexible: Si 'withAdelantos' es true, el repo 
     * ejecutará automáticamente el populate configurado en el entity.
     */
    async getObreroById(id: string, withAdelantos: boolean = false) {
        const options = withAdelantos ? { populate: 'adelantos' } : {};

        const obrero = await this.obreroModel.findOne({ id }, options as any);

        if (!obrero) {
            throw new NotFoundException(`Obrero con ID ${id} no encontrado.`);
        }

        return obrero;
    }

}


@Controller('admin-planilla')
export class PlanillaAdminController {
    constructor(private readonly planillaService: PlanillaTareoService) { }

    @Post()
    @HttpCode(HttpStatus.CREATED)
    createObrero(@Body() dto: CreateObreroDto) {
        return this.planillaService.createObrero(dto);
    }

    @Post(':id/adelantos')
    @HttpCode(HttpStatus.CREATED)
    createAdelanto(@Param('id') id: string, @Body() dto: CreateAdelantoDto) {
        return this.planillaService.createAdelanto(id, dto);
    }

    @Get()
    findAll() {
        return this.planillaService.getAllObreros();
    }

    /**
     * Endpoint flexible: 
     * /admin-planilla/123 -> Devuelve solo el obrero
     * /admin-planilla/123?full=true -> Devuelve obrero con adelantos
     */
    @Get(':id')
    findOne(
        @Param('id') id: string,
        @Query('full') full?: string // Captura query param '?full=true'
    ) {
        const withAdelantos = full === 'true';
        return this.planillaService.getObreroById(id, withAdelantos);
    }



}