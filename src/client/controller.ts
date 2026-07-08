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
    async registrarOIncrementarAdelantoDiarioPro(
        idPlanilla: string,
        idObrero: string,
        fecha: string,
        monto: number,
        motivo: string
    ) {
        this.logger.log(`[TEST:UPSERT] Ejecutando findOneAndUpdate con hidratación relacional para Obrero: ${idObrero}`);

        return await this.adelantoModel.findOneAndUpdate(
            {
                idPlanilla: idPlanilla,
                idObrero: idObrero,
                fecha: fecha
            },
            {
                $inc: { monto: monto },
                $set: { motivo: motivo }
            },
            {
                upsert: true,
                new: true, // Devuelve el dato modificado
                // 🔥 AQUÍ PROBAMOS EL MÓDULO NUEVO:
                // Queremos que el repositorio aplique resolveJoins sobre el resultado del update
                populate: 'idObrero' // Suponiendo que adelantos tiene una relación inversa o mapeas al padre
            } as any // Forzamos any si tu interfaz estricta de UpdateOptions no hereda de QueryOptions aún
        );
    }
    /**
     * Ejemplo de findOneAndUpdate con operadores $inc y $set
     * Aumenta el monto del adelanto y actualiza el motivo en una sola operación atómica.
     */
    async incrementarAdelanto(idAdelanto: string, montoAdicional: number, notaAdicional?: string) {
        this.logger.log(`[ODM:UPDATE] Incrementando S/ ${montoAdicional} al adelanto ID: ${idAdelanto}`);

        const updateQuery: any = {
            $inc: { monto: montoAdicional }
        };

        if (notaAdicional) {
            updateQuery.$set = { motivo: notaAdicional };
        }

        // Ejecutamos findOneAndUpdate pidiendo que devuelva el documento NUEVO modificado
        const adelantoActualizado = await this.adelantoModel.findOneAndUpdate(
            { id: idAdelanto },
            updateQuery,
            { new: true } // true = devuelve el dato ya sumado; false = devuelve como estaba antes
        );

        if (!adelantoActualizado) {
            throw new NotFoundException(`No se encontró el adelanto con ID: ${idAdelanto}`);
        }

        return adelantoActualizado;
    }

    /**
     * Ejemplo con UPSERT: Busca el adelanto de un obrero en una fecha específica.
     * Si existe, le suma el monto. Si no existe, crea la fila de la nada con ese monto inicial.
     */
    async registrarOIncrementarAdelantoDiario(idPlanilla: string, idObrero: string, fecha: string, monto: number, motivo: string) {
        this.logger.log(`[ODM:UPSERT] Evaluando adelanto diario para Obrero: ${idObrero} el dia ${fecha}`);

        return await this.adelantoModel.findOneAndUpdate(
            {
                idPlanilla: idPlanilla,
                idObrero: idObrero,
                fecha: fecha
            },
            {
                $inc: { monto: monto },
                $set: { motivo: motivo }
            },
            {
                upsert: true, // 🔥 Si no encuentra la fila, la crea con los datos del filtro + el update
                new: true
            }
        );
    }

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
    @Post('adelanto/ajustar')
    async incrementarAdelanto(
        @Body() body: { idAdelanto: string; montoAdicional: number; nota?: string }
    ) {
        return await this.adelantoService.incrementarAdelanto(
            body.idAdelanto,
            body.montoAdicional,
            body.nota
        );
    }

    @Post('adelanto/upsert-diario')
    async upsertAdelantoDiario(
        @Body() body: { idPlanilla: string; idObrero: string; fecha: string; monto: number; motivo: string }
    ) {
        /*{
    "idPlanilla": "PLANILLA-2026-07",
    "idObrero": "4ON8A9AL",
    "fecha": "2026-07-05", 
    "monto": 370,
    "motivo": "Adelanto para equipo de protección personal actualizado"
}
    */
        return await this.adelantoService.registrarOIncrementarAdelantoDiario(
            body.idPlanilla,
            body.idObrero,
            body.fecha,
            body.monto,
            body.motivo
        );
    }
    @Post('test-upsert-relacional')
    async testUpsertRelacional(
        @Body() body: { idPlanilla: string; idObrero: string; fecha: string; monto: number; motivo: string }
    ) {
        return await this.adelantoService.registrarOIncrementarAdelantoDiarioPro(
            body.idPlanilla,
            body.idObrero,
            body.fecha,
            body.monto,
            body.motivo
        );
    }


}