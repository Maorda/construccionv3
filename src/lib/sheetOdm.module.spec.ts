import { Test } from '@nestjs/testing';
import { SheetOdmModule } from './sheetOdm.module';

describe('SheetOdmModule', () => {
    it('debe compilarse y ser inyectable', async () => {
        const module = await Test.createTestingModule({
            imports: [SheetOdmModule],
        }).compile();

        expect(module).toBeDefined();
        expect(module.get(SheetOdmModule)).toBeDefined();
    });
});