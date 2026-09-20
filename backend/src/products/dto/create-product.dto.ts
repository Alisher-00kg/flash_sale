import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateProductDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;
}
