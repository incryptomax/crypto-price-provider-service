import { Module } from '@nestjs/common';
import { PricesController } from './prices.controller';
import { PricesService } from './prices.service';
import { CoingeckoProvider } from './providers/coingecko.provider';
import { MoralisProvider } from './providers/moralis.provider';
import { PortalsProvider } from './providers/portals.provider';
import { OneInchProvider } from './providers/1inch.provider';
import { DeFiLlamaProvider } from './providers/defillama.provider';

@Module({
  controllers: [PricesController],
  providers: [
    PricesService,
    CoingeckoProvider,
    MoralisProvider,
    PortalsProvider,
    OneInchProvider,
    DeFiLlamaProvider,
  ],
  exports: [PricesService],
})
export class PricesModule {}
