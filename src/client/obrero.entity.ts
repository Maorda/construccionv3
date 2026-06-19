import { Column } from "../lib/core/decorators/column.decorator";
import { PrimaryKey } from "../lib/core/decorators/primarykey.decorator";
import { SubCollection } from "../lib/core/decorators/subcollection.decorator";

import { Table } from "../lib/core/decorators/table.decorator";
import { IsString, IsNotEmpty, IsNumber, IsOptional } from "class-validator";
import { AdelantoEntity } from "./adelanto.entity";

export class CreateObreroDto {
    @IsString()
    @IsOptional()
    id?: string;

    @IsString()
    @IsNotEmpty()
    nombre: string;

    @IsString()
    @IsNotEmpty()
    dni: string;

    @IsString()
    @IsNotEmpty()
    idCategoriaActual: string;

    @IsNumber()
    @IsNotEmpty()
    saldoEfectivoArrastrado: number;

    @IsNumber()
    @IsNotEmpty()
    saldoHorasExtraArrastrado: number;
}

@Table('OBREROS', { dto: CreateObreroDto })
export class ObreroEntity {
    @PrimaryKey()
    @Column({ name: 'ID_OBRERO', generated: 'short-id' })
    id: string;

    @Column({ name: 'NOMBRE', required: true })
    nombre: string;

    @Column({ name: 'DNI', required: true })
    dni: string;

    @Column({ name: 'ID_CATEGORIA_ACTUAL', required: true })
    idCategoriaActual: string;

    // Arrastres financieros de la semana anterior (por falta de sencillo/monedas o sueldo adelantado)
    @Column({ name: 'SALDO_EFECTIVO_ARRANGED', type: 'number', default: 0 })
    saldoEfectivoArrastrado: number; // Positivo si se le debe dinero, Negativo si pidió adelanto de sueldo mayor a su semana

    // Arrastre de banco de horas extras de la semana anterior
    @Column({ name: 'SALDO_HORAS_EXTRA_ARRANGED', type: 'number', default: 0 })
    saldoHorasExtraArrastrado: number; // Negativo si debe horas (Dinámica de Deuda de Horas)

    @SubCollection(() => AdelantoEntity, { joinColumn: 'idObrero' })
    adelantos: AdelantoEntity[];
}