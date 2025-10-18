import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString, Matches, Min } from 'class-validator';

export class TokenDto {
  @ApiProperty({
    description: 'Blockchain chain ID',
    example: 1,
    minimum: 1,
  })
  @IsNumber()
  @Min(1)
  chainId: number;

  @ApiProperty({
    description: 'Token contract address',
    example: '0xC02aaA39b223FE8D0a0e5C4F27eAD9083C756Cc2',
  })
  @IsString()
  @Matches(/^0x[a-fA-F0-9]{40}$/, {
    message:
      'address must be a valid blockchain address (0x followed by 40 hex characters)',
  })
  address: string;
}
