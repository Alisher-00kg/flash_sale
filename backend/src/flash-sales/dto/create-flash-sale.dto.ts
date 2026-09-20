import { IsDateString, IsInt, IsNumber, IsUUID, Min } from 'class-validator';

export class CreateFlashSaleDto {
  @IsUUID()
  productId: string;

  @IsNumber()
  @Min(0)
  price: number;

  @IsInt()
  @Min(1)
  totalQuantity: number;

  @IsDateString()
  startsAt: string;

  @IsDateString()
  endsAt: string;
}
