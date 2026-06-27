import { Column } from "../lib/core/decorators/column.decorator";
import { PrimaryKey } from "../lib/core/decorators/primarykey.decorator";
import { Table } from "../lib/core/decorators/table.decorator";
import { IsString, IsNotEmpty, IsDate, IsNumber, IsOptional } from "class-validator";
export class CreateAdelantoDto {
    @IsString()
    @IsOptional()
    id?: string;

    @IsString()
    @IsNotEmpty()
    idPlanilla: string;

    @IsString()
    @IsOptional()
    idObrero: string;

    @IsString()
    @IsNotEmpty()
    fecha: string;

    @IsNumber()
    @IsNotEmpty()
    monto: number;

    @IsString()
    @IsNotEmpty()
    motivo: string;
}

@Table('ADELANTOS_DIARIOS', { dto: CreateAdelantoDto })
export class AdelantoEntity {
    @PrimaryKey()
    @Column({ name: 'ID_ADELANTO', generated: 'uuid', index: true })
    id: string;

    @Column({ name: 'ID_PLANILLA', required: true })
    idPlanilla: string;

    @Column({ name: 'ID_OBRERO', required: true })
    idObrero: string;

    @Column({ name: 'FECHA', type: 'string', required: true })
    fecha: string;

    @Column({ name: 'MONTO', type: 'number', required: true })
    monto: number;

    @Column({ name: 'MOTIVO', type: 'string', default: 'Adelanto regular' })
    motivo: string;
}