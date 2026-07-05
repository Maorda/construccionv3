import { Body, Controller, Get, HttpCode, HttpStatus, Injectable, NotFoundException, Param, Post, Query, UsePipes, ValidationPipe } from "@nestjs/common";
import { Logger } from "@nestjs/common";
import { FilterQuery, InjectModel, Model } from "@sheetOdm/core/model/model.factory";
import { CreateObreroDto, GetAdelantosReportDto, ObreroEntity } from "./obrero.entity";
import { AdelantoEntity, CreateAdelantoDto } from "./adelanto.entity";

@Injectable()
export class PlanillaTareoService {
    private readonly logger = new Logger(PlanillaTareoService.name);

    constructor(
        @InjectModel(AdelantoEntity)
        private readonly adelantoModel: Model<AdelantoEntity>
    ) { }

    async getAdelantosReporte(obreroId: string, minMonto: number = 99) {
        // 1. Usamos la propiedad correcta 'idObrero' definida en la entidad
        const adelantos = await this.adelantoModel.find({ idObrero: obreroId });

        // 2. Ejecutamos la agregación
        return await this.adelantoModel.aggregate()
            .match({ monto: { $gt: minMonto } })
            .project({
                monto: 1,
                fecha: 1,
                // Si necesitas el idObrero en el resultado, agrégalo aquí:
                idObrero: 1
            })
            .sort({ monto: -1 })
            .runStages(adelantos);
    }

    async crearAdelanto(dto: CreateAdelantoDto) {
        this.logger.log(`Registrando nuevo adelanto para obrero: ${dto.idObrero}`);
        return await this.adelantoModel.save(dto);
    }

    async buscarAdelantos(filtro: FilterQuery<AdelantoEntity>) {
        return await this.adelantoModel.find(filtro);
    }
}


@Controller('admin-planilla')
export class PlanillaAdminController {
    constructor(private readonly adelantoService: PlanillaTareoService) { }

    @Post()
    async create(@Body() body: CreateAdelantoDto) {
        return await this.adelantoService.crearAdelanto(body);
    }

    @Post('search')
    async find(@Body() query: FilterQuery<AdelantoEntity>) {
        return await this.adelantoService.buscarAdelantos(query);
    }

    @Post('reporte-adelantos')
    async getReporte(@Body() body: GetAdelantosReportDto) {
        // Si el usuario no envía minMonto, el servicio usará el valor por defecto (0)
        return await this.adelantoService.getAdelantosReporte(
            body.obreroId,
            body.minMonto ?? 0
        );
    }


}