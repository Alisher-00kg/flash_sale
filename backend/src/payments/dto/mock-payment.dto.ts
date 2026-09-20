import { IsIn, IsInt, IsOptional, Min } from 'class-validator';

export class MockPaymentDto {
  @IsIn(['SUCCESS', 'FAILED', 'PENDING'])
  result: 'SUCCESS' | 'FAILED' | 'PENDING';

  @IsOptional()
  @IsInt()
  @Min(0)
  delayMs?: number;
}
