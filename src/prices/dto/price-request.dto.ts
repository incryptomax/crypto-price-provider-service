import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TokenDto } from './token.dto';

export class PriceRequestDto {
  @ApiProperty({
    description: 'List of tokens to fetch prices for',
    type: [TokenDto],
    minItems: 1,
    maxItems: 50,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => TokenDto)
  tokens: TokenDto[];
}
