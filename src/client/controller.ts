import { Body, Controller, Get, HttpCode, HttpStatus, Injectable, NotFoundException, Param, Post, UsePipes, ValidationPipe } from "@nestjs/common";
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

    // ========================================================================
    // INSERCIONES
    // ========================================================================

    async createObrero(dto: CreateObreroDto) {
        this.logger.debug(`[FLOW-1] DTO Entrante: ${JSON.stringify(dto)}`);
        // Usando el método estático save del Active Record refactorizado
        const nuevoObrero = await this.obreroModel.save(dto);
        return {
            message: 'Obrero registrado exitosamente en la hoja',
            data: nuevoObrero.toJSON() // toJSON() limpia los metadatos internos
        };
    }

    async createAdelanto(idObrero: string, dto: CreateAdelantoDto) {
        // Validación opcional: verificar que el obrero existe en la base (Sheets)
        const obrero = await this.obreroModel.findOne({ id: idObrero });
        if (!obrero) {
            throw new NotFoundException(`Obrero con ID ${idObrero} no existe.`);
        }
        const { idObrero: _, ...dataSinObrero } = dto;

        // Forzamos la relación inyectando el idObrero desde el parámetro de la ruta
        const nuevoAdelanto = await this.adelantoModel.save({
            ...dataSinObrero,
            idObrero: idObrero
        });

        return {
            message: 'Adelanto asignado correctamente',
            data: nuevoAdelanto.toJSON()
        };
    }

    // ========================================================================
    // CONSULTAS
    // ========================================================================

    async findAllObreros() {
        // Retorna todos los obreros (sin relaciones pobladas)
        const obreros = await this.obreroModel.find();
        return obreros.map(obrero => obrero.toJSON());
    }

    async findObreroConAdelantos(idObrero: string) {
        // Usamos el query option `populate` que configuraste para las SubCollections
        const obreroCompleto = await this.obreroModel.findOne(
            { id: idObrero },
            { populate: 'adelantos' } // Debe hacer match con la propiedad @SubCollection
        );

        if (!obreroCompleto) {
            throw new NotFoundException(`Obrero con ID ${idObrero} no encontrado.`);
        }

        return obreroCompleto.toJSON();
    }

}


@Controller('admin-planilla')
export class PlanillaAdminController {
    constructor(private readonly planillaService: PlanillaTareoService) { }

    // 1. Inserción de una sola entidad
    @Post()
    createObrero(@Body() createObreroDto: CreateObreroDto) {
        return this.planillaService.createObrero(createObreroDto);
    }

    // 2. Inserción de entidad relacionada
    @Post(':id/adelantos')
    createAdelanto(
        @Param('id') idObrero: string,
        @Body() createAdelantoDto: CreateAdelantoDto
    ) {
        return this.planillaService.createAdelanto(idObrero, createAdelantoDto);
    }

    // 3. Consulta de una sola entidad (Lista)
    @Get()
    findAll() {
        return this.planillaService.findAllObreros();
    }

    // 4. Consulta de entidades relacionadas (Populate)
    @Get(':id/full')
    findObreroFull(@Param('id') idObrero: string) {
        return this.planillaService.findObreroConAdelantos(idObrero);
    }



}