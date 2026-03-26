import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FinancialEntry } from './financial-entry.entity';
import { FinancialExpense } from './financial-expense.entity';
import { FinancialService } from './financial.service';
import { FinancialController } from './financial.controller';

@Module({
  imports: [TypeOrmModule.forFeature([FinancialEntry, FinancialExpense])],
  controllers: [FinancialController],
  providers: [FinancialService],
})
export class FinancialModule {}
