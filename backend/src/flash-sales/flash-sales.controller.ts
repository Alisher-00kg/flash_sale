import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { FlashSalesService } from './flash-sales.service';
import { CreateFlashSaleDto } from './dto/create-flash-sale.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';

@Controller('flash-sales')
export class FlashSalesController {
  constructor(private readonly flashSalesService: FlashSalesService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  create(@Body() dto: CreateFlashSaleDto) {
    return this.flashSalesService.create(dto);
  }

  @Get()
  findAll() {
    return this.flashSalesService.findAll();
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.flashSalesService.findById(id);
  }
}
