import { IsInt, IsUUID, Min } from 'class-validator';

export class AddToCartDto {
  @IsUUID()
  flashSaleId: string;

  @IsInt()
  @Min(1)
  quantity: number;
}
