import { Body, Controller, HttpCode, HttpStatus, Injectable, NotFoundException, Param, Post, UsePipes, ValidationPipe } from "@nestjs/common";
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
    async crearObreroConAdelantos(data: CreateObreroDto & { adelantos?: CreateAdelantoDto[] }): Promise<ObreroEntity> {
        this.logger.log(`Registrando nuevo obrero con ${data.adelantos?.length || 0} adelantos iniciales.`);

        // Mapeamos o casteamos el objeto para cumplir con la firma estricta del Modelo de tu ODM
        const payload: Partial<ObreroEntity> = {
            ...data,
            adelantos: data.adelantos as AdelantoEntity[] // Forzamos el casteo ya que el MutationEngine asignará los IDs generados
        };

        const nuevoObrero = await this.obreroModel.save(payload);
        return nuevoObrero;
    }
    async registrarAdelantoDiario(idObrero: string, dto: CreateAdelantoDto): Promise<AdelantoEntity> {
        this.logger.log(`Buscando obrero con ID ${idObrero} para asignarle un adelanto de S/. ${dto.monto}`);

        // 🚀 CORRECCIÓN CRÍTICA: Se debe buscar en obreroModel, no en adelantoModel
        const obrero = await this.obreroModel.findOne({ id: idObrero });
        if (!obrero) {
            throw new NotFoundException(`El obrero con ID ${idObrero} no existe.`);
        }

        // Insertamos el adelanto directo vinculándolo a través de la relación explícita
        const nuevoAdelanto = await this.adelantoModel.save({
            ...dto,
            idObrero: obrero.id
        } as Partial<AdelantoEntity>); // Casteo seguro para el ODM

        return nuevoAdelanto;
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

    /**
     * POST /admin-planilla/obrero-con-adelantos
     * Inserta un Obrero en la pestaña 'OBREROS' y automáticamente pobla 
     * sus adelantos iniciales en la pestaña 'ADELANTOS_DIARIOS'
     */
    @Post('obrero-con-adelantos')
    @HttpCode(HttpStatus.CREATED)
    // El ValidationPipe procesará las validaciones anidadas si configuraste @ValidateNested() en el DTO
    @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
    async crearObreroConAdelantos(
        @Body() data: CreateObreroDto & { adelantos?: CreateAdelantoDto[] }
    ) {
        return await this.planillaService.crearObreroConAdelantos(data);
    }

    /**
     * POST /admin-planilla/obrero/:idObrero/adelanto
     * Registra un adelanto diario directamente a un obrero existente pasándole su ID por parámetro
     */
    @Post('obrero/:idObrero/adelanto')
    @HttpCode(HttpStatus.CREATED)
    @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
    async registrarAdelantoDiario(
        @Param('idObrero') idObrero: string,
        @Body() createAdelantoDto: CreateAdelantoDto
    ) {
        return await this.planillaService.registrarAdelantoDiario(idObrero, createAdelantoDto);
    }



}