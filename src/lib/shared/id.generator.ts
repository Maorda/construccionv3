import { v4 as uuidv4 } from 'uuid';
import { nanoid } from 'nanoid';

export class IdFactory {
    /**
     * Recomendado para PKs de BD. 
     * El estándar de la industria para evitar colisiones.
     */
    static createUUID(): string {
        return uuidv4();
    }

    /**
     * Recomendado para IDs de referencia externa o URLs legibles.
     * nanoid es 2x más rápido que uuid y más seguro que cortar un string.
     */
    static createShort(): string {
        return nanoid(10); // 10 caracteres con alta entropía
    }
}