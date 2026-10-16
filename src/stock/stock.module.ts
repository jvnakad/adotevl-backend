import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductType } from './product-type.entity';
import { Product } from './product.entity';
import { StockHistoryEvent } from './stock-history.entity';
import { ProductTypeController } from './product-type.controller';
import { ProductController } from './product.controller';
import { StockHistoryController } from './stock-history.controller';
import { ProductTypeService } from './product-type.service';
import { ProductService } from './product.service';
import { StockHistoryService } from './stock-history.service';

@Module({
  imports: [TypeOrmModule.forFeature([ProductType, Product, StockHistoryEvent])],
  controllers: [ProductTypeController, ProductController, StockHistoryController],
  providers: [ProductTypeService, ProductService, StockHistoryService],
})
export class StockModule {}
