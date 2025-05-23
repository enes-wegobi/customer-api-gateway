import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisService } from './redis.service';
import { BaseRedisService } from './services/base-redis.service';
import { LocationService } from './services/location.service';
import { DriverStatusService } from './services/driver-status.service';
import { CustomerStatusService } from './services/customer-status.service';
import { NearbySearchService } from './services/nearby-search.service';
import { ActiveTripService } from './services/active-trip.service';

@Module({
  imports: [ConfigModule],
  providers: [
    BaseRedisService,
    LocationService,
    DriverStatusService,
    CustomerStatusService,
    NearbySearchService,
    ActiveTripService,
    RedisService,
  ],
  exports: [
    LocationService,
    DriverStatusService,
    CustomerStatusService,
    NearbySearchService,
    ActiveTripService,
    RedisService,
  ],
})
export class RedisModule {}
