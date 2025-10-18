import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TokenPriceDto {
  @ApiProperty({
    description: 'Blockchain chain ID',
    example: 1,
  })
  chainId: number;

  @ApiProperty({
    description: 'Token contract address',
    example: '0xC02aaA39b223FE8D0a0e5C4F27eAD9083C756Cc2',
  })
  address: string;

  @ApiPropertyOptional({
    description: 'Token name',
    example: 'Wrapped Ether',
  })
  name?: string;

  @ApiPropertyOptional({
    description: 'Token symbol',
    example: 'WETH',
  })
  symbol?: string;

  @ApiPropertyOptional({
    description: 'Token logo URL',
    example: 'https://assets.coingecko.com/coins/images/2518/large/weth.png',
  })
  logo?: string;

  @ApiPropertyOptional({
    description: 'Token decimals',
    example: 18,
  })
  decimals?: number;

  @ApiPropertyOptional({
    description: 'Token price in USD',
    example: 4117.37,
  })
  price?: number;

  @ApiPropertyOptional({
    description: 'Timestamp when price was fetched',
    example: 1697370000123,
  })
  timestamp?: number;

  @ApiPropertyOptional({
    description: 'Error message if token price could not be fetched',
    example: 'Token not found',
  })
  error?: string;
}

export class PriceResponseDto {
  @ApiProperty({
    description: 'List of token prices',
    type: [TokenPriceDto],
  })
  tokens: TokenPriceDto[];
}
