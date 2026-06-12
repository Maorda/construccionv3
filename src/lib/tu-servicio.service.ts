import { Injectable, Inject } from '@nestjs/common';

import { SheetOdmOptions } from './sheet-odm.interface';

@Injectable()
export class TuServicio {
    constructor(

    ) {
        console.log('Mi librería está configurada con:',);
    }
}